"""kali-core WebSocket server (kali-yarn host).

Accepts connections from kali-web, routes events to the right handler,
and streams responses back to the frontend.

Phase 1A wiring:
  - input → AgentRuntime.respond() → delta events → on done, TTSPipeline
    synthesizes the accumulated text and emits tts_audio events.
  - settings → updates voice, tts_mode, llm_model, auto_tts in runtime.
  - stop → cancels the current generation task.
  - status → emits the active provider/model/voice info on connect.

Phase 1B wiring:
  - audio_start → STTManager.start_session (Vosk streaming STT).
  - audio_chunk (binary) → StreamingSTT.accept → stt_partial events.
  - audio_end → StreamingSTT.finish → stt_final event.
  - wake word → WakeWordDetector feeds from mic stream, emits wake_word.

Phase 1C wiring:
  - tools registered: fs_read, fs_list, run_command, web_search, web_fetch.
  - PermissionGateway checks tool risk level against profile.
  - ConsentManager emits consent_request, awaits consent_response.
  - Executor runs tools with permission checks, emits tool_event.
  - AgentRuntime is multi-step: tool calls are executed and fed back.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any
import urllib.request

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from kali_core.claws.base import available_tools, register
from kali_core.claws.command import RunCommandTool
from kali_core.claws.create_artifact import CreateArtifactTool
from kali_core.claws.fs import FsListTool, FsReadTool
from kali_core.claws.game.adapter import get_adapter
from kali_core.claws.game.dota_live import DotaLiveStateTool
from kali_core.claws.game.fetch_resource import FetchGameResourceTool
from kali_core.claws.game.image_cache import download_game_images_handler
from kali_core.claws.git import GitDiffTool, GitWorktreeTool
from kali_core.claws.launcher import LaunchAppTool
from kali_core.claws.list_monitors import ListMonitorsTool
from kali_core.claws.manage_artifacts import (
    GetArtifactConsoleTool,
    GetArtifactTool,
    ListArtifactsTool,
    UpdateArtifactTool,
)
from kali_core.claws.organize import OrganizeFolderTool
from kali_core.claws.screenshot import ScreenshotTool
from kali_core.claws.stt_corrector import SttCorrectorTool, correct_stt_text
from kali_core.claws.games import GameStartTool, GameActionTool, GameEndTool
from kali_core.claws.tests import RunTestsTool
from kali_core.claws.web import WebFetchTool, WebSearchTool
from kali_core.collar.consent import ConsentManager as ConsentMgr
from kali_core.collar.gateway import PermissionGateway
from kali_core.config import settings
from kali_core.ear.manager import WakeWordDetector
from kali_core.ear.providers import get_stt_provider
from kali_core.user_config import UserConfig, load_or_default as load_user_config, save as save_user_config
from kali_core.game.gsi import gsi_state
from kali_core.gaze import GazeClient
from kali_core.lang_map import normalize
from kali_core.mind.ai_config import AIConfig
from kali_core.mind.ai_config import load as load_ai_config
from kali_core.mind.ai_config import save as save_ai_config
from kali_core.mind.cloud_providers import CLOUD_PROVIDERS
from kali_core.mind.console_requester import ConsoleRequester
from kali_core.mind.connections_store import Connection as SavedConnection
from kali_core.mind.connections_store import ConnectionsStore
from kali_core.mind.executor import Executor
from kali_core.mind.game_session_service import (
    GameSessionRecord,
    GameSessionService,
)
from kali_core.mind.game_session_constants import (
    GameParadigm,
    GameSessionStatus,
    GameSessionWSEvent,
)
from kali_core.mind.jobs import JobManager
from kali_core.mind.llm.direct import DirectLLMProvider
from kali_core.mind.llm.nanobot import NanobotLLMProvider
from kali_core.mind.llm.provider import LLMProvider, StreamEvent, ToolDef
from kali_core.mind.llm.scanner import probe_endpoint, verify_api_key
from kali_core.mind.runtime import AgentRuntime
from kali_core.nest.job_store import JobStore
from kali_core.nest.store import SessionStore
from kali_core.voice.pipeline import TTSPipeline
from kali_core.voice.providers.http import HTTPTTSProvider
from kali_core.voice.providers.inproc import InProcTTSProvider
from kali_core.voice.providers.qwen import (
    PREDEFINED_VOICES,
    QwenTTSProvider,
    get_random_preview_text,
)
from kali_core.voice.voice_config import VoiceConfigManager

logger = logging.getLogger("kali_core.server")


def _validate_voice_for_provider(voice: str, provider) -> str:
    """Return *voice* if valid for *provider*, else raise ValueError.

    The caller is expected to catch ValueError and use
    _first_available_voice(provider) as the fallback.
    """
    name = getattr(provider, "provider_name", "")
    if name == "qwen3":
        from kali_core.voice.providers.qwen import PREDEFINED_VOICES, VOICE_DESIGN_PRESETS
        valid = {v["id"] for v in PREDEFINED_VOICES} | {p["id"] for p in VOICE_DESIGN_PRESETS}
        if voice in valid:
            return voice
        raise ValueError(f"Voice '{voice}' is not valid for qwen3 provider.")
    if name == "piper":
        # Piper voices are discovered from .onnx files in the voices dir
        # or from voice_configs. The provider already handles this.
        try:
            # We use the provider's list_voices which is now dynamic.
            # Since _validate_voice_for_provider is sync, and list_voices
            # is async in the provider (due to other providers), but for
            # Piper it just returns a list, we might need to handle it.
            # Actually, PiperTTSProvider.list_voices is async.
            # For validation, we can use the sync config manager or 
            # just allow it if it matches the dynamic pattern.
            
            # Better: use the voice_configs manager but ALSO check 
            # if the model exists on disk.
            if hasattr(provider, "_config_manager"):
                if provider._config_manager.has_voice(voice):
                    return voice
            
            # Pattern check for dynamic voices: model or model::speaker
            if "::" in voice:
                stem = voice.split("::")[0]
            else:
                stem = voice
            
            if (Path(provider.voices_dir) / f"{stem}.onnx").exists():
                return voice

            raise ValueError(f"Voice '{voice}' is not valid for piper provider.")
        except ValueError:
            raise
        except Exception:
            return voice
    return voice


def _first_available_voice(provider) -> str | None:
    """Return the first available voice id for *provider*, or None."""
    name = getattr(provider, "provider_name", "")
    if name == "qwen3":
        from kali_core.voice.providers.qwen import PREDEFINED_VOICES, VOICE_DESIGN_PRESETS
        variant = getattr(provider, "tts_variant", "customvoice")
        if variant == "voicedesign" and VOICE_DESIGN_PRESETS:
            return VOICE_DESIGN_PRESETS[0]["id"]
        if PREDEFINED_VOICES:
            return PREDEFINED_VOICES[0]["id"]
        return None
    if name == "piper":
        try:
            # 1. Try configured voices
            if hasattr(provider, "_config_manager"):
                voices = provider._config_manager.list_voices()
                if voices:
                    return voices[0]["voice_id"]
            
            # 2. Try discovered models
            onnx_files = sorted(Path(provider.voices_dir).glob("*.onnx"))
            if onnx_files:
                return onnx_files[0].stem
            return None
        except Exception:
            return None
    return None


_TAG_RE = re.compile(r"<[^>]+>")


def _artifact_preview(content: str, limit: int = 200) -> str:
    """Strip HTML/markdown tags and return a short preview string."""
    if not content:
        return ""
    text = _TAG_RE.sub("", content).strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + "…"
    return text


def _build_llm_provider() -> LLMProvider | None:
    cfg = load_ai_config()
    if not cfg.api_url:
        logger.warning("No LLM API URL configured — LLM features disabled")
        return None
    if cfg.provider == "nanobot":
        return NanobotLLMProvider()
    return DirectLLMProvider(api_url=cfg.api_url, api_key=cfg.api_key, model=cfg.model, max_tokens=cfg.max_tokens)


def _build_tts_provider():
    if settings.tts_provider == "http":
        return HTTPTTSProvider()
    if settings.tts_provider in ("qwen3", "qwen3-voicedesign"):
        voice_design = settings.tts_provider == "qwen3-voicedesign"
        # Discover codec/tokenizer in the models dir.
        models_dir = Path(settings.tts_models_dir)
        codec_files = list(models_dir.glob("qwen-tokenizer-12hz-*.gguf")) if models_dir.exists() else []
        codec_model = str(codec_files[0]) if codec_files else str(models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf")
        return QwenTTSProvider(
            talker_models_dir=settings.tts_models_dir,
            codec_model=codec_model,
            port=settings.qwen_port,
            backend=settings.qwen_backend,
            voice_design=voice_design,
        )
    # "piper", "inproc", and any other value -> PiperTTSProvider (via compat shim)
    return InProcTTSProvider()


def _build_tts_provider_with_fallback(configured_id: str | None = None):
    """Build the configured TTS provider, falling back through the chain on failure.

    Returns (provider, error_or_none). On failure of the configured id, tries
    the fallback chain (qwen3->piper->unavailable). The error string is surfaced
    to the UI via config_warnings. The qwen3-voicedesign env id maps to qwen3
    with an immediate load_model("1.7b-voicedesign") call for backward compat.
    """
    from kali_core.voice.providers import get_tts_provider, get_tts_fallback

    configured_id = configured_id or settings.tts_provider
    if configured_id == "qwen3-voicedesign":
        configured_id = "qwen3"
        desired_model = "qwen3-tts-1.7b-voicedesign"
    elif configured_id == "inproc":
        configured_id = "piper"
        desired_model = None
    else:
        desired_model = None

    chain = [configured_id]
    nxt = get_tts_fallback(configured_id)
    while nxt != chain[-1] and nxt != "unavailable":
        chain.append(nxt)
        nxt = get_tts_fallback(nxt)
    chain.append("unavailable")

    last_error = None
    fell_back = False
    for pid in chain:
        try:
            provider = get_tts_provider(pid)
            if pid == "qwen3":
                initial = desired_model
                if not initial:
                    models = provider.list_models()
                    available = [m for m in models if m.available]
                    if available:
                        initial = available[0].id
                if initial:
                    provider.load_model(initial, settings.qwen_backend)
            elif desired_model and hasattr(provider, "load_model"):
                provider.load_model(desired_model)
            return provider, (last_error if fell_back else None)
        except Exception as exc:
            last_error = f"{pid}: {exc}"
            fell_back = True
            logger.warning("TTS provider '%s' failed to start: %s — trying fallback", pid, exc)
    null_provider = get_tts_provider("unavailable")
    null_provider._error = last_error or "all TTS providers failed"
    return null_provider, last_error


def _build_stt_provider_with_fallback(configured_id: str | None = None):
    """Build the configured STT provider, falling back on failure.

    Returns (provider, error_or_none). Chain: configured -> vosk -> unavailable.
    """
    from kali_core.ear.providers import get_stt_provider
    from kali_core.voice.providers.null import NullTTSProvider

    configured_id = configured_id or settings.stt_provider
    chain = [configured_id]
    if configured_id != "vosk":
        chain.append("vosk")
    chain.append("unavailable")

    last_error = None
    fell_back = False
    for pid in chain:
        if pid == "unavailable":
            null = NullTTSProvider(error=last_error or "all STT providers failed")
            return null, last_error
        try:
            provider = get_stt_provider(pid)
            if pid == settings.stt_provider and pid != "qwen3":
                provider.load_model(settings.stt_model)
            elif pid == "qwen3":
                if hasattr(provider, "configure"):
                    provider.configure(models_dir=settings.qwen_asr_models_dir)
                provider.set_streaming(settings.qwen_asr_streaming)
            return provider, (last_error if fell_back else None)
        except Exception as exc:
            last_error = f"{pid}: {exc}"
            fell_back = True
            logger.warning("STT provider '%s' failed to start: %s — trying fallback", pid, exc)
    null = NullTTSProvider(error=last_error or "all STT providers failed")
    return null, last_error


def _build_stt_provider():
    provider = get_stt_provider(settings.stt_provider)
    if settings.stt_provider == "qwen3":
        if hasattr(provider, "configure"):
            provider.configure(models_dir=settings.qwen_asr_models_dir)
        provider.set_streaming(settings.qwen_asr_streaming)
    else:
        provider.load_model(settings.stt_model)
    return provider


def _register_tools() -> None:
    """Register all available tools in the tool registry."""
    register(FsReadTool())
    register(FsListTool())
    register(RunCommandTool())
    register(WebSearchTool())
    register(WebFetchTool())
    # Phase 2 tools.
    register(RunTestsTool())
    register(GitWorktreeTool())
    register(GitDiffTool())
    register(LaunchAppTool())
    register(OrganizeFolderTool())
    # Phase 3 tools.
    register(ListMonitorsTool())
    register(ScreenshotTool())
    # Phase 4 tools.
    register(FetchGameResourceTool())
    # Generic artifact generation (documents, diagrams, tables, code, etc.).
    register(CreateArtifactTool())
    # Artifact management (list, inspect, update existing artifacts).
    register(ListArtifactsTool())
    register(GetArtifactTool())
    register(UpdateArtifactTool())
    register(GetArtifactConsoleTool())
    # Phase 5 — Dota 2 live match state via GSI.
    register(DotaLiveStateTool())
    # Phase 6 — kali-toys game lifecycle tools.
    register(GameStartTool())
    register(GameActionTool())
    register(GameEndTool())
    # STT post-processing (applied automatically, not user-visible).
    register(SttCorrectorTool())


def _build_tool_defs() -> list[ToolDef]:
    """Convert registered tools to ToolDef list for the LLM."""
    return [
        ToolDef(
            name=tool.name,
            description=tool.description,
            schema=tool.schema,
        )
        for tool in available_tools()
    ]


class Server:
    """WebSocket server host."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8900) -> None:
        self.host = host
        self.port = port
        self.app = FastAPI(title="Kali Core")
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        # Shared components — built with fallback chains so a failing
        # provider degrades gracefully instead of crashing the whole server.
        self._config_warnings: dict[str, str] = {}
        self.llm_provider = _build_llm_provider()
        self.tts_provider, tts_err = _build_tts_provider_with_fallback()
        if tts_err:
            self._config_warnings["tts_provider"] = (
                f"TTS provider could not be loaded ({tts_err}). "
                f"Fell back to '{self.tts_provider.provider_name}'. "
                f"Check the model/binary paths in Settings."
            )
        self.tts_available = getattr(self.tts_provider, "is_available", True)
        self.tts_error = getattr(self.tts_provider, "last_error", None)
        self.stt_provider, stt_err = _build_stt_provider_with_fallback()
        if stt_err:
            self._config_warnings["stt_provider"] = (
                f"STT provider could not be loaded ({stt_err}). "
                f"Fell back to '{self.stt_provider.provider_name}'. "
                f"Check the model paths in Settings."
            )
        self.stt_available = getattr(self.stt_provider, "is_available", True)
        self.stt_error = getattr(self.stt_provider, "last_error", None)
        if self.llm_provider is None:
            self._config_warnings["llm_provider"] = "warning.no_llm"
        self.agent = AgentRuntime(self.llm_provider)
        # For qwen3 providers, glados-es (the Piper default) is not a valid
        # voice. Fall back to "serena" (first predefined voice) so the UI and
        # the pipeline start in a consistent state.
        default_voice = settings.tts_voice
        if self.tts_provider.provider_name == "qwen3":
            qwen_voice_ids = {v["id"] for v in PREDEFINED_VOICES}
            if default_voice not in qwen_voice_ids:
                default_voice = "serena"
        self.tts_pipeline = TTSPipeline(
            self.tts_provider,
            voice=default_voice,
            mode=settings.tts_mode,
            auto_tts=settings.tts_enabled,
        )
        self.voice_configs = VoiceConfigManager(settings.voice_configs_dir)
        # Permissions + consent.
        self.gateway = PermissionGateway()
        self.consent = ConsentMgr()
        # Register tools + set up executor.
        _register_tools()
        self.tool_defs = _build_tool_defs()
        self.gaze_client = GazeClient()
        # Console log requester — agent→frontend request/response for runtime logs.
        self.console_requester = ConsoleRequester()
        # Session store (SQLite, kali-nest) — needed by executor for artifact persistence.
        self.session_store = SessionStore(settings.db_path)
        # Job system (background tasks with progress, logs, cancellation).
        self.job_store = JobStore(settings.db_path)
        self.job_mgr = JobManager(self.job_store)
        self.job_mgr.register_handler("game_image_download", download_game_images_handler)
        self.executor = Executor(
            gateway=self.gateway,
            consent=self.consent,
            working_dir=str(Path.cwd()),
            profile=settings.active_profile,
            gaze_client=self.gaze_client,
            llm_provider=self.llm_provider,
            session_store=self.session_store,
            job_mgr=self.job_mgr,
            console_requester=self.console_requester,
        )
        # Wire executor + tools into the agent.
        self.agent.set_executor(self.executor)
        self.agent.set_tools(self.tool_defs)
        self.agent.set_session_store(self.session_store)
        self._connections: list[Connection] = []
        self.connections_store = ConnectionsStore()
        self.game_session_service = GameSessionService()
        # Config warnings collected on startup replay (setting_key → message).
        # Surfaced to the frontend via the `config_warnings` status field so
        # the UI can show a banner about settings that couldn't be restored.
        self._config_warnings: dict[str, str] = {}
        self._apply_server_level_user_config()
        self._register_routes()

    async def broadcast(self, payload: dict[str, Any]) -> None:
        for conn in list(self._connections):
            try:
                await conn.send(payload)
            except Exception:
                pass

    async def broadcast_status(self) -> None:
        """Send a full, per-connection status to all connected clients."""
        for conn in list(self._connections):
            try:
                await conn._emit_status()
            except Exception:
                pass

    def _build_status_payload(self) -> dict[str, Any]:
        try:
            cfg = load_ai_config()
        except Exception:
            cfg = AIConfig()
        try:
            conns = self.connections_store.list()
        except Exception:
            conns = []
        summaries = []
        for c in conns:
            try:
                summaries.append({
                    "id": c.id,
                    "name": c.name,
                    "kind": c.kind,
                    "api_url": c.api_url,
                    "api_format": c.api_format,
                    "vendor_detected": c.vendor_detected,
                    "model_count": len(c.models),
                    "is_active": cfg.connection_id == c.id,
                    "active_model": (
                        getattr(self.llm_provider, "_model", None)
                        if cfg.connection_id == c.id
                        else None
                    ),
                })
            except Exception:
                continue
        return {
            "event": "status",
            "llm_provider": getattr(self.llm_provider, "provider_name", "") if self.llm_provider else "",
            "llm_api_url": getattr(self.llm_provider, "_api_url", settings.llm_api_url) if self.llm_provider else settings.llm_api_url,
            "llm_api_key_set": bool(getattr(self.llm_provider, "_api_key", "")) if self.llm_provider else False,
            "llm_model": getattr(self.llm_provider, "_model", settings.llm_model) if self.llm_provider else settings.llm_model,
            "llm_max_tokens": getattr(self.llm_provider, "_max_tokens", settings.llm_max_tokens) if self.llm_provider else settings.llm_max_tokens,
            "llm_connection_id": cfg.connection_id,
            "llm_connection_name": next(
                (c.name for c in conns if c.id == cfg.connection_id), None
            ),
            "connections": summaries,
            "tts_provider": self.tts_provider.provider_name,
            "voice": self.tts_pipeline.voice,
            "tts_mode": self.tts_pipeline.mode,
            "auto_tts": self.tts_pipeline.auto_tts,
            "tts_loaded": getattr(self.tts_provider, "is_loaded", False),
            "tts_model": getattr(self.tts_provider, "loaded_model", None),
            "tts_device": getattr(self.tts_provider, "device", None),
            "tts_available": self.tts_available,
            "tts_error": self.tts_error,
            "tts_variant": getattr(self.tts_provider, "tts_variant", None),
            "capture_backend": "mss" if self.gaze_client.connected else "none",
            "profile": self.executor.profile,
            "stt_provider": self.stt_provider.provider_name,
            "stt_model": self.stt_provider.loaded_model,
            "stt_device": self.stt_provider.device,
            "stt_loaded": self.stt_provider.is_loaded,
            "stt_streaming": getattr(self.stt_provider, "_streaming", True),
            "stt_models_dir": str(getattr(self.stt_provider, "_models_dir", "")),
            "tts_models_dir": str(getattr(self.tts_provider, "_talker_models_dir", settings.tts_models_dir)),
            "game_session_path": str(settings.game_session_path),
            "game_ai_global_timeout_ms": settings.game_ai_global_timeout_ms,
            "game_connection_id": settings.game_connection_id,
            "game_model": settings.game_model,
            "game_temperature": settings.game_temperature,
            "game_max_tokens": settings.game_max_tokens,
            "game_reasoning_max_chars": settings.game_reasoning_max_chars,
            "game_retry_timeout_1_ms": settings.game_retry_timeouts[0] if len(settings.game_retry_timeouts) > 0 else 12000,
            "game_retry_timeout_2_ms": settings.game_retry_timeouts[1] if len(settings.game_retry_timeouts) > 1 else 3000,
            "game_retry_timeout_3_ms": settings.game_retry_timeouts[2] if len(settings.game_retry_timeouts) > 2 else 2000,
            "game_max_retries": settings.game_max_retries,
        }
        if self._config_warnings:
            payload["config_warnings"] = list(self._config_warnings.values())
        return payload

    async def _activate_connection(self, conn: SavedConnection, model: str) -> None:
        """Hot-swap the live LLM provider to a saved connection + model."""
        cfg = load_ai_config()
        cfg.connection_id = conn.id
        cfg.api_url = conn.api_url
        cfg.api_key = conn.api_key
        cfg.model = model
        cfg.provider = "direct"
        save_ai_config(cfg)
        if self.llm_provider is None:
            self.llm_provider = DirectLLMProvider(
                api_url=conn.api_url,
                api_key=conn.api_key,
                model=model,
            )
            self.agent.llm = self.llm_provider
            self._config_warnings.pop("llm_provider", None)
        elif hasattr(self.llm_provider, "reconfigure"):
            self.llm_provider.reconfigure(
                api_url=conn.api_url,
                api_key=conn.api_key,
                model=model,
            )
        else:
            # Nanobot-style provider without reconfigure(): mutate attrs.
            if hasattr(self.llm_provider, "_api_url"):
                self.llm_provider._api_url = conn.api_url
            if hasattr(self.llm_provider, "_api_key"):
                self.llm_provider._api_key = conn.api_key
            if hasattr(self.llm_provider, "_model"):
                self.llm_provider._model = model
        logger.info(
            "Connection activated: id=%s name=%s model=%s", conn.id, conn.name, model
        )

    async def _deactivate_connection(self) -> None:
        """Clear the active LLM connection and set the provider to None."""
        cfg = load_ai_config()
        cfg.connection_id = None
        cfg.api_url = ""
        cfg.api_key = ""
        cfg.model = ""
        save_ai_config(cfg)
        self.llm_provider = None
        self.agent.llm = None
        self._config_warnings["llm_provider"] = "warning.no_llm"
        logger.info("Connection deactivated — no provider active")

    def _register_routes(self) -> None:
        # Static file serving for cached images.
        images_dir = Path(settings.images_dir)
        images_dir.mkdir(parents=True, exist_ok=True)
        self.app.mount("/images", StaticFiles(directory=str(images_dir)))

        # Static file serving for screen capture snapshots (kali-gaze).
        # Lets the frontend render screenshots inline via <img src="/snapshots/...">.
        snapshots_dir = Path(settings.snapshots_dir)
        snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.app.mount("/snapshots", StaticFiles(directory=str(snapshots_dir)))

        # Generic file-serving endpoint: lets the agent display any image
        # from an allowed directory on the user's PC. Path traversal is
        # blocked by resolving the requested path and checking it stays
        # inside one of the allowed roots.
        _FILE_SERVE_ROOTS = [
            Path(settings.data_dir).resolve(),
            Path.home() / "Pictures",
            Path.home() / "Downloads",
            Path.cwd(),
        ]

        @self.app.get("/file")
        async def serve_file(path: str) -> Any:
            from fastapi.responses import FileResponse

            if not path:
                return {"error": "missing 'path' query param"}
            req_path = Path(path).expanduser()
            # If the path is relative, resolve against the cwd.
            if not req_path.is_absolute():
                req_path = (Path.cwd() / req_path).resolve()
            else:
                req_path = req_path.resolve()
            # Security: block directory traversal. The requested path
            # must be inside one of the allowed roots.
            allowed = any(
                req_path == root or root in req_path.parents
                for root in _FILE_SERVE_ROOTS
            )
            if not allowed:
                return {"error": f"path '{path}' is outside allowed directories"}
            if not req_path.is_file():
                return {"error": f"file not found: {path}"}
            # Guess MIME from extension; fall back to octet-stream.
            import mimetypes

            media, _ = mimetypes.guess_type(str(req_path))
            return FileResponse(str(req_path), media_type=media or "application/octet-stream")

        # Artifact content endpoint — lets the frontend fetch the full
        # content of a closed artifact by id when the user reopens it.
        # Used by the "Artefactos" library beacon: closed artifacts keep
        # only metadata in memory; content is fetched on demand here.
        @self.app.get("/sessions/{session_id}/artifacts/{artifact_id}")
        async def get_artifact(session_id: str, artifact_id: str) -> Any:
            art = await self.session_store.get_artifact(session_id, artifact_id)
            if art is None:
                raise HTTPException(status_code=404, detail="artifact not found")
            wt = art.get("window_type") or ""
            if not wt:
                from kali_core.canvas.registry import resolve_window_type as _rwt
                wt = _rwt(art.get("type", ""))
            return {
                "id": art["id"],
                "type": art["type"],
                "windowType": wt,
                "title": art["title"],
                "content": art["content"],
                "language": art.get("language", ""),
            }

        @self.app.websocket("/ws")
        async def ws_endpoint(ws: WebSocket) -> None:
            await ws.accept()
            conn = Connection(ws, self)
            self._connections.append(conn)
            try:
                await conn.run()
            except WebSocketDisconnect:
                logger.info("frontend disconnected")
            except Exception:
                logger.exception("connection error")
            finally:
                self._connections.remove(conn)

        @self.app.get("/health")
        async def health() -> dict[str, Any]:
            return {"status": "ok", "version": "0.1.0"}

        @self.app.get("/voices")
        async def voices(provider: str | None = None, variant: str | None = None) -> dict[str, Any]:
            from kali_core.voice.providers import get_tts_provider
            target_provider = provider if provider else self.tts_provider.provider_name
            # variant here represents the model_id for qwen3/piper
            target_variant = variant

            if target_provider == "qwen3":
                qwen_provider = get_tts_provider("qwen3")
                return {"voices": await qwen_provider.list_voices(target_variant), "provider": "qwen3", "variant": target_variant}
            
            if target_provider == "piper":
                piper_provider = get_tts_provider("piper")
                # For Piper, if variant is provided, we can temporarily filter by it
                # but the user wants it to be based on the LOADED model.
                # However, if they are just browsing, maybe we show all?
                # No, user said: "si no hay modelo cargado.. no se puede seleccionar hablante"
                return {"voices": await piper_provider.list_voices(), "provider": "piper", "variant": target_variant}

            # Fallback for others (http, etc)
            prov = get_tts_provider(target_provider)
            if hasattr(prov, "list_voices"):
                return {"voices": await prov.list_voices(), "provider": target_provider, "variant": target_variant}
            
            return {"voices": [], "provider": target_provider, "variant": target_variant}

        @self.app.get("/voices/custom")
        async def list_custom_voices(provider: str | None = None) -> dict[str, Any]:
            return {"voices": await self.session_store.list_custom_voices(provider)}

        @self.app.post("/voices/custom")
        async def create_custom_voice(request: Request) -> dict[str, Any]:
            body = await request.json()
            name = body.get("name", "").strip()
            provider = body.get("provider", "qwen3")
            instructions = body.get("instructions", "").strip()
            seed = int(body.get("seed", -1))
            if not name:
                return JSONResponse(content={"error": "name is required"}, status_code=400)
            if not instructions:
                return JSONResponse(content={"error": "instructions is required"}, status_code=400)
            voice = await self.session_store.create_custom_voice(name, provider, instructions, seed)
            return {"voice": voice}

        @self.app.put("/voices/custom/{voice_id}")
        async def update_custom_voice(request: Request, voice_id: str) -> dict[str, Any]:
            body = await request.json()
            voice = await self.session_store.update_custom_voice(
                voice_id,
                name=body.get("name"),
                instructions=body.get("instructions"),
                seed=body.get("seed"),
            )
            if not voice:
                return JSONResponse(content={"error": "Voice not found"}, status_code=404)
            return {"voice": voice}

        @self.app.delete("/voices/custom/{voice_id}")
        async def delete_custom_voice(voice_id: str) -> dict[str, Any]:
            deleted = await self.session_store.delete_custom_voice(voice_id)
            if not deleted:
                return JSONResponse(content={"error": "Voice not found"}, status_code=404)
            return {"success": True}

        @self.app.post("/api/tts/preview")
        async def tts_preview(request: Request) -> Any:
            body = await request.json()
            voice_id = body.get("voice_id", "")
            language = body.get("language", "en")
            mode = body.get("mode", "normal")
            provider = body.get("provider", self.tts_provider.provider_name)
            text = body.get("text", "") or get_random_preview_text(language)

            from kali_core.voice.providers import get_tts_provider as _get_tts_provider
            target_provider = _get_tts_provider(provider) if provider != self.tts_provider.provider_name else self.tts_provider
            if not hasattr(target_provider, "preview"):
                return JSONResponse(content={"error": f"Preview not supported by {provider}"}, status_code=400)
            try:
                audio = await target_provider.preview(
                    voice_id=voice_id, text=text, language=language, mode=mode
                )
            except Exception as exc:
                logger.error("tts preview failed: %s", exc)
                return JSONResponse(content={"error": f"TTS engine error: {exc}"}, status_code=500)
            return Response(content=audio, media_type="audio/wav")

        @self.app.post("/api/tts/voice-design")
        async def tts_voice_design(request: Request) -> Any:
            body = await request.json()
            instructions = body.get("instructions", "")
            seed = int(body.get("seed", -1))
            language = body.get("language", "en")
            provider = body.get("provider", "qwen3")
            text = body.get("text", "") or get_random_preview_text(language)
            if not instructions or not instructions.strip():
                return JSONResponse(content={"error": "instructions field is required and cannot be empty"}, status_code=400)

            from kali_core.voice.providers import get_tts_provider as _get_tts_provider
            target_provider = _get_tts_provider(provider) if provider != self.tts_provider.provider_name else self.tts_provider
            if not hasattr(target_provider, "preview"):
                return JSONResponse(content={"error": f"Voice design not supported by {provider}"}, status_code=400)
            try:
                audio = await target_provider.preview(
                    voice_id="serena",
                    instructions=instructions,
                    seed=seed,
                    text=text,
                    language=language,
                )
            except Exception as exc:
                logger.error("voice-design preview failed: %s", exc)
                return JSONResponse(content={"error": f"TTS engine error: {exc}"}, status_code=500)
            return Response(content=audio, media_type="audio/wav")

        @self.app.get("/profiles")
        async def profiles() -> dict[str, Any]:
            return {"profiles": self.gateway.list_profiles()}

        @self.app.post("/gsi/dota")
        async def gsi_dota(request: Request) -> dict[str, str]:
            payload = await request.json()
            gsi_state.update(payload)
            prov = payload.get("provider", {})
            match_id = prov.get("matchid", "?")
            steam_id = prov.get("steamid", "?")
            map_data = payload.get("map", {})
            game_state = map_data.get("game_state", "?")
            hero = payload.get("hero", {})
            hero_name = hero.get("name", "?")
            logger.info(
                "GSI Dota: match=%s steam=%s state=%s hero=%s",
                match_id, steam_id, game_state, hero_name,
            )
            return {"status": "ok"}

        @self.app.get("/gsi/debug")
        async def gsi_debug() -> dict[str, Any]:
            return {"state": gsi_state.state, "in_match": gsi_state.in_match}

        @self.app.get("/llm/scan")
        async def llm_scan(
            host: str = "127.0.0.1",
            from_port: int = 8000,
            to_port: int = 12300,
        ) -> dict[str, Any]:
            from kali_core.mind.llm.scanner import scan_local
            endpoints = await scan_local(host=host, port_from=from_port, port_to=to_port)
            return {
                "endpoints": [
                    {
                        "port": e.port,
                        "url": e.url,
                        "vendor": e.vendor,
                        "models": e.models,
                    }
                    for e in endpoints
                ]
            }

        @self.app.get("/llm/models")
        async def llm_models(api_url: str, api_key: str = "") -> dict[str, Any]:
            from kali_core.mind.llm.scanner import list_models
            models = await list_models(api_url=api_url, api_key=api_key)
            return {"models": models}

        # ── Saved connections (LLM provider CRUD) ───────────────

        def _connection_summary(c: SavedConnection, active_id: str | None) -> dict[str, Any]:
            return {
                "id": c.id,
                "name": c.name,
                "kind": c.kind,
                "api_url": c.api_url,
                "api_format": c.api_format,
                "vendor_detected": c.vendor_detected,
                "model_count": len(c.models),
                "is_active": active_id == c.id,
                "active_model": (
                    getattr(self.llm_provider, "_model", None)
                    if active_id == c.id
                    else None
                ),
            }

        def _summaries() -> list[dict[str, Any]]:
            cfg = load_ai_config()
            return [_connection_summary(c, cfg.connection_id) for c in self.connections_store.list()]

        @self.app.get("/llm/connections")
        async def llm_connections_list() -> dict[str, Any]:
            return {"connections": _summaries()}

        @self.app.post("/llm/connections")
        async def llm_connections_create(request: Request) -> dict[str, Any]:
            body = await request.json()
            try:
                conn = self.connections_store.create(
                    name=str(body.get("name", "")),
                    kind=str(body.get("kind", "local")),
                    api_url=str(body.get("api_url", "")),
                    api_format=str(body.get("api_format", "openai")),
                    api_key=str(body.get("api_key", "")),
                    vendor_detected=str(body.get("vendor_detected", "")),
                    models=list(body.get("models", []) or []),
                )
            except ValueError as exc:
                return JSONResponse(content={"error": str(exc)}, status_code=400)
            await self.broadcast_status()
            return _connection_summary(conn, load_ai_config().connection_id)

        @self.app.put("/llm/connections/{conn_id}")
        async def llm_connections_update(conn_id: str, request: Request) -> dict[str, Any]:
            body = await request.json()
            patch = {k: v for k, v in body.items() if k != "id"}
            updated = self.connections_store.update(conn_id, patch)
            if not updated:
                return JSONResponse(content={"error": "not found"}, status_code=404)
            await self.broadcast_status()
            return _connection_summary(updated, load_ai_config().connection_id)

        @self.app.delete("/llm/connections/{conn_id}")
        async def llm_connections_delete(conn_id: str) -> dict[str, Any]:
            ok = self.connections_store.delete(conn_id)
            if not ok:
                return JSONResponse(content={"error": "not found"}, status_code=404)
            cfg = load_ai_config()
            if cfg.connection_id == conn_id:
                cfg.connection_id = None
                save_ai_config(cfg)
            await self.broadcast_status()
            return {"ok": True}

        @self.app.post("/llm/connections/test")
        async def llm_connections_test(request: Request) -> dict[str, Any]:
            body = await request.json()
            api_url = str(body.get("api_url", "")).strip()
            api_key = str(body.get("api_key", ""))
            if not api_url:
                return JSONResponse(content={"error": "api_url is required"}, status_code=400)
            probe = await probe_endpoint(api_url=api_url, api_key=api_key)
            return {
                "ok": probe.ok,
                "vendor": probe.vendor,
                "models": probe.models,
                "detail": probe.detail,
            }

        @self.app.post("/llm/connections/verify-key")
        async def llm_connections_verify_key(request: Request) -> dict[str, Any]:
            body = await request.json()
            api_url = str(body.get("api_url", "")).strip()
            api_key = str(body.get("api_key", ""))
            if not api_url:
                return JSONResponse(content={"error": "api_url is required"}, status_code=400)
            if not api_key:
                return JSONResponse(content={"error": "api_key is required"}, status_code=400)
            ok, detail = await verify_api_key(api_url=api_url, api_key=api_key)
            return {"ok": ok, "detail": detail}

        @self.app.post("/llm/connections/{conn_id}/activate")
        async def llm_connections_activate(conn_id: str, request: Request) -> dict[str, Any]:
            body = await request.json()
            model = str(body.get("model", "")).strip()
            if not model:
                return JSONResponse(content={"error": "model is required"}, status_code=400)
            conn = self.connections_store.get(conn_id)
            if not conn:
                return JSONResponse(content={"error": "connection not found"}, status_code=404)
            try:
                await self._activate_connection(conn, model)
            except Exception as exc:
                logger.exception("Activate connection failed")
                return JSONResponse(content={"error": str(exc)}, status_code=500)
            await self.broadcast_status()
            return {"ok": True}

        @self.app.get("/llm/cloud-providers")
        async def llm_cloud_providers() -> dict[str, Any]:
            return {
                "providers": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "api_url": p.api_url,
                        "docs_url": p.docs_url,
                        "notes": p.notes,
                    }
                    for p in CLOUD_PROVIDERS
                ]
            }

        # ── STT management ──────────────────────────────────────

        @self.app.get("/stt/providers")
        async def stt_providers() -> dict[str, Any]:
            from kali_core.ear.providers import list_stt_providers
            return {"providers": list_stt_providers()}

        @self.app.get("/stt/models")
        async def stt_models(provider: str | None = None) -> dict[str, Any]:
            import dataclasses
            if provider and provider != self.stt_provider.provider_name:
                from kali_core.ear.providers import get_stt_provider
                temp = get_stt_provider(provider)
                return {
                    "models": [
                        dataclasses.asdict(m) for m in temp.list_models()
                    ]
                }
            return {
                "models": [
                    dataclasses.asdict(m) for m in self.stt_provider.list_models()
                ]
            }

        @self.app.get("/stt/devices")
        async def stt_devices() -> dict[str, Any]:
            devices: list[dict] = []
            try:
                import torch
                for i in range(torch.cuda.device_count()):
                    props = torch.cuda.get_device_properties(i)
                    free, total = torch.cuda.mem_get_info(i)
                    devices.append({
                        "id": f"cuda:{i}",
                        "name": props.name,
                        "vram_total_mb": round(total / 1024**2),
                        "vram_free_mb": round(free / 1024**2),
                    })
            except ImportError:
                try:
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.free",
                         "--format=csv,noheader,nounits"],
                        capture_output=True, text=True, timeout=5
                    )
                    for line in result.stdout.strip().split("\n"):
                        if not line.strip():
                            continue
                        idx, name, total, free = [p.strip() for p in line.split(",")]
                        devices.append({
                            "id": f"cuda:{idx}",
                            "name": name,
                            "vram_total_mb": int(total),
                            "vram_free_mb": int(free),
                        })
                except Exception:
                    pass
            try:
                import psutil
                mem = psutil.virtual_memory()
                devices.append({
                    "id": "cpu",
                    "name": "CPU",
                    "ram_total_mb": round(mem.total / 1024**2),
                    "ram_free_mb": round(mem.available / 1024**2),
                })
            except ImportError:
                devices.append({"id": "cpu", "name": "CPU"})
            return {"devices": devices}

        @self.app.post("/stt/models/{model_id}/load")
        async def stt_load_model(
            model_id: str, device: str = "cpu", provider: str | None = None
        ) -> dict[str, Any]:
            if any(c._stt_session_active for c in self._connections):
                return JSONResponse(
                    content={"error": "Cannot load model during active recording"},
                    status_code=400,
                )
            from kali_core.ear.providers import get_stt_provider
            stt = get_stt_provider(provider) if provider else self.stt_provider
            loop = asyncio.get_event_loop()
            try:
                await loop.run_in_executor(
                    None, stt.load_model, model_id, device
                )
                await self.broadcast_status()
                return {"status": "ready", "model": model_id, "device": device}
            except Exception as exc:
                logger.exception("STT model load failed")
                return JSONResponse(
                    content={"error": str(exc)}, status_code=500
                )

        @self.app.post("/stt/models/unload")
        async def stt_unload_model(provider: str | None = None) -> dict[str, Any]:
            from kali_core.ear.providers import get_stt_provider
            if provider and provider != self.stt_provider.provider_name:
                target = get_stt_provider(provider)
            else:
                target = self.stt_provider
            try:
                target.unload_model()
                if target is self.stt_provider:
                    self.stt_available = getattr(target, "is_available", True)
                    self.stt_error = getattr(target, "last_error", None)
                await self.broadcast_status()
                return {"status": "unloaded"}
            except Exception as exc:
                return JSONResponse(content={"error": str(exc)}, status_code=500)

        @self.app.post("/stt/models/{model_id}/delete")
        async def stt_delete_model(model_id: str, provider: str | None = None) -> dict[str, Any]:
            from kali_core.ear.providers import get_stt_provider
            if provider and provider != self.stt_provider.provider_name:
                target = get_stt_provider(provider)
            else:
                target = self.stt_provider
            try:
                if hasattr(target, "delete_model"):
                    target.delete_model(model_id)
                else:
                    return JSONResponse(content={"error": f"Provider {target.provider_name} does not support deletion"}, status_code=400)
                
                await self.broadcast_status()
                return {"status": "deleted", "model": model_id}
            except Exception as exc:
                logger.exception("STT model deletion failed")
                return JSONResponse(content={"error": str(exc)}, status_code=500)

        @self.app.get("/stt/status")
        async def stt_status() -> dict[str, Any]:
            return {
                "provider": self.stt_provider.provider_name,
                "model": self.stt_provider.loaded_model,
                "device": self.stt_provider.device,
                "loaded": self.stt_provider.is_loaded,
                "streaming": getattr(self.stt_provider, "_streaming", True),
                "models_dir": str(
                    getattr(self.stt_provider, "_models_dir", "")
                ),
            }

        # ── TTS management ───────────────────────────────────────

        @self.app.get("/tts/providers")
        async def tts_providers() -> dict[str, Any]:
            from kali_core.voice.providers import list_tts_providers
            return {"providers": list_tts_providers()}

        @self.app.get("/models/catalog")
        async def models_catalog(provider: str) -> dict[str, Any]:
            from kali_core.model_catalog import get_catalog_dict, get_all_languages
            kwargs = {}
            target_provider = provider
            if provider == "vosk":
                kwargs["stt_models_dir"] = settings.stt_models_dir
            elif provider == "piper":
                kwargs["voices_dir"] = settings.voices_dir
            elif provider == "qwen3":
                # Check context: is it for STT or TTS?
                # For now, let's assume we might want both or distinguish.
                # Actually, in STT tab, provider is 'qwen3' but we want ASR models.
                # In TTS tab, provider is 'qwen3' but we want TTS models.
                # We can look at the current active providers to guess, or 
                # better, let the frontend ask for 'qwen3-asr' or 'qwen3'.
                kwargs["tts_models_dir"] = settings.tts_models_dir
            elif provider == "qwen3-asr":
                kwargs["stt_models_dir"] = settings.qwen_asr_models_dir
            
            models = get_catalog_dict(target_provider, **kwargs)
            languages = get_all_languages(target_provider)
            return {"models": models, "languages": languages}

        @self.app.get("/tts/models")
        async def tts_models(provider: str | None = None) -> dict[str, Any]:
            import dataclasses
            if provider and provider != self.tts_provider.provider_name:
                from kali_core.voice.providers import get_tts_provider
                temp = get_tts_provider(provider)
                return {"models": [dataclasses.asdict(m) for m in temp.list_models()]}
            return {"models": [dataclasses.asdict(m) for m in self.tts_provider.list_models()]}

        @self.app.get("/tts/devices")
        async def tts_devices() -> dict[str, Any]:
            devices: list[dict] = []
            try:
                import torch
                for i in range(torch.cuda.device_count()):
                    props = torch.cuda.get_device_properties(i)
                    free, total = torch.cuda.mem_get_info(i)
                    devices.append({
                        "id": f"cuda{i}",
                        "name": props.name,
                        "vram_total_mb": round(total / 1024**2),
                        "vram_free_mb": round(free / 1024**2),
                    })
            except ImportError:
                try:
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.free",
                         "--format=csv,noheader,nounits"],
                        capture_output=True, text=True, timeout=5
                    )
                    for line in result.stdout.strip().split("\n"):
                        if not line.strip():
                            continue
                        idx, name, total, free = [p.strip() for p in line.split(",")]
                        devices.append({
                            "id": f"cuda{idx}",
                            "name": name,
                            "vram_total_mb": int(total),
                            "vram_free_mb": int(free),
                        })
                except Exception:
                    pass
            try:
                import psutil
                mem = psutil.virtual_memory()
                devices.append({
                    "id": "cpu",
                    "name": "CPU",
                    "ram_total_mb": round(mem.total / 1024**2),
                    "ram_free_mb": round(mem.available / 1024**2),
                })
            except ImportError:
                devices.append({"id": "cpu", "name": "CPU"})
            return {"devices": devices}

        @self.app.post("/tts/models/{model_id}/load")
        async def tts_load_model(
            model_id: str, device: str = "cpu", provider: str | None = None
        ) -> dict[str, Any]:
            from kali_core.voice.providers import get_tts_provider
            if provider and provider != self.tts_provider.provider_name:
                target = get_tts_provider(provider)
            else:
                target = self.tts_provider
            loop = asyncio.get_event_loop()
            try:
                await loop.run_in_executor(None, target.load_model, model_id, device)
                self.tts_available = getattr(target, "is_available", True)
                self.tts_error = getattr(target, "last_error", None)

                # Auto-select first voice if current one is invalid for the new model
                if target == self.tts_provider and hasattr(target, "list_voices"):
                    voices = await target.list_voices()
                    if voices:
                        current_voice = self.tts_pipeline.voice
                        if not any(v["voice_id"] == current_voice for v in voices):
                            new_voice = voices[0]["voice_id"]
                            self.tts_pipeline.set_voice(voice=new_voice)
                            logger.info("Switched voice to '%s' after loading model '%s'", new_voice, model_id)

                await self.broadcast_status()
                return {"status": "ready", "model": model_id, "device": device}
            except Exception as exc:
                logger.exception("TTS model load failed")
                return JSONResponse(content={"error": str(exc)}, status_code=500)

        @self.app.post("/tts/models/unload")
        async def tts_unload_model(provider: str | None = None) -> dict[str, Any]:
            from kali_core.voice.providers import get_tts_provider
            if provider and provider != self.tts_provider.provider_name:
                target = get_tts_provider(provider)
            else:
                target = self.tts_provider
            try:
                target.unload_model()
                if target is self.tts_provider:
                    self.tts_available = getattr(target, "is_available", True)
                    self.tts_error = getattr(target, "last_error", None)
                await self.broadcast_status()
                return {"status": "unloaded"}
            except Exception as exc:
                return JSONResponse(content={"error": str(exc)}, status_code=500)

        @self.app.post("/tts/models/{model_id}/delete")
        async def tts_delete_model(model_id: str, provider: str | None = None) -> dict[str, Any]:
            from kali_core.voice.providers import get_tts_provider
            if provider and provider != self.tts_provider.provider_name:
                target = get_tts_provider(provider)
            else:
                target = self.tts_provider
            try:
                if hasattr(target, "delete_model"):
                    target.delete_model(model_id)
                else:
                    return JSONResponse(content={"error": f"Provider {target.provider_name} does not support deletion"}, status_code=400)
                
                await self.broadcast_status()
                return {"status": "deleted", "model": model_id}
            except Exception as exc:
                logger.exception("TTS model deletion failed")
                return JSONResponse(content={"error": str(exc)}, status_code=500)

        @self.app.get("/tts/status")
        async def tts_status() -> dict[str, Any]:
            return {
                "provider": self.tts_provider.provider_name,
                "model": getattr(self.tts_provider, "loaded_model", None),
                "device": getattr(self.tts_provider, "device", None),
                "loaded": getattr(self.tts_provider, "is_loaded", False),
                "available": self.tts_available,
                "error": self.tts_error,
                "variant": getattr(self.tts_provider, "tts_variant", None),
            }

    async def run(self) -> None:
        config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="info",
            ws_max_size=50 * 1024 * 1024,
        )
        server = uvicorn.Server(config)
        await server.serve()

    # ── User config replay ──────────────────────────────────

    _SERVER_LEVEL_KEYS = (
        "tts_provider",
        "tts_model",
        "tts_device",
        "voice",
        "tts_mode",
        "auto_tts",
        "stt_provider",
        "stt_model",
        "stt_device",
        "stt_streaming",
        "stt_models_dir",
        "tts_models_dir",
        "profile",
        "artifact_diff_preview",
        "game_session_path",
        "game_ai_global_timeout_ms",
        "game_connection_id",
        "game_model",
        "game_temperature",
        "game_max_tokens",
        "game_retry_timeout_1_ms",
        "game_retry_timeout_2_ms",
        "game_retry_timeout_3_ms",
        "game_max_retries",
        "game_reasoning_max_chars",
    )

    def _get_fallback(self, key: str):
        """Return the env-var default for a setting key, or None."""
        if key == "voice":
            fallback = _first_available_voice(self.tts_provider)
            if fallback:
                return fallback
            return settings.tts_voice
        mapping = {
            "tts_provider": settings.tts_provider,
            "tts_model": None,
            "tts_device": "cpu",
            "tts_mode": settings.tts_mode,
            "auto_tts": settings.tts_enabled,
            "stt_provider": settings.stt_provider,
            "stt_model": settings.stt_model,
            "stt_device": "cpu",
            "stt_streaming": settings.qwen_asr_streaming,
            "stt_models_dir": settings.qwen_asr_models_dir,
            "tts_models_dir": settings.tts_models_dir,
            "profile": settings.active_profile,
            "artifact_diff_preview": settings.artifact_diff_preview,
            "stt_language": settings.stt_language,
            "stt_vad_enabled": settings.stt_vad_enabled,
            "stt_vad_mode": settings.stt_vad_mode,
            "stt_vad_silence_timeout": settings.stt_vad_silence_timeout,
            "stt_vad_auto_calibrate": settings.stt_vad_auto_calibrate,
            "stt_vad_rms_threshold": settings.stt_vad_rms_threshold,
            "wake_word_enabled": settings.stt_wake_word_enabled,
            "input_mode": settings.input_mode,
            "feedback_mode": "minimal",
            "plan_mode": False,
            "voice_instructions": "",
            "voice_seed": -1,
            "game_session_path": None,
            "game_ai_global_timeout_ms": settings.game_ai_global_timeout_ms,
            "game_connection_id": settings.game_connection_id,
            "game_model": settings.game_model,
            "game_temperature": settings.game_temperature,
            "game_max_tokens": settings.game_max_tokens,
            "game_retry_timeout_1_ms": settings.game_retry_timeouts[0] if len(settings.game_retry_timeouts) > 0 else 12000,
            "game_retry_timeout_2_ms": settings.game_retry_timeouts[1] if len(settings.game_retry_timeouts) > 1 else 3000,
            "game_retry_timeout_3_ms": settings.game_retry_timeouts[2] if len(settings.game_retry_timeouts) > 2 else 2000,
            "game_max_retries": settings.game_max_retries,
        }
        return mapping.get(key)

    def _apply_server_level_user_config(self) -> None:
        """Replay server-level user config on startup, collecting warnings.

        Each setting is applied in its own try/except.  On failure, a warning
        is recorded and the env-var fallback is applied instead (without
        recursing on a second failure).
        """
        cfg = load_user_config()
        for key in self._SERVER_LEVEL_KEYS:
            value = getattr(cfg, key, None)
            if value is None:
                continue
            self._apply_server_setting(key, value, _is_fallback=False)

    def _apply_server_setting(self, key: str, value: Any, _is_fallback: bool = False) -> None:
        """Apply a single server-level setting with try/except + fallback."""
        try:
            if key == "tts_provider":
                from kali_core.voice.providers import get_tts_provider
                mapped = "piper" if value == "inproc" else ("qwen3" if value == "qwen3-voicedesign" else value)
                new_provider = get_tts_provider(mapped)
                if new_provider.provider_name != self.tts_provider.provider_name:
                    if hasattr(self.tts_provider, "shutdown"):
                        self.tts_provider.shutdown()
                    if mapped == "qwen3" and not getattr(new_provider, "is_loaded", False):
                        models = new_provider.list_models()
                        available = [m for m in models if m.available]
                        if available:
                            new_provider.load_model(available[0].id, settings.qwen_backend)
                    self.tts_provider = new_provider
                    try:
                        sanitized_voice = _validate_voice_for_provider(self.tts_pipeline.voice, new_provider)
                    except ValueError:
                        sanitized_voice = _first_available_voice(new_provider) or self.tts_pipeline.voice
                    self.tts_pipeline = TTSPipeline(
                        self.tts_provider,
                        voice=sanitized_voice,
                        mode=self.tts_pipeline.mode,
                        auto_tts=self.tts_pipeline.auto_tts,
                    )
                    self.tts_available = getattr(new_provider, "is_available", True)
                    self.tts_error = getattr(new_provider, "last_error", None)
            elif key == "tts_model":
                if hasattr(self.tts_provider, "load_model"):
                    self.tts_provider.load_model(value, self.tts_provider.device or "cpu")
                    self.tts_available = getattr(self.tts_provider, "is_available", True)
                    self.tts_error = getattr(self.tts_provider, "last_error", None)
            elif key == "tts_device":
                if hasattr(self.tts_provider, "is_loaded") and self.tts_provider.is_loaded:
                    current = self.tts_provider.loaded_model
                    self.tts_provider.unload_model()
                    self.tts_provider.load_model(current, value)
            elif key == "voice":
                sanitized = _validate_voice_for_provider(value, self.tts_provider)
                self.tts_pipeline.set_voice(voice=sanitized)
            elif key == "tts_mode":
                self.tts_pipeline.set_voice(mode=value)
            elif key == "auto_tts":
                self.tts_pipeline.set_auto_tts(bool(value))
            elif key == "tts_models_dir":
                if hasattr(self.tts_provider, "configure"):
                    was_loaded = getattr(self.tts_provider, "is_loaded", False)
                    current_model = getattr(self.tts_provider, "loaded_model", None)
                    current_device = getattr(self.tts_provider, "device", None)
                    if was_loaded:
                        self.tts_provider.unload_model()
                    self.tts_provider.configure(models_dir=value)
                    if was_loaded and current_model:
                        self.tts_provider.load_model(current_model, current_device or "cpu")
            elif key == "stt_provider":
                if value != self.stt_provider.provider_name:
                    self.stt_provider = get_stt_provider(value)
                    if value == "qwen3" and hasattr(self.stt_provider, "configure"):
                        self.stt_provider.configure(models_dir=settings.qwen_asr_models_dir)
            elif key == "stt_model":
                self.stt_provider.load_model(value, "cpu")
            elif key == "stt_device":
                # Validate CUDA availability before applying.
                if isinstance(value, str) and (value == "cuda" or value.startswith("cuda:")):
                    try:
                        import torch
                        if not torch.cuda.is_available():
                            raise RuntimeError(f"CUDA not available, requested device '{value}'")
                        if ":" in value:
                            idx = int(value.split(":")[1])
                            if idx >= torch.cuda.device_count():
                                raise RuntimeError(f"Device '{value}' not available (only {torch.cuda.device_count()} GPU(s))")
                    except ImportError:
                        pass  # no torch — skip validation
                if self.stt_provider.is_loaded:
                    current_model = self.stt_provider.loaded_model
                    self.stt_provider.unload_model()
                    self.stt_provider.load_model(current_model, value)
            elif key == "stt_streaming":
                self.stt_provider.set_streaming(bool(value))
            elif key == "stt_models_dir":
                if hasattr(self.stt_provider, "configure"):
                    was_loaded = self.stt_provider.is_loaded
                    current_model = self.stt_provider.loaded_model
                    current_device = self.stt_provider.device
                    if was_loaded:
                        self.stt_provider.unload_model()
                    self.stt_provider.configure(models_dir=value)
                    if was_loaded and current_model:
                        self.stt_provider.load_model(current_model, current_device or "cpu")
            elif key == "profile":
                self.executor.profile = value
            elif key == "artifact_diff_preview":
                settings.artifact_diff_preview = bool(value)
            elif key == "game_session_path":
                if value:
                    settings.game_session_path = Path(value).expanduser()
                else:
                    settings.game_session_path = Path.home() / ".kali" / "game-sessions"
            elif key == "game_ai_global_timeout_ms":
                settings.game_ai_global_timeout_ms = int(value)
            elif key == "game_connection_id":
                settings.game_connection_id = str(value)
            elif key == "game_model":
                settings.game_model = str(value)
            elif key == "game_temperature":
                settings.game_temperature = float(value)
            elif key == "game_max_tokens":
                settings.game_max_tokens = int(value)
            elif key == "game_reasoning_max_chars":
                settings.game_reasoning_max_chars = int(value)
            elif key == "game_retry_timeout_1_ms":
                if len(settings.game_retry_timeouts) > 0:
                    settings.game_retry_timeouts[0] = int(value)
            elif key == "game_retry_timeout_2_ms":
                if len(settings.game_retry_timeouts) > 1:
                    settings.game_retry_timeouts[1] = int(value)
            elif key == "game_retry_timeout_3_ms":
                if len(settings.game_retry_timeouts) > 2:
                    settings.game_retry_timeouts[2] = int(value)
            elif key == "game_max_retries":
                settings.game_max_retries = int(value)
            else:
                return
            # Success — clear any previous warning for this key.
            self._config_warnings.pop(key, None)
        except Exception as exc:
            if _is_fallback:
                logger.warning("Fallback for '%s' also failed: %s", key, exc)
                return
            logger.warning("User config '%s' could not be applied (%s) — using default", key, exc)
            self._config_warnings[key] = str(exc)
            fallback = self._get_fallback(key)
            if fallback is not None and fallback != value:
                self._apply_server_setting(key, fallback, _is_fallback=True)


class Connection:
    """One frontend session. Dispatches events and streams responses."""

    def __init__(self, ws: WebSocket, server: Server) -> None:
        self.ws = ws
        self.server = server
        self.session_id: str | None = None
        self._current_task: asyncio.Task | None = None
        self._send_lock = asyncio.Lock()
        self._stt_session_active: bool = False
        self._wake_word: WakeWordDetector | None = None
        self._stt_enabled: bool = False
        self._stt_language: str = normalize(settings.stt_language)
        self._wake_word_enabled: bool = settings.stt_wake_word_enabled
        self._input_mode: str = settings.input_mode
        self._ui_language: str = "en"
        self._feedback_mode: str = "minimal"
        self._plan_mode: bool = False
        self._voice_instructions: str = ""
        self._voice_seed: int = -1
        # VAD (Voice Activity Detection) — silence-based auto-end in wake word mode.
        # NOTE: Auto-end is now handled by the frontend (RMS-based gate). The
        # backend VAD is kept only for optional state reporting; the silence
        # timeout logic below has been removed.
        self._stt_vad_enabled: bool = settings.stt_vad_enabled
        self._stt_vad_mode: int = settings.stt_vad_mode
        self._stt_vad_silence_timeout: float = settings.stt_vad_silence_timeout
        self._stt_vad_auto_calibrate: bool = settings.stt_vad_auto_calibrate
        self._stt_vad_rms_threshold: float = settings.stt_vad_rms_threshold
        self._vad: Any = None  # webrtcvad.Vad — lazy init
        self._vad_buffer = bytearray()
        self._vad_silence_frames = 0
        self._last_vad_is_speech: bool = False
        self._recording_start_time: float | None = None
        self._max_recording_duration: float = 180.0  # safety timeout (seconds)
        self._pending_final_text: str | None = None  # PTT: provider internal final held until audio_end
        self._recording_origin: str | None = None  # manual / wake_word / continuous
        # Replay per-connection user config (overrides env defaults above).
        cfg = load_user_config()
        if cfg.stt_enabled is not None:
            self._stt_enabled = bool(cfg.stt_enabled)
        if cfg.stt_language is not None:
            self._stt_language = normalize(cfg.stt_language)
        if cfg.ui_language is not None:
            self._ui_language = normalize(cfg.ui_language)
        if cfg.stt_vad_enabled is not None:
            self._stt_vad_enabled = bool(cfg.stt_vad_enabled)
        if cfg.stt_vad_mode is not None:
            self._stt_vad_mode = int(cfg.stt_vad_mode)
        if cfg.stt_vad_silence_timeout is not None:
            self._stt_vad_silence_timeout = float(cfg.stt_vad_silence_timeout)
        if cfg.stt_vad_auto_calibrate is not None:
            self._stt_vad_auto_calibrate = bool(cfg.stt_vad_auto_calibrate)
        if cfg.stt_vad_rms_threshold is not None:
            self._stt_vad_rms_threshold = float(cfg.stt_vad_rms_threshold)
        if cfg.wake_word_enabled is not None:
            self._wake_word_enabled = bool(cfg.wake_word_enabled)
        if cfg.input_mode is not None:
            self._input_mode = str(cfg.input_mode)
        if cfg.feedback_mode is not None:
            self._feedback_mode = str(cfg.feedback_mode)
        if cfg.plan_mode is not None:
            self._plan_mode = bool(cfg.plan_mode)
        if cfg.voice_instructions is not None:
            self._voice_instructions = str(cfg.voice_instructions)
        if cfg.voice_seed is not None:
            self._voice_seed = int(cfg.voice_seed)

    async def run(self) -> None:
        while True:
            message = await self.ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "text" in message and message["text"]:
                try:
                    event = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                await self.dispatch(event)
            elif "bytes" in message and message["bytes"]:
                # Audio chunk from the browser mic (16 kHz 16-bit PCM).
                await self._handle_audio_chunk(message["bytes"])

    async def dispatch(self, event: dict[str, Any]) -> None:
        kind = event.get("event", "")

        if kind == "hello":
            requested_sid = event.get("session_id")
            if requested_sid:
                exists = await self.server.session_store.session_exists(requested_sid)
                if exists:
                    self.session_id = requested_sid
                    if self.server.agent:
                        self.server.agent.reset_history(requested_sid)
                    self.server.consent.set_send_callback(self.send)
                    self.server.job_mgr.set_emit_callback(self.send)
                    await self.send(
                        {"event": "ready", "session_id": requested_sid, "version": "0.1.0"}
                    )
                    await self._emit_status()
                    if self._wake_word_enabled:
                        await self._start_wake_word()
                    msgs = await self.server.session_store.get_messages(requested_sid)
                    for msg in msgs:
                        self.server.agent._get_history(requested_sid).append({
                            "role": msg["role"],
                            "content": msg["content"],
                        })
                        await self.send({
                            "event": "message",
                            "session_id": requested_sid,
                            "role": msg["role"],
                            "text": msg["content"],
                        })
                    artifacts = await self.server.session_store.get_artifacts(requested_sid)
                    for art in artifacts:
                        await self.send({
                            "event": "artifact",
                            "id": art["id"],
                            "type": art["type"],
                            "windowType": art.get("window_type", ""),
                            "title": art["title"],
                            "content": None,
                            "preview": _artifact_preview(art["content"]),
                            "language": art.get("language", ""),
                            "update": "create",
                        })
                    return
            self.server.consent.set_send_callback(self.send)
            self.server.job_mgr.set_emit_callback(self.send)
            await self.send(
                {"event": "ready", "session_id": "", "version": "0.1.0"}
            )
            await self._emit_status()
            if self._wake_word_enabled:
                await self._start_wake_word()

        elif kind == "input":
            content = event.get("content", "")
            selected = event.get("selected_artifacts") or []
            if content:
                if not self.session_id:
                    sess = await self.server.session_store.create_session()
                    self.session_id = sess["id"]
                    if self.server.agent:
                        self.server.agent.reset_history(self.session_id)
                    await self.send({"event": "connected", "session_id": self.session_id})
                await self._handle_input(content, selected_artifacts=selected)

        elif kind == "stop":
            if self._current_task and not self._current_task.done():
                self._current_task.cancel()

        elif kind == "new_session":
            sess = await self.server.session_store.create_session()
            self.session_id = sess["id"]
            if self.server.agent:
                self.server.agent.reset_history(self.session_id)
            await self.send({"event": "connected", "session_id": self.session_id})

        elif kind == "attach_session":
            sid = event.get("session_id", "")
            if sid and await self.server.session_store.session_exists(sid):
                self.session_id = sid
                if self.server.agent:
                    self.server.agent.reset_history(sid)
                self.server.consent.set_send_callback(self.send)
                self.server.job_mgr.set_emit_callback(self.send)
                await self.send({"event": "connected", "session_id": sid})
                await self._emit_status()
                if self._wake_word_enabled:
                    await self._start_wake_word()
                msgs = await self.server.session_store.get_messages(sid)
                for msg in msgs:
                    self.server.agent._get_history(sid).append({
                        "role": msg["role"],
                        "content": msg["content"],
                    })
                    await self.send({
                        "event": "message",
                        "session_id": sid,
                        "role": msg["role"],
                        "text": msg["content"],
                    })
                artifacts = await self.server.session_store.get_artifacts(sid)
                for art in artifacts:
                    await self.send({
                        "event": "artifact",
                        "id": art["id"],
                        "type": art["type"],
                        "windowType": art.get("window_type", ""),
                        "title": art["title"],
                        "content": None,
                        "preview": _artifact_preview(art["content"]),
                        "language": art.get("language", ""),
                        "update": "create",
                    })
            else:
                await self.send({"event": "connected", "session_id": ""})

        elif kind == "list_sessions":
            sessions = await self.server.session_store.list_sessions()
            await self.send({"event": "session_list", "sessions": sessions})

        elif kind == "delete_session":
            session_id = event.get("session_id", "")
            if session_id:
                await self.server.session_store.delete_session(session_id)
            sessions = await self.server.session_store.list_sessions()
            await self.send({"event": "session_list", "sessions": sessions})

        elif kind == "clear_all_sessions":
            await self.server.session_store.delete_all_sessions()
            await self.send({"event": "session_list", "sessions": []})

        elif kind == "settings":
            await self._apply_settings(event)

        elif kind == "download_tts_model":
            asyncio.create_task(self._handle_download_tts_model(event))

        elif kind == "download_stt_model":
            asyncio.create_task(self._handle_download_stt_model(event))

        elif kind == "create_connection":
            try:
                self.server.connections_store.create(
                    name=str(event.get("name", "")),
                    kind=str(event.get("kind", "local")),
                    api_url=str(event.get("api_url", "")),
                    api_format=str(event.get("api_format", "openai")),
                    api_key=str(event.get("api_key", "")),
                    vendor_detected=str(event.get("vendor_detected", "")),
                    models=list(event.get("models", []) or []),
                )
            except ValueError as exc:
                await self.send({"event": "error", "detail": str(exc)})
                return
            await self.server.broadcast_status()

        elif kind == "update_connection":
            cid = str(event.get("id", ""))
            patch = event.get("patch") or {}
            patch = {k: v for k, v in patch.items() if k != "id"}
            if not cid or not self.server.connections_store.update(cid, patch):
                await self.send({"event": "error", "detail": "connection not found"})
                return
            await self.server.broadcast_status()

        elif kind == "delete_connection":
            cid = str(event.get("id", ""))
            if not cid or not self.server.connections_store.delete(cid):
                await self.send({"event": "error", "detail": "connection not found"})
                return
            cfg = load_ai_config()
            if cfg.connection_id == cid:
                await self.server._deactivate_connection()
            await self.server.broadcast_status()

        elif kind == "activate_connection":
            cid = str(event.get("id", ""))
            model = str(event.get("model", "")).strip()
            conn = self.server.connections_store.get(cid) if cid else None
            if not conn:
                await self.send({"event": "error", "detail": "connection not found"})
                return
            if not model:
                await self.send({"event": "error", "detail": "model is required"})
                return
            try:
                await self.server._activate_connection(conn, model)
            except Exception as exc:
                logger.exception("activate_connection failed")
                await self.send({"event": "error", "detail": str(exc)})
                return
            await self.server.broadcast_status()

        elif kind == "deactivate_connection":
            await self.server._deactivate_connection()
            await self.server.broadcast_status()

        elif kind == "audio_start":
            await self._handle_audio_start(event)

        elif kind == "audio_end":
            await self._handle_audio_end()

        elif kind == "consent_response":
            # Resolve a pending consent request.
            request_id = event.get("id", "")
            decision = event.get("decision", "cancel")
            self.server.consent.respond(request_id, decision)

        elif kind == "console_response":
            # Resolve a pending console-log request from the agent.
            request_id = event.get("id", "")
            logs = event.get("logs")
            self.server.console_requester.respond(request_id, logs)

        elif kind == "list_jobs":
            jobs = await self.server.job_mgr.list_jobs()
            await self.send({"event": "job_list", "jobs": jobs})

        elif kind == "cancel_job":
            job_id = event.get("id", "")
            await self.server.job_mgr.cancel(job_id)

        elif kind == "get_job_logs":
            job_id = event.get("id", "")
            logs = await self.server.job_mgr.get_logs(job_id)
            await self.send({"event": "job_list", "logs": logs, "job_id": job_id})

        elif kind == "request_image":
            key = event.get("key", "")
            parts = key.split(":", 2) if key else []
            if len(parts) >= 3:
                game_name, img_type, img_key = parts[0], parts[1], parts[2]
            elif len(parts) == 2:
                game_name, img_type, img_key = "dota", parts[0], parts[1]
            else:
                await self.send({"event": "image_ready", "key": key, "path": "", "error": "invalid key format"})
                return
            adapter = get_adapter(game_name)
            if adapter is None:
                await self.send({"event": "image_ready", "key": key, "path": "", "error": f"unknown game: {game_name}"})
                return
            path_key = f"{game_name}/{img_type}s/{img_key}.png"
            url = adapter._url_for_path(path_key) if hasattr(adapter, "_url_for_path") else ""
            if not url:
                await self.send({"event": "image_ready", "key": key, "path": "", "error": "could not build URL"})
                return
            await self.server.job_mgr.spawn(
                "game_image_download",
                {
                    "images": [{"key": key, "game": game_name, "type": img_type, "url": url, "path": path_key}],
                    "images_dir": settings.images_dir,
                    "db_path": settings.db_path,
                },
                session_id=self.session_id,
            )

        elif kind == "tts_speak":
            text = event.get("text", "")
            if text and self.session_id:
                await self._synthesize_tts(text, self.session_id)

        elif kind == GameSessionWSEvent.START:
            await self._handle_game_session_start(event)
        elif kind == GameSessionWSEvent.TURN:
            await self._handle_game_turn(event)
        elif kind == GameSessionWSEvent.EVENT:
            await self._handle_game_event(event)
        elif kind == GameSessionWSEvent.END:
            await self._handle_game_session_end(event)
        elif kind == GameSessionWSEvent.LIST:
            await self._handle_list_game_sessions(event)
        elif kind == GameSessionWSEvent.LOAD:
            await self._handle_load_game_session(event)
        elif kind == GameSessionWSEvent.DELETE:
            await self._handle_delete_game_session(event)

        elif kind == "game_move":
            await self._handle_game_move(event)

        else:
            logger.debug("unhandled event: %s", kind)

    # ── Game AI (WebSocket) ───────────────────────────────────

    async def _resolve_game_llm_provider(
        self,
        connection_id: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMProvider | None:
        """Return an LLM provider for game moves.

        If game_connection_id is unset or 'active', reuse the server's active LLM.
        Otherwise build a temporary DirectLLMProvider from a saved connection,
        resolving the reference internally — never exposing connection properties
        in StatusEvent.
        """
        gid = connection_id if connection_id is not None else settings.game_connection_id
        if not gid or gid == "active":
            return self.server.llm_provider

        conn = self.server.connections_store.get(gid)
        if not conn:
            logger.warning("[game_move] game_connection_id=%s not found, falling back to active", gid)
            return self.server.llm_provider

        eff_model = model or settings.game_model or (conn.models[0] if conn.models else "")
        if not eff_model:
            logger.warning("[game_move] no model available for connection %s, falling back to active", gid)
            return self.server.llm_provider

        return DirectLLMProvider(
            api_url=conn.api_url,
            api_key=conn.api_key,
            model=eff_model,
            max_tokens=max_tokens if max_tokens is not None else settings.game_max_tokens,
        )

    async def _handle_game_move(self, event: dict[str, Any]) -> None:
        """Handle game_move: stream LLM with game state, emit reasoning chunks,
        and return the final action.

        Strategy: up to 3 progressive attempts.
          1. Normal prompt + JSON mode + reasoning in JSON
          2. Minimal prompt (list of empty cells) + temp=0 + max_tokens=64
          3. Same as 2
        On exhausting all attempts without a valid action, returns MODEL_ERROR
        so the frontend can fall back to the CPU player (not a random move).
        """
        game_type = event.get("game_type", "unknown")
        session_id = self.session_id or event.get("session_id") or "no-session"
        game_session_id = event.get("game_session_id")
        rules = event.get("rules", {})
        game_state = event.get("game_state", {})

        if not game_session_id:
            logger.warning(
                "[game_move] missing required game_session_id | game=%s session=%s",
                game_type, session_id,
            )
            await self.send({
                "event": "game_move_response",
                "game_type": game_type,
                "session_id": session_id,
                "game_session_id": None,
                "action": None,
                "error": {
                    "code": "MODEL_ERROR",
                    "message": "Missing required field: game_session_id",
                    "fallback_action": None,
                },
                "reasoning": "",
                "reasoning_truncated": False,
            })
            return

        # Per-event overrides for game AI params (fall back to global settings).
        eff_temperature = event.get("game_temperature")
        if eff_temperature is None:
            eff_temperature = settings.game_temperature
        eff_max_tokens = event.get("game_max_tokens")
        if eff_max_tokens is None:
            eff_max_tokens = settings.game_max_tokens
        else:
            eff_max_tokens = int(eff_max_tokens)
        eff_connection_id = event.get("game_connection_id") or settings.game_connection_id
        eff_model = event.get("game_model") or settings.game_model

        logger.info(
            "[game_move] received | game=%s session=%s game_session=%s player=%s",
            game_type, session_id, game_session_id, event.get("player_role", "opponent"),
        )

        base_messages = self._build_game_messages(rules, game_state)
        minimal_messages = self._build_minimal_game_messages(game_state)

        # Build attempts dynamically from settings.game_max_retries and
        # settings.game_retry_timeouts. Attempt 1 is "normal" (with rules),
        # attempts 2..N are "minimal" (only empty cells + strict JSON).
        # max_tokens for minimal attempts is scaled up (1.5x) so reasoning
        # models have headroom to think briefly AND emit the JSON answer.
        n_attempts = max(1, settings.game_max_retries)
        timeouts = settings.game_retry_timeouts or [12000, 3000, 2000]
        minimal_max_tokens = int(eff_max_tokens * 1.5)

        attempts = []
        for i in range(n_attempts):
            t_idx = min(i, len(timeouts) - 1)
            timeout_ms = timeouts[t_idx]
            if i == 0:
                attempts.append({
                    "label": "normal",
                    "messages": base_messages,
                    "temperature": float(eff_temperature),
                    "max_tokens": eff_max_tokens,
                    "response_format": {"type": "json_object"},
                    "reasoning_effort": "low",
                    "timeout_ms": timeout_ms,
                })
            else:
                attempts.append({
                    "label": f"minimal-{i}",
                    "messages": minimal_messages,
                    "temperature": 0.0,
                    "max_tokens": minimal_max_tokens,
                    "response_format": {"type": "json_object"},
                    "reasoning_effort": "low",
                    "timeout_ms": timeout_ms,
                })

        llm = await self._resolve_game_llm_provider(
            connection_id=eff_connection_id,
            model=eff_model,
            max_tokens=eff_max_tokens,
        )
        if llm is None:
            await self.send({
                "event": "game_move_response",
                "game_type": game_type,
                "session_id": session_id,
                "game_session_id": game_session_id,
                "action": None,
                "error": {
                    "code": "MODEL_ERROR",
                    "message": "No LLM provider configured",
                    "fallback_action": None,
                },
            })
            return

        final_reasoning = ""
        final_action: dict | None = None
        final_error: dict | None = None
        reasoning_truncated = False

        for idx, attempt in enumerate(attempts):
            is_last_attempt = idx == len(attempts) - 1
            reasoning_max_chars = settings.game_reasoning_max_chars
            logger.info(
                "[game_move] attempt %d/%d (%s) | game=%s session=%s game_session=%s",
                idx + 1, len(attempts), attempt["label"], game_type, session_id, game_session_id,
            )

            reasoning_parts: list[str] = []
            text_parts: list[str] = []
            pre_marker_buf: list[str] = []
            seen_move_marker = False
            reasoning_chars = 0

            try:
                async for ev in llm.stream(
                    attempt["messages"],
                    temperature=attempt["temperature"],
                    max_tokens=attempt["max_tokens"],
                    response_format=attempt["response_format"],
                    reasoning_effort=attempt.get("reasoning_effort"),
                ):
                    if ev.kind == "reasoning" and ev.text:
                        if reasoning_chars < reasoning_max_chars:
                            reasoning_parts.append(ev.text)
                            if game_session_id:
                                await self.send({
                                    "event": f"game_move_reasoning:{game_session_id}",
                                    "chunk": ev.text,
                                })
                        reasoning_chars += len(ev.text)
                        if reasoning_chars >= reasoning_max_chars and game_session_id:
                            reasoning_truncated = True
                            await self.send({
                                "event": f"game_move_reasoning:{game_session_id}",
                                "chunk": "",
                                "done": True,
                            })
                    elif ev.kind == "delta" and ev.text:
                        if not seen_move_marker:
                            pre_marker_buf.append(ev.text)
                            combined = "".join(pre_marker_buf)
                            marker_idx = combined.find("---MOVE---")
                            if marker_idx >= 0:
                                seen_move_marker = True
                                reasoning_text = combined[:marker_idx]
                                json_text = combined[marker_idx + len("---MOVE---"):]
                                if reasoning_text.strip():
                                    reasoning_parts.append(reasoning_text.strip())
                                    if game_session_id:
                                        await self.send({
                                            "event": f"game_move_reasoning:{game_session_id}",
                                            "chunk": reasoning_text.strip(),
                                        })
                                if json_text.strip():
                                    text_parts.append(json_text)
                                pre_marker_buf = []
                        else:
                            text_parts.append(ev.text)
                    elif ev.kind == "done":
                        break

                if not seen_move_marker:
                    text_parts = pre_marker_buf + text_parts

                full_reasoning = "".join(reasoning_parts)
                full_text = "".join(text_parts)

                logger.info(
                    "[game_move] ← attempt %d done | game=%s session=%s game_session=%s | text=%r reasoning_len=%d",
                    idx + 1, game_type, session_id, game_session_id, full_text[:200], len(full_reasoning),
                )

                action, error = self._parse_game_action({"text": full_text}, game_state, rules, game_type)

                if not full_reasoning and action and action.get("reasoning"):
                    full_reasoning = action["reasoning"]
                    if game_session_id and full_reasoning:
                        await self.send({
                            "event": f"game_move_reasoning:{game_session_id}",
                            "chunk": full_reasoning,
                            "done": True,
                        })

                if action and full_reasoning:
                    action["reasoning"] = full_reasoning

                if action is not None:
                    final_action = action
                    final_reasoning = full_reasoning
                    break

                if error is not None and not is_last_attempt:
                    logger.info(
                        "[game_move] attempt %d failed with %s — retrying | game=%s session=%s game_session=%s",
                        idx + 1, error["code"], game_type, session_id, game_session_id,
                    )
                    continue

                if error is not None and is_last_attempt:
                    final_error = {
                        "code": "MODEL_ERROR",
                        "message": (
                            f"Model did not return valid JSON after {len(attempts)} attempts. "
                            f"Last error: {error['message']}"
                        ),
                        "fallback_action": None,
                    }
                    final_reasoning = full_reasoning

            except Exception as ex:
                logger.exception(
                    "[game_move] attempt %d exception | game=%s session=%s game_session=%s",
                    idx + 1, game_type, session_id, game_session_id,
                )
                if is_last_attempt:
                    final_error = {
                        "code": "MODEL_ERROR",
                        "message": str(ex),
                        "fallback_action": None,
                    }
                else:
                    continue

        logger.info(
            "[game_move] → WS response | game=%s session=%s game_session=%s | action=%s error=%s",
            game_type, session_id, game_session_id, final_action, final_error,
        )
        await self.send({
            "event": "game_move_response",
            "game_type": game_type,
            "session_id": session_id,
            "game_session_id": game_session_id,
            "action": final_action,
            "error": final_error,
            "reasoning": final_reasoning,
            "reasoning_truncated": reasoning_truncated,
        })

    def _build_game_messages(self, rules: dict, game_state: dict) -> list[dict]:
        """Build a fresh user-only messages list. The provider's own system prompt is
        prepended by complete(), so we embed the game system prompt as a user preamble
        to avoid double-system-message errors with Jinja-templated LLM backends."""
        system_prompt = rules.get("system_prompt", "You are a game AI. Output valid JSON.")
        user_content = "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nGame state:\n" + json.dumps(game_state, indent=2)
        return [{"role": "user", "content": user_content}]

    def _build_minimal_game_messages(self, game_state: dict) -> list[dict]:
        """Build a minimal prompt for retry attempts: only list empty cells
        and demand strict JSON output. No reasoning requested."""
        board = game_state.get("board", [])
        empties = [
            f"({r},{c})"
            for r, row in enumerate(board)
            for c, cell in enumerate(row)
            if cell is None
        ]
        empties_str = ",".join(empties) if empties else "none"
        user_content = (
            f"Empty cells: {empties_str}.\n"
            "Output ONLY valid JSON, no text, no explanation, no markdown:\n"
            '{"row":<0-2>,"col":<0-2>}'
        )
        return [{"role": "user", "content": user_content}]

    def _extract_json_text(self, raw_text: str) -> str:
        """Extract the JSON substring from an LLM response that may contain
        extra text, markdown fences, or a ---MOVE--- marker.

        Returns the best-effort JSON string. Does NOT parse — caller does.
        """
        text = raw_text.strip()
        if not text:
            return ""

        marker = "---MOVE---"
        marker_idx = text.find(marker)
        if marker_idx >= 0:
            candidate = text[marker_idx + len(marker):].strip()
            if candidate:
                return candidate
            candidate = text[:marker_idx].strip()
            if candidate:
                return candidate
            return ""

        stripped = text.strip()
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            json_lines: list[str] = []
            in_code = False
            for line in lines:
                if line.strip().startswith("```"):
                    in_code = not in_code
                    continue
                if in_code:
                    json_lines.append(line)
                elif json_lines and line.strip():
                    json_lines.append(line)
            if json_lines:
                return "\n".join(json_lines).strip()

        first_brace = text.find("{")
        if first_brace < 0:
            first_brace = text.find("[")
        if first_brace < 0:
            return text.strip()

        last_brace = text.rfind("}")
        last_bracket = text.rfind("]")
        last_close = max(last_brace, last_bracket)
        if last_close < 0:
            return text[first_brace:].strip()

        return text[first_brace:last_close + 1].strip()

    def _repair_and_parse_json(self, raw: str) -> dict | None:
        """Try to parse JSON, repairing truncated input by adding missing
        closing braces/brackets. Returns None if repair fails."""
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        stripped = raw.strip()
        if not stripped or stripped[0] not in "{[":
            return None

        opens = stripped.count("{") - stripped.count("}")
        brackets = stripped.count("[") - stripped.count("]")
        if opens <= 0 and brackets <= 0:
            return None

        candidate = stripped
        if opens > 0:
            candidate += "}" * opens
        if brackets > 0:
            candidate += "]" * brackets

        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                logger.warning(
                    "Repaired truncated JSON (added %d closing braces/brackets)",
                    opens + brackets,
                )
                return parsed
        except json.JSONDecodeError:
            pass

        for end in range(len(stripped), 0, -1):
            try:
                candidate = stripped[:end]
                e = candidate.count("{") - candidate.count("}")
                b = candidate.count("[") - candidate.count("]")
                if e > 0:
                    candidate += "}" * e
                if b > 0:
                    candidate += "]" * b
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    logger.warning(
                        "Repaired truncated JSON (truncated at len=%d, added %d close tokens)",
                        end, e + b,
                    )
                    return parsed
            except json.JSONDecodeError:
                continue

        return None

    def _parse_game_action(
        self,
        llm_response: dict,
        game_state: dict,
        rules: dict,
        game_type: str = "unknown",
    ) -> tuple[dict | None, dict | None]:
        """
        Parse LLM response into a GameAction.
        Returns (action, error). One is always None.
        """
        raw_text = llm_response.get("text", "").strip()
        json_text = self._extract_json_text(raw_text)

        data = None
        if json_text:
            data = self._repair_and_parse_json(json_text)

        if data is None:
            logger.warning(
                "game AI parse error | game_type=%s | raw_response=%r",
                game_type,
                raw_text[:500],
            )
            return None, {
                "code": "PARSE_ERROR",
                "message": f"Could not parse valid JSON from model response: {raw_text[:100]}",
                "fallback_action": None,
            }

        row = data.get("row")
        col = data.get("col")

        if isinstance(row, str):
            try:
                row = int(row)
            except (ValueError, TypeError):
                pass
        if isinstance(col, str):
            try:
                col = int(col)
            except (ValueError, TypeError):
                pass

        reasoning = data.get("reasoning", "")

        if not self._is_legal_move(game_state, row, col):
            return None, {
                "code": "INVALID_MOVE",
                "message": f"Coordinates ({row}, {col}) are out of range or cell is occupied",
                "fallback_action": None,
            }

        action = {"type": "move", "data": {"row": row, "col": col}}
        if reasoning:
            action["reasoning"] = reasoning
        return action, None

    def _is_legal_move(self, game_state: dict, row: int | None, col: int | None) -> bool:
        """Check if the coordinates are within bounds and the cell is empty."""
        if row is None or col is None:
            return False
        if not isinstance(row, int) or not isinstance(col, int):
            return False
        if row < 0 or col < 0:
            return False
        board = game_state.get("board", [])
        if not board or row >= len(board) or col >= len(board[0]):
            return False
        return board[row][col] is None

    def _get_fallback_move(self, game_state: dict) -> dict | None:
        """Pick a random legal move from the board. Returns None if no legal moves."""
        import random

        board = game_state.get("board", [])
        if not board:
            return None
        legal = [
            (r, c)
            for r, row in enumerate(board)
            for c, cell in enumerate(row)
            if cell is None
        ]
        if not legal:
            return None
        r, c = random.choice(legal)
        return {"type": "move", "data": {"row": r, "col": c}}

    # ── Game sessions (WebSocket) ─────────────────────────────

    async def _handle_game_session_start(self, event: dict[str, Any]) -> None:
        """Frontend avisa que empezó una partida."""
        session_id = event.get("sessionId", "")
        game_id = event.get("gameId", "")
        paradigm = event.get("paradigm", GameParadigm.TURN_BASED)
        logger.info("[game_session] start | id=%s game=%s paradigm=%s",
                    session_id, game_id, paradigm)
        # No persistimos hasta que termine o haya al menos un turno.

    async def _handle_game_turn(self, event: dict[str, Any]) -> None:
        """Frontend envía un turno completo (jugador o IA)."""
        session_id = event.get("sessionId", "")
        turn_data = event.get("turnData", {})
        logger.info("[game_session] turn | id=%s turn=%s",
                    session_id, turn_data.get("turnNumber"))
        # Acumulamos en memoria; persistimos al final.

    async def _handle_game_event(self, event: dict[str, Any]) -> None:
        """Frontend envía un evento (juegos realtime)."""
        session_id = event.get("sessionId", "")
        event_data = event.get("eventData", {})
        logger.info("[game_session] event | id=%s type=%s",
                    session_id, event_data.get("type"))

    async def _handle_game_session_end(self, event: dict[str, Any]) -> None:
        """Frontend avisa que la partida terminó — persistir."""
        session_id = event.get("sessionId", "")
        game_id = event.get("gameId", "")
        paradigm = event.get("paradigm", GameParadigm.TURN_BASED)
        status = event.get("status", GameSessionStatus.ABANDONED)
        started_at = event.get("startedAt", 0)
        ended_at = event.get("endedAt", 0)
        turns = event.get("turns", [])
        events_data = event.get("events", [])

        record = GameSessionRecord(
            session_id=session_id,
            game_id=game_id,
            paradigm=paradigm,
            status=status,
            started_at=started_at,
            ended_at=ended_at,
            turns=turns,
            events=events_data,
        )
        path = self.server.game_session_service.save(record)
        await self.send({
            "event": GameSessionWSEvent.PERSISTED,
            "sessionId": session_id,
            "path": path,
        })

    async def _handle_list_game_sessions(self, event: dict[str, Any]) -> None:
        game_id = event.get("gameId")
        sessions = self.server.game_session_service.list_sessions(game_id)
        await self.send({
            "event": GameSessionWSEvent.LIST,
            "sessions": sessions,
        })

    async def _handle_load_game_session(self, event: dict[str, Any]) -> None:
        session_id = event.get("sessionId", "")
        data = self.server.game_session_service.load(session_id)
        await self.send({
            "event": GameSessionWSEvent.LOADED,
            "session": data,
        })

    async def _handle_delete_game_session(self, event: dict[str, Any]) -> None:
        session_id = event.get("sessionId", "")
        deleted = self.server.game_session_service.delete(session_id)
        await self.send({
            "event": GameSessionWSEvent.DELETED,
            "sessionId": session_id,
            "deleted": deleted,
        })

    # ── Model download ─────────────────────────────────────

    async def _handle_download_tts_model(self, event: dict[str, Any]) -> None:
        """Download a TTS model (Qwen3 or Piper) and emit progress events."""
        model_id = event.get("model_id", "")
        tts_provider = event.get("provider", "qwen3")

        if tts_provider == "piper":
            await self._download_piper_voice(model_id)
        else:
            await self._download_qwen3_model(model_id)

    async def _download_qwen3_model(self, model_id: str) -> None:
        from kali_core.voice.providers.qwen import QWEN_MODELS

        if model_id not in QWEN_MODELS:
            await self.send({
                "event": "download_tts_model_error",
                "model_id": model_id,
                "detail": f"Unknown model: {model_id}",
            })
            return

        cfg = QWEN_MODELS[model_id]
        models_dir = Path(settings.tts_models_dir).expanduser().resolve()
        models_dir.mkdir(parents=True, exist_ok=True)
        target = models_dir / cfg["filename"]

        import re as _re
        quant_match = _re.search(r"-(Q4_K_M|Q8_0|BF16|F32)\.gguf$", cfg["filename"])
        quant_suffix = quant_match.group(1) if quant_match else "Q4_K_M"
        tokenizer_filename = f"qwen-tokenizer-12hz-{quant_suffix}.gguf"
        tokenizer_url = f"https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/{tokenizer_filename}"
        tokenizer_path = models_dir / tokenizer_filename
        model_url = f"https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/{cfg['filename']}"

        await self.send({"event": "download_tts_model_started", "model_id": model_id})

        loop = asyncio.get_event_loop()
        try:
            if not tokenizer_path.exists():
                await loop.run_in_executor(None, self._make_downloader(model_id, "tokenizer"), tokenizer_url, tokenizer_path)
            if not target.exists():
                await loop.run_in_executor(None, self._make_downloader(model_id, "model"), model_url, target)

            if hasattr(self.server.tts_provider, "configure"):
                self.server.tts_provider.configure(models_dir=str(models_dir))

            await self.server.broadcast_status()
            await self.send({"event": "download_tts_model_complete", "model_id": model_id})
        except Exception as exc:
            logger.exception("Failed to download TTS model %s", model_id)
            await self.send({"event": "download_tts_model_error", "model_id": model_id, "detail": str(exc)})

    async def _download_piper_voice(self, voice_key: str) -> None:
        from kali_core.model_catalog import piper_voice_urls, piper_voice_filenames

        urls = piper_voice_urls(voice_key)
        names = piper_voice_filenames(voice_key)
        if not urls:
            await self.send({"event": "download_tts_model_error", "model_id": voice_key, "detail": "Unknown Piper voice"})
            return

        voices_dir = Path(settings.voices_dir).expanduser().resolve()
        voices_dir.mkdir(parents=True, exist_ok=True)

        await self.send({"event": "download_tts_model_started", "model_id": voice_key})
        loop = asyncio.get_event_loop()

        try:
            for url, name in zip(urls, names):
                target = voices_dir / name
                if not target.exists():
                    await loop.run_in_executor(None, self._make_downloader(voice_key, "voice"), url, target)

            await self.server.broadcast_status()
            await self.send({"event": "download_tts_model_complete", "model_id": voice_key})
        except Exception as exc:
            logger.exception("Failed to download Piper voice %s", voice_key)
            await self.send({"event": "download_tts_model_error", "model_id": voice_key, "detail": str(exc)})

    async def _handle_download_stt_model(self, event: dict[str, Any]) -> None:
        """Download an STT model (Vosk zip or Qwen3-ASR from HuggingFace)."""
        model_id = event.get("model_id", "")
        provider = event.get("provider", "vosk")

        if provider == "qwen3-asr":
            await self._download_qwen3_asr_model(model_id)
        else:
            await self._download_vosk_model(model_id)

    async def _download_qwen3_asr_model(self, model_id: str) -> None:
        from kali_core.model_catalog import QWEN3_ASR_MODELS

        model_entry = next((m for m in QWEN3_ASR_MODELS if m["id"] == model_id), None)
        if not model_entry:
            await self.send({"event": "download_stt_model_error", "model_id": model_id, "detail": f"Unknown Qwen3-ASR model: {model_id}"})
            return

        await self.send({"event": "download_stt_model_started", "model_id": model_id})
        loop = asyncio.get_event_loop()

        try:
            from huggingface_hub import snapshot_download

            hf_id = model_entry["hf_id"]
            models_dir = Path(settings.qwen_asr_models_dir).expanduser().resolve()
            models_dir.mkdir(parents=True, exist_ok=True)

            await loop.run_in_executor(None, lambda: snapshot_download(
                repo_id=hf_id,
                cache_dir=str(models_dir),
                resume_download=True,
            ))

            await self.server.broadcast_status()
            await self.send({"event": "download_stt_model_complete", "model_id": model_id})
        except Exception as exc:
            logger.exception("Failed to download Qwen3-ASR model %s", model_id)
            await self.send({"event": "download_stt_model_error", "model_id": model_id, "detail": str(exc)})

    async def _download_vosk_model(self, model_id: str) -> None:
        """Download a Vosk STT model (zip) and extract it."""
        from kali_core.model_catalog import VOSK_MODELS, VOSK_URL_BASE

        model_entry = next((m for m in VOSK_MODELS if m["id"] == model_id), None)
        if not model_entry:
            await self.send({"event": "download_stt_model_error", "model_id": model_id, "detail": "Unknown Vosk model"})
            return

        stt_dir = Path(settings.stt_models_dir).expanduser().resolve()
        stt_dir.mkdir(parents=True, exist_ok=True)
        url = f"{VOSK_URL_BASE}/{model_id}.zip"

        await self.send({"event": "download_stt_model_started", "model_id": model_id})
        loop = asyncio.get_event_loop()

        try:
            import tempfile, zipfile
            tmp_zip = stt_dir / f"{model_id}.zip"

            if not (stt_dir / model_id / "am" / "final.mdl").exists():
                await loop.run_in_executor(None, self._make_downloader(model_id, "model"), url, tmp_zip)

                # Extract zip
                def _extract():
                    with zipfile.ZipFile(str(tmp_zip), "r") as zf:
                        zf.extractall(str(stt_dir))
                    tmp_zip.unlink(missing_ok=True)

                await loop.run_in_executor(None, _extract)

            await self.server.broadcast_status()
            await self.send({"event": "download_stt_model_complete", "model_id": model_id})
        except Exception as exc:
            logger.exception("Failed to download STT model %s", model_id)
            await self.send({"event": "download_stt_model_error", "model_id": model_id, "detail": str(exc)})

    def _make_downloader(self, model_id: str, kind: str):
        """Return a callable that downloads a URL to a path, emitting progress."""
        loop = asyncio.get_event_loop()
        def _download(url: str, path: Path) -> None:
            req = urllib.request.Request(url, headers={"User-Agent": "kali-companion/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                downloaded = 0
                chunk_size = 256 * 1024
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(path, "wb") as fh:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        fh.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            progress = int(downloaded * 100 / total)
                            asyncio.run_coroutine_threadsafe(
                                self.send({
                                    "event": "download_tts_model_progress",
                                    "model_id": model_id,
                                    "kind": kind,
                                    "progress": progress,
                                    "downloaded": downloaded,
                                    "total": total,
                                }),
                                loop,
                            )
        return _download

    # ── Audio / STT ────────────────────────────────────────

    async def _handle_audio_start(self, event: dict[str, Any]) -> None:
        """Start a new STT session."""
        if not self.server.stt_provider.is_loaded:
            await self.send(
                {
                    "event": "error",
                    "detail": (
                        "STT provider not loaded. "
                        "Load a model first in Settings > Speech to Text."
                    ),
                }
            )
            return
        language = normalize(event.get("language", self._stt_language))
        self.server.stt_provider.start_session(language)
        self._stt_session_active = True
        self._recording_origin = event.get("origin", "manual")
        logger.debug("STT session started (lang=%s, origin=%s)", language, self._recording_origin)

        # Reset VAD state for new session.
        self._vad_buffer = bytearray()
        self._vad_silence_frames = 0
        self._last_vad_is_speech = False
        self._recording_start_time = time.monotonic()
        self._pending_final_text = None
        if self._stt_vad_enabled:
            logger.info(
                "STT session started with VAD (mode=%d, silence_timeout=%.1fs, input_mode=%s, origin=%s)",
                self._stt_vad_mode,
                self._stt_vad_silence_timeout,
                self._input_mode,
                self._recording_origin,
            )
        else:
            logger.info(
                "STT session started without VAD (input_mode=%s, origin=%s)",
                self._input_mode,
                self._recording_origin,
            )

        # Pause wake word while recording (avoids feedback).
        if self._wake_word is not None:
            self._wake_word.stop()

    async def _handle_audio_chunk(self, chunk: bytes) -> None:
        """Feed a PCM chunk to the active STT session."""
        logger.debug("audio chunk: %d bytes", len(chunk))

        # Feed wake word detector if it's running (always-on listening).
        if self._wake_word is not None and self._wake_word.running:
            detected = self._wake_word.feed(chunk)
            if detected:
                await self.send(
                    {"event": "wake_word", "text": detected, "confidence": 1.0}
                )

        # Feed the main STT session if active.
        stt_returned_final = False
        if self._stt_session_active:
            result = self.server.stt_provider.accept(chunk)
            if result is not None:
                if "partial" in result:
                    partial = result.get("partial", "")
                    if partial:
                        await self.send(
                            {"event": "stt_partial", "text": partial}
                        )
                elif "text" in result:
                    text = result.get("text", "")
                    if text:
                        # Apply STT correction.
                        corrected, _changes = correct_stt_text(text)
                        if self._input_mode == "ptt":
                            # In PTT (manual or wake-word triggered), never auto-finalize on
                            # provider-internal silence detection. Hold the final text until
                            # the user explicitly sends audio_end (manual) or VAD auto-ends
                            # (wake word origin).
                            self._pending_final_text = corrected
                            await self.send(
                                {"event": "stt_partial", "text": corrected}
                            )
                        else:
                            stt_returned_final = True
                            await self.send(
                                {"event": "stt_final", "text": corrected, "provider": self.server.stt_provider.provider_name}
                            )

        # VAD processing: optional state reporting only. Auto-end is handled
        # by the frontend (RMS-based gate) — the backend no longer auto-ends
        # on silence. This block is kept for optional vad_state events if a
        # future mode wants backend-driven VAD.
        if self._stt_session_active and not stt_returned_final and self._stt_vad_enabled:
            await self._run_vad(chunk)

        # Safety timeout: never let a recording exceed max duration.
        if self._stt_session_active and self._recording_start_time is not None:
            elapsed = time.monotonic() - self._recording_start_time
            if elapsed >= self._max_recording_duration:
                logger.warning("Recording safety timeout reached (%.1fs), auto-ending session", elapsed)
                await self._handle_audio_end()

    async def _handle_audio_end(self) -> None:
        """End the STT session and emit the final transcript."""
        if self._stt_session_active:
            try:
                result = self.server.stt_provider.finish()
                text = result.get("text", "").strip()
                # If provider.finish() is empty but we held a PTT internal final, use it.
                if not text and self._pending_final_text:
                    text = self._pending_final_text
                self._pending_final_text = None
                # Apply STT correction (fuzzy matching against game terms).
                corrected, changes = correct_stt_text(text)
                if changes:
                    logger.info("STT corrected: %s → %s (changes: %s)", text, corrected, changes)
                    await self.send({"event": "stt_uncorrected", "text": text})
                text = corrected
                await self.send({"event": "stt_final", "text": text, "provider": self.server.stt_provider.provider_name})
            except Exception:
                logger.exception("STT finish failed")
                await self.send({"event": "error", "detail": "STT transcription failed. Model may have been unloaded."})
            finally:
                self._stt_session_active = False

        # Resume wake word if enabled and not already running.
        if self._input_mode == "ptt" and self._wake_word_enabled and self._wake_word is not None and not self._wake_word.running:
            self._wake_word.start()

        # Reset VAD state at the end (new session will re-arm if needed).
        self._vad_buffer = bytearray()
        self._vad_silence_frames = 0
        self._last_vad_is_speech = False
        self._recording_start_time = None
        self._recording_origin = None

    async def _run_vad(self, chunk: bytes) -> None:
        """Run webrtcvad over the chunk for optional state reporting only.

        Auto-end on silence is now handled by the frontend (RMS-based gate).
        This method is kept for optional vad_state events; the silence timeout
        auto-end logic has been removed.
        """
        import webrtcvad
        if self._vad is None:
            self._vad = webrtcvad.Vad(self._stt_vad_mode)
            logger.info("VAD initialized (mode=%d)", self._stt_vad_mode)

        self._vad_buffer.extend(chunk)
        frame_size = 320  # 10ms @ 16kHz 16-bit mono
        any_speech_this_chunk = False

        while len(self._vad_buffer) >= frame_size:
            frame = bytes(self._vad_buffer[:frame_size])
            self._vad_buffer = self._vad_buffer[frame_size:]

            if self._vad.is_speech(frame, 16000):
                self._vad_silence_frames = 0
                any_speech_this_chunk = True
            else:
                self._vad_silence_frames += 1

        # Report speech/silence state to the frontend on transitions.
        is_speech = any_speech_this_chunk
        if self._last_vad_is_speech != is_speech:
            self._last_vad_is_speech = is_speech
            logger.debug("VAD state transition: is_speech=%s", is_speech)
            await self.send({"event": "vad_state", "is_speech": is_speech})

    # ── Wake word ──────────────────────────────────────────

    async def _start_wake_word(self) -> None:
        """Start the always-on wake word detector."""
        if self._wake_word is None:
            self._wake_word = WakeWordDetector(self._stt_language)
        self._wake_word.start()

    async def _stop_wake_word(self) -> None:
        """Stop the wake word detector."""
        if self._wake_word is not None:
            self._wake_word.stop()

    # ── Agent turn ─────────────────────────────────────────

    async def _handle_input(
        self,
        content: str,
        selected_artifacts: list[dict] | None = None,
    ) -> None:
        """Route a user message through the agent and TTS pipeline."""
        session_id = self.session_id or "sess_unknown"
        truncated = content[:120] + ("…" if len(content) > 120 else "")
        logger.info("[turn] input (%s): %s", session_id[:8], truncated)
        # Reject if a turn is already in progress.
        if self._current_task and not self._current_task.done():
            logger.info("[turn] rejected (%s): a turn is already in progress", session_id[:8])
            await self.send({
                "event": "error",
                "detail": "Hay un turno en progreso. Espera a que termine o cancélalo con el botón de stop.",
            })
            return
        self._current_task = asyncio.create_task(
            self._run_turn(content, session_id, selected_artifacts=selected_artifacts)
        )

    async def _run_turn(
        self,
        content: str,
        session_id: str,
        selected_artifacts: list[dict] | None = None,
    ) -> None:
        """Run one agent turn: stream deltas, execute tools, then synthesize TTS."""
        accumulated = ""
        turn_start_ts = time.monotonic()
        logger.info("[turn] start (%s)", session_id[:8])
        # Emit turn_start immediately so the frontend can show feedback
        # before the first token arrives (especially important for reasoning
        # models that take 10-20s to produce output).
        await self.send({"event": "turn_start", "session_id": session_id})

        # Inject selected-artifact context so the agent knows which
        # artifacts the user currently has in focus. The context is
        # prepended to the user message; the original text is what
        # gets persisted and shown to the user.
        agent_message = content
        if selected_artifacts:
            lines = ["SELECTED ARTIFACTS (the user has these in focus):"]
            for art in selected_artifacts:
                art_id = art.get("id", "?")
                art_type = art.get("type", "?")
                art_title = art.get("title", "?")
                lines.append(f"- id={art_id} type={art_type} title=\"{art_title}\"")
            lines.append(
                "If the user asks to modify, add to, or improve 'this' or "
                "'the selected artifact', they likely mean one of the above. "
                "Use update_artifact (with get_artifact first to read current "
                "content) rather than creating a new artifact."
            )
            lines.append("")
            lines.append(f"USER MESSAGE: {content}")
            agent_message = "\n".join(lines)

        # Feedback mode: inject a confirmation instruction before the user
        # message when confirm or plan mode is active.
        if self._feedback_mode in ("confirm", "plan"):
            plan_note = (
                "IMPORTANT: Before calling any tool, write 1-2 sentences "
                "confirming what you understood from the user's request. "
                "If the request is complex or ambiguous, ask a clarifying "
                "question before proceeding. Only execute after the user "
                "confirms your understanding is correct.\n\n"
            )
            if self._feedback_mode == "plan":
                plan_note = (
                    "IMPORTANT: The user wants you to confirm your "
                    "understanding before acting. First, summarize what you "
                    "will do in 1-2 sentences and wait for the user to "
                    "confirm. If anything is unclear, ask a question. "
                    "Do NOT call any tool until the user confirms.\n\n"
                )
            agent_message = plan_note + agent_message

        try:
            # Set the emit callback for tool events.
            self.server.agent.set_emit_callback(self.send)
            first_token_ts: float | None = None
            tool_call_count = 0
            usage_stats: dict | None = None
            async for event in self.server.agent.respond(agent_message, session_id, language=self._ui_language):
                if event.kind == "delta" and event.text:
                    if first_token_ts is None:
                        first_token_ts = time.monotonic()
                    accumulated += event.text
                    await self.send(
                        {"event": "delta", "session_id": session_id, "text": event.text}
                    )
                elif event.kind == "reasoning" and event.text:
                    await self.send(
                        {"event": "reasoning_delta", "session_id": session_id, "text": event.text}
                    )
                elif event.kind == "step":
                    await self.send(
                        {"event": "step_start", "session_id": session_id, "step": event.step or 1}
                    )
                elif event.kind == "tool_call":
                    tool_call_count += 1
                elif event.kind == "usage":
                    usage_stats = {
                        "prompt_tokens": event.prompt_tokens,
                        "completion_tokens": event.completion_tokens,
                        "reasoning_tokens": event.reasoning_tokens,
                    }
                elif event.kind == "done":
                    break
        except asyncio.CancelledError:
            elapsed = time.monotonic() - turn_start_ts
            logger.info("[turn] cancelled (%s) after %.1fs", session_id[:8], elapsed)
            await self.send({"event": "turn_end", "session_id": session_id, "cancelled": True})
            return
        except Exception as exc:
            logger.exception("agent turn error")
            await self.send({"event": "error", "detail": str(exc)})
            return

        elapsed = time.monotonic() - turn_start_ts
        first_token_latency = (first_token_ts - turn_start_ts) if first_token_ts else None
        logger.info("[turn] end (%s) after %.1fs (chars=%d)", session_id[:8], elapsed, len(accumulated))

        # Send turn_stats event with performance metrics.
        await self.send({
            "event": "turn_stats",
            "session_id": session_id,
            "elapsed": round(elapsed, 2),
            "first_token_latency": round(first_token_latency, 2) if first_token_latency else None,
            "char_count": len(accumulated),
            "tool_call_count": tool_call_count,
            "usage": usage_stats,
        })

        # Synthesize TTS from the accumulated response.
        if accumulated and self.server.tts_pipeline.auto_tts:
            await self._synthesize_tts(accumulated, session_id)

        # Persist the user message and assistant reply to the session store.
        session_store = self.server.session_store
        await session_store.add_message(session_id, "user", content)
        # Auto-title: use first user message as session title.
        title = content[:50].strip()
        if len(content) > 50:
            title += "…"
        await session_store.set_title_if_default(session_id, title)
        if accumulated:
            await session_store.add_message(session_id, "assistant", accumulated)

        await self.send({"event": "turn_end", "session_id": session_id})

    async def _synthesize_tts(self, raw_text: str, session_id: str) -> None:
        """Filter, segment, and stream TTS audio events to the frontend."""
        pipeline = self.server.tts_pipeline
        logger.info(
            "TTS start: provider=%s voice=%s mode=%s chars=%d",
            getattr(pipeline.provider, "provider_name", "?"),
            pipeline.voice,
            pipeline.mode,
            len(raw_text),
        )
        filtered, raw = pipeline.filter_text(raw_text)
        if filtered != raw:
            await self.send(
                {
                    "event": "tts_filtered",
                    "raw_length": len(raw),
                    "filtered_length": len(filtered),
                    "filtered_text": filtered,
                }
            )

        try:
            async for result in pipeline.synthesize_stream(raw_text):
                audio_b64 = base64.b64encode(result.audio).decode("ascii")
                await self.send(
                    {
                        "event": "tts_audio",
                        "audio": audio_b64,
                        "segment": result.segment,
                        "total_segments": -1,
                        "text": "",
                        "duration": result.duration,
                    }
                )
        except Exception as exc:
            logger.exception("TTS pipeline error")
            await self.send({"event": "error", "detail": f"TTS failed: {exc}"})

    # ── Settings ───────────────────────────────────────────

    async def _apply_settings(self, event: dict[str, Any]) -> None:
        """Apply user settings from the frontend."""
        ai_cfg_changed = False
        if "tts_provider" in event:
            new_id = event["tts_provider"]
            if new_id != self.server.tts_provider.provider_name:
                old_provider = self.server.tts_provider
                try:
                    from kali_core.voice.providers import get_tts_provider
                    mapped = "piper" if new_id == "inproc" else ("qwen3" if new_id == "qwen3-voicedesign" else new_id)
                    new_provider = get_tts_provider(mapped)
                    if mapped == "qwen3" and not getattr(new_provider, "is_loaded", False):
                        models = new_provider.list_models()
                        available = [m for m in models if m.available]
                        if available:
                            loop = asyncio.get_event_loop()
                            await loop.run_in_executor(None, new_provider.load_model, available[0].id, settings.qwen_backend)
                    if hasattr(old_provider, "shutdown"):
                        old_provider.shutdown()
                    self.server.tts_provider = new_provider
                    try:
                        sanitized_voice = _validate_voice_for_provider(self.server.tts_pipeline.voice, new_provider)
                    except ValueError:
                        sanitized_voice = _first_available_voice(new_provider) or self.server.tts_pipeline.voice
                    self.server.tts_pipeline = TTSPipeline(
                        new_provider,
                        voice=sanitized_voice,
                        mode=self.server.tts_pipeline.mode,
                        auto_tts=self.server.tts_pipeline.auto_tts,
                    )
                    self.server.tts_available = getattr(new_provider, "is_available", True)
                    self.server.tts_error = getattr(new_provider, "last_error", None)
                    await self.server.broadcast_status()
                except Exception as exc:
                    self.server.tts_provider = old_provider
                    await self.send({"event": "error", "detail": f"Failed to switch TTS provider to {new_id}: {exc}"})
        if "tts_model" in event:
            try:
                device = event.get("tts_device", getattr(self.server.tts_provider, "device", None) or "cpu")
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self.server.tts_provider.load_model, event["tts_model"], device)
                self.server.tts_available = getattr(self.server.tts_provider, "is_available", True)
                self.server.tts_error = getattr(self.server.tts_provider, "last_error", None)
                await self.server.broadcast_status()
            except Exception as exc:
                await self.send({"event": "error", "detail": f"Failed to load TTS model: {exc}"})
        if "tts_device" in event:
            try:
                if getattr(self.server.tts_provider, "is_loaded", False):
                    current = self.server.tts_provider.loaded_model
                    self.server.tts_provider.unload_model()
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, self.server.tts_provider.load_model, current, event["tts_device"])
                    await self.server.broadcast_status()
            except Exception as exc:
                await self.send({"event": "error", "detail": f"Failed to switch TTS device: {exc}"})
        if "voice" in event:
            try:
                sanitized = _validate_voice_for_provider(event["voice"], self.server.tts_provider)
                self.server.tts_pipeline.set_voice(voice=sanitized)
            except ValueError as exc:
                await self.send({"event": "error", "detail": str(exc)})
        if "tts_mode" in event:
            self.server.tts_pipeline.set_voice(mode=event["tts_mode"])
        if "auto_tts" in event:
            self.server.tts_pipeline.set_auto_tts(bool(event["auto_tts"]))
        if "tts_models_dir" in event:
            self.server._apply_server_setting("tts_models_dir", event["tts_models_dir"])
            await self.server.broadcast_status()
        if "llm_model" in event and self.server.llm_provider is not None:
            self.server.llm_provider._model = event["llm_model"]  # type: ignore[attr-defined]
            ai_cfg_changed = True
        if "llm_max_tokens" in event and self.server.llm_provider is not None:
            self.server.llm_provider._max_tokens = int(event["llm_max_tokens"])  # type: ignore[attr-defined]
            ai_cfg_changed = True
        if "llm_api_url" in event or "llm_api_key" in event or "llm_provider" in event:
            api_url = event.get("llm_api_url", getattr(self.server.llm_provider, "_api_url", settings.llm_api_url))
            api_key = event.get("llm_api_key", getattr(self.server.llm_provider, "_api_key", settings.llm_api_key))
            provider = event.get("llm_provider", "direct")
            model = getattr(self.server.llm_provider, "_model", settings.llm_model)
            if hasattr(self.server.llm_provider, "reconfigure"):
                self.server.llm_provider.reconfigure(api_url=api_url, api_key=api_key, model=model)
            ai_cfg_changed = True
            logger.info("LLM config updated — will take effect on next turn. provider=%s url=%s model=%s", provider, api_url, model)
        if ai_cfg_changed:
            cfg = AIConfig(
                provider=event.get("llm_provider", "direct"),
                api_url=event.get("llm_api_url", getattr(self.server.llm_provider, "_api_url", settings.llm_api_url)),
                api_key=event.get("llm_api_key", getattr(self.server.llm_provider, "_api_key", "")),
                model=getattr(self.server.llm_provider, "_model", settings.llm_model),
                max_tokens=getattr(self.server.llm_provider, "_max_tokens", settings.llm_max_tokens),
            )
            save_ai_config(cfg)
        if "stt_enabled" in event:
            self._stt_enabled = bool(event["stt_enabled"])
        if "stt_language" in event:
            self._stt_language = normalize(event["stt_language"])
        if "ui_language" in event:
            self._ui_language = normalize(event["ui_language"])
        if "stt_provider" in event:
            if self._stt_session_active:
                await self.send(
                    {"event": "error", "detail": "Cannot change STT provider during active recording"}
                )
            else:
                new_provider = event["stt_provider"]
                if new_provider != self.server.stt_provider.provider_name:
                    self.server.stt_provider = get_stt_provider(new_provider)
                    if new_provider == "qwen3" and hasattr(self.server.stt_provider, "configure"):
                        self.server.stt_provider.configure(
                            models_dir=event.get("stt_models_dir", settings.qwen_asr_models_dir)
                        )
                    await self.server.broadcast_status()
        if "stt_model" in event:
            if self._stt_session_active:
                await self.send(
                    {"event": "error", "detail": "Cannot change STT model during active recording"}
                )
            else:
                device = event.get("stt_device", "cpu")
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None, self.server.stt_provider.load_model, event["stt_model"], device
                )
        if "stt_device" in event:
            if self._stt_session_active:
                await self.send(
                    {"event": "error", "detail": "Cannot change STT device during active recording"}
                )
            elif self.server.stt_provider.is_loaded:
                current_model = self.server.stt_provider.loaded_model
                self.server.stt_provider.unload_model()
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None, self.server.stt_provider.load_model, current_model, event["stt_device"]
                )
        if "stt_streaming" in event:
            self.server.stt_provider.set_streaming(bool(event["stt_streaming"]))
        if "stt_models_dir" in event:
            if self._stt_session_active:
                await self.send(
                    {"event": "error", "detail": "Cannot change models directory during active recording"}
                )
            elif hasattr(self.server.stt_provider, "configure"):
                was_loaded = self.server.stt_provider.is_loaded
                current_model = self.server.stt_provider.loaded_model
                current_device = self.server.stt_provider.device
                if was_loaded:
                    self.server.stt_provider.unload_model()
                self.server.stt_provider.configure(models_dir=event["stt_models_dir"])
                if was_loaded and current_model:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None, self.server.stt_provider.load_model, current_model, current_device or "cpu"
                    )
        if "stt_vad_mode" in event:
            self._stt_vad_mode = int(event["stt_vad_mode"])
            if self._vad is not None:
                self._vad.set_mode(self._stt_vad_mode)
        if "stt_vad_silence_timeout" in event:
            self._stt_vad_silence_timeout = float(event["stt_vad_silence_timeout"])
        if "input_mode" in event:
            new_mode = event["input_mode"]
            # If an active recording exists, end it cleanly before switching modes.
            if self._stt_session_active:
                await self._handle_audio_end()
            self._input_mode = new_mode
            # Wake word only makes sense in PTT mode.
            if self._input_mode != "ptt" and self._wake_word_enabled:
                self._wake_word_enabled = False
                await self._stop_wake_word()
        if "wake_word_enabled" in event:
            self._wake_word_enabled = bool(event["wake_word_enabled"])
            # Wake word is only allowed in PTT mode; silently ignore ON in other modes.
            if self._input_mode != "ptt":
                self._wake_word_enabled = False
            if self._wake_word_enabled:
                # VAD is mandatory when wake word is active (auto-end relies on it).
                self._stt_vad_enabled = True
                await self._start_wake_word()
            else:
                await self._stop_wake_word()
        if "profile" in event:
            self.server.executor.profile = event["profile"]
        if "stt_vad_enabled" in event:
            # Prevent disabling VAD while wake word is active.
            if self._input_mode == "ptt" and self._wake_word_enabled and not bool(event["stt_vad_enabled"]):
                logger.info("Ignoring stt_vad_enabled=false while wake word is active")
            else:
                self._stt_vad_enabled = bool(event["stt_vad_enabled"])
        if "stt_vad_auto_calibrate" in event:
            self._stt_vad_auto_calibrate = bool(event["stt_vad_auto_calibrate"])
        if "stt_vad_rms_threshold" in event:
            self._stt_vad_rms_threshold = float(event["stt_vad_rms_threshold"])
        if "feedback_mode" in event:
            self._feedback_mode = event["feedback_mode"]
        if "plan_mode" in event:
            self._plan_mode = bool(event["plan_mode"])
        if "game_session_path" in event:
            new_path = event["game_session_path"]
            if new_path:
                settings.game_session_path = Path(new_path).expanduser()
            else:
                settings.game_session_path = Path.home() / ".kali" / "game-sessions"
        if "game_ai_global_timeout_ms" in event:
            try:
                value = int(event["game_ai_global_timeout_ms"])
                if value >= 5000:
                    settings.game_ai_global_timeout_ms = value
                else:
                    await self.send({"event": "error", "detail": "game_ai_global_timeout_ms must be at least 5000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_ai_global_timeout_ms"})
        if "game_connection_id" in event:
            settings.game_connection_id = str(event["game_connection_id"])
        if "game_model" in event:
            settings.game_model = str(event["game_model"])
        if "game_temperature" in event:
            try:
                value = float(event["game_temperature"])
                if 0.0 <= value <= 2.0:
                    settings.game_temperature = value
                else:
                    await self.send({"event": "error", "detail": "game_temperature must be between 0.0 and 2.0"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_temperature"})
        if "game_max_tokens" in event:
            try:
                value = int(event["game_max_tokens"])
                if 128 <= value <= 2048:
                    settings.game_max_tokens = value
                else:
                    await self.send({"event": "error", "detail": "game_max_tokens must be between 128 and 2048"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_max_tokens"})
        if "game_reasoning_max_chars" in event:
            try:
                value = int(event["game_reasoning_max_chars"])
                if value >= 0:
                    settings.game_reasoning_max_chars = value
                else:
                    await self.send({"event": "error", "detail": "game_reasoning_max_chars must be non-negative"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_reasoning_max_chars"})
        if "game_retry_timeout_1_ms" in event:
            try:
                v = int(event["game_retry_timeout_1_ms"])
                if v >= 2000:
                    settings.game_retry_timeouts[0] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_1_ms must be at least 2000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_1_ms"})
        if "game_retry_timeout_2_ms" in event:
            try:
                v = int(event["game_retry_timeout_2_ms"])
                if v >= 2000:
                    settings.game_retry_timeouts[1] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_2_ms must be at least 2000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_2_ms"})
        if "game_retry_timeout_3_ms" in event:
            try:
                v = int(event["game_retry_timeout_3_ms"])
                if v >= 2000:
                    settings.game_retry_timeouts[2] = v
                else:
                    await self.send({"event": "error", "detail": "game_retry_timeout_3_ms must be at least 2000"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_retry_timeout_3_ms"})
        if "game_max_retries" in event:
            try:
                value = int(event["game_max_retries"])
                if 1 <= value <= 5:
                    settings.game_max_retries = value
                else:
                    await self.send({"event": "error", "detail": "game_max_retries must be between 1 and 5"})
            except (TypeError, ValueError):
                await self.send({"event": "error", "detail": "Invalid game_max_retries"})
        if "artifact_diff_preview" in event:
            settings.artifact_diff_preview = bool(event["artifact_diff_preview"])
        # Qwen3 VoiceDesign settings
        if "voice_instructions" in event:
            self._voice_instructions = event["voice_instructions"]
        if "voice_seed" in event:
            self._voice_seed = int(event["voice_seed"])
        # Propagate voice design params to the provider
        if self.server.tts_provider.provider_name == "qwen3":
            if hasattr(self.server.tts_provider, "set_voice_design"):
                self.server.tts_provider.set_voice_design(
                    self._voice_instructions, self._voice_seed
                )
        # Clear resolved config warnings for any keys in this event.
        for key in event:
            if key == "event":
                continue
            self.server._config_warnings.pop(key, None)
        # Persist full user config snapshot to disk.
        self._save_user_config_snapshot()
        await self._emit_status()

    def _save_user_config_snapshot(self) -> None:
        """Collect all current runtime values and persist them to user_config.json."""
        sp = self.server.stt_provider
        cfg = UserConfig(
            # Server-level
            tts_provider=self.server.tts_provider.provider_name,
            tts_model=getattr(self.server.tts_provider, "loaded_model", None),
            tts_device=getattr(self.server.tts_provider, "device", None),
            voice=self.server.tts_pipeline.voice,
            tts_mode=self.server.tts_pipeline.mode,
            auto_tts=self.server.tts_pipeline.auto_tts,
            stt_provider=sp.provider_name,
            stt_model=sp.loaded_model,
            stt_device=sp.device,
            stt_streaming=getattr(sp, "_streaming", True),
            stt_models_dir=str(getattr(sp, "_models_dir", "")) or None,
            tts_models_dir=str(getattr(self.server.tts_provider, "_talker_models_dir", "")) or None,
            profile=self.server.executor.profile,
            artifact_diff_preview=settings.artifact_diff_preview,
            game_session_path=str(settings.game_session_path) if settings.game_session_path else None,
            game_ai_global_timeout_ms=settings.game_ai_global_timeout_ms,
            game_connection_id=settings.game_connection_id or None,
            game_model=settings.game_model or None,
            game_temperature=settings.game_temperature,
            game_max_tokens=settings.game_max_tokens,
            game_retry_timeout_1_ms=settings.game_retry_timeouts[0] if len(settings.game_retry_timeouts) > 0 else None,
            game_retry_timeout_2_ms=settings.game_retry_timeouts[1] if len(settings.game_retry_timeouts) > 1 else None,
            game_retry_timeout_3_ms=settings.game_retry_timeouts[2] if len(settings.game_retry_timeouts) > 2 else None,
            game_max_retries=settings.game_max_retries,
            game_reasoning_max_chars=settings.game_reasoning_max_chars,
            # Per-connection
            stt_enabled=self._stt_enabled,
            stt_language=self._stt_language,
            ui_language=self._ui_language,
            stt_vad_enabled=self._stt_vad_enabled,
            stt_vad_mode=self._stt_vad_mode,
            stt_vad_silence_timeout=self._stt_vad_silence_timeout,
            stt_vad_auto_calibrate=self._stt_vad_auto_calibrate,
            stt_vad_rms_threshold=self._stt_vad_rms_threshold,
            wake_word_enabled=self._wake_word_enabled,
            input_mode=self._input_mode,
            feedback_mode=self._feedback_mode,
            plan_mode=self._plan_mode,
            voice_instructions=self._voice_instructions or "",
            voice_seed=self._voice_seed,
        )
        try:
            save_user_config(cfg)
        except Exception as exc:
            logger.warning("Failed to persist user config: %s", exc)

    async def _emit_status(self) -> None:
        payload = self.server._build_status_payload()
        payload.update({
            "stt_enabled": self._stt_enabled,
            "stt_language": self._stt_language,
            "ui_language": self._ui_language,
            "wake_word_enabled": self._wake_word_enabled,
            "input_mode": self._input_mode,
            "feedback_mode": self._feedback_mode,
            "plan_mode": self._plan_mode,
            "artifact_diff_preview": settings.artifact_diff_preview,
            "tools": [t.name for t in available_tools()],
            "available_profiles": [p["id"] for p in self.server.gateway.list_profiles()],
            "stt_vad_enabled": self._stt_vad_enabled,
            "stt_vad_mode": self._stt_vad_mode,
            "stt_vad_silence_timeout": self._stt_vad_silence_timeout,
            "stt_vad_auto_calibrate": self._stt_vad_auto_calibrate,
            "stt_vad_rms_threshold": self._stt_vad_rms_threshold,
        })
        await self.send(payload)

    async def send(self, payload: dict[str, Any]) -> None:
        async with self._send_lock:
            try:
                await self.ws.send_json(payload)
            except Exception:
                logger.exception("send failed")


def create_app() -> FastAPI:
    """Factory for uvicorn --reload."""
    from .config import settings
    host = os.environ.get("KALI_HOST", settings.host)
    port = int(os.environ.get("KALI_WS_PORT", settings.port))
    server = Server(host=host, port=port)
    return server.app
