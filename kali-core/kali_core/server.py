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
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from kali_core.claws.base import available_tools, register
from kali_core.claws.command import RunCommandTool
from kali_core.claws.fs import FsListTool, FsReadTool
from kali_core.claws.git import GitDiffTool, GitWorktreeTool
from kali_core.claws.game.dota_live import DotaLiveStateTool
from kali_core.claws.game.fetch_resource import FetchGameResourceTool
from kali_core.claws.game.adapter import get_adapter
from kali_core.claws.launcher import LaunchAppTool
from kali_core.claws.list_monitors import ListMonitorsTool
from kali_core.claws.organize import OrganizeFolderTool
from kali_core.claws.screenshot import ScreenshotTool
from kali_core.claws.stt_corrector import SttCorrectorTool, correct_stt_text
from kali_core.claws.tests import RunTestsTool
from kali_core.claws.web import WebFetchTool, WebSearchTool
from kali_core.collar.consent import ConsentManager as ConsentMgr
from kali_core.collar.gateway import PermissionGateway
from kali_core.config import settings
from kali_core.gaze import GazeClient
from kali_core.ear.manager import STTManager, WakeWordDetector
from kali_core.game.gsi import gsi_state
from kali_core.mind.executor import Executor
from kali_core.mind.jobs import JobManager
from kali_core.mind.llm.direct import DirectLLMProvider
from kali_core.mind.llm.nanobot import NanobotLLMProvider
from kali_core.mind.llm.provider import LLMProvider, ToolDef
from kali_core.mind.runtime import AgentRuntime
from kali_core.nest.store import SessionStore
from kali_core.nest.job_store import JobStore
from kali_core.claws.game.image_cache import download_game_images_handler
from kali_core.voice.pipeline import TTSPipeline
from kali_core.voice.providers.http import HTTPTTSProvider
from kali_core.voice.providers.inproc import InProcTTSProvider
from kali_core.voice.voice_config import VoiceConfigManager

logger = logging.getLogger("kali_core.server")


def _build_llm_provider() -> LLMProvider:
    if settings.llm_provider == "nanobot":
        return NanobotLLMProvider()
    return DirectLLMProvider()


def _build_tts_provider():
    if settings.tts_provider == "http":
        return HTTPTTSProvider()
    return InProcTTSProvider()


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
    # Phase 5 — Dota 2 live match state via GSI.
    register(DotaLiveStateTool())
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
        # Shared components.
        self.llm_provider = _build_llm_provider()
        self.tts_provider = _build_tts_provider()
        self.agent = AgentRuntime(self.llm_provider)
        self.tts_pipeline = TTSPipeline(
            self.tts_provider,
            voice=settings.tts_voice,
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
        )
        # Wire executor + tools into the agent.
        self.agent.set_executor(self.executor)
        self.agent.set_tools(self.tool_defs)
        self._register_routes()

    def _register_routes(self) -> None:
        # Static file serving for cached images.
        images_dir = Path(settings.images_dir)
        images_dir.mkdir(parents=True, exist_ok=True)
        self.app.mount("/images", StaticFiles(directory=str(images_dir)))

        @self.app.websocket("/ws")
        async def ws_endpoint(ws: WebSocket) -> None:
            await ws.accept()
            conn = Connection(ws, self)
            try:
                await conn.run()
            except WebSocketDisconnect:
                logger.info("frontend disconnected")
            except Exception:
                logger.exception("connection error")

        @self.app.get("/health")
        async def health() -> dict[str, Any]:
            return {"status": "ok", "version": "0.1.0"}

        @self.app.get("/voices")
        async def voices() -> dict[str, Any]:
            return {"voices": self.voice_configs.list_voices()}

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
            import json as _json
            return {"state": gsi_state.state, "in_match": gsi_state.in_match}

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


class Connection:
    """One frontend session. Dispatches events and streams responses."""

    def __init__(self, ws: WebSocket, server: Server) -> None:
        self.ws = ws
        self.server = server
        self.session_id: str | None = None
        self._current_task: asyncio.Task | None = None
        self._stt_manager: STTManager | None = None
        self._wake_word: WakeWordDetector | None = None
        self._stt_language: str = settings.stt_language
        self._wake_word_enabled: bool = settings.stt_wake_word_enabled
        self._input_mode: str = settings.input_mode

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
            sess = await self.server.session_store.create_session()
            self.session_id = sess["id"]
            # Set up the consent manager's send callback for this connection.
            self.server.consent.set_send_callback(self.send)
            # Set up the job manager's emit callback for this connection.
            self.server.job_mgr.set_emit_callback(self.send)
            await self.send(
                {"event": "ready", "session_id": self.session_id, "version": "0.1.0"}
            )
            await self._emit_status()
            # Start wake word detector if enabled.
            if self._wake_word_enabled:
                await self._start_wake_word()

        elif kind == "input":
            content = event.get("content", "")
            if content and self.session_id:
                await self._handle_input(content)

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
            if sid:
                self.session_id = sid
                if self.server.agent:
                    self.server.agent.reset_history(sid)
                msgs = await self.server.session_store.get_messages(sid)
                for msg in msgs:
                    self.server.agent._get_history(sid).append({
                        "role": msg["role"],
                        "content": msg["content"],
                    })
                await self.send({"event": "connected", "session_id": sid})
                for msg in msgs:
                    await self.send({
                        "event": "message",
                        "session_id": sid,
                        "role": msg["role"],
                        "text": msg["content"],
                    })
                # Replay persisted artifacts.
                artifacts = await self.server.session_store.get_artifacts(sid)
                for art in artifacts:
                    await self.send({
                        "event": "artifact",
                        "id": art["id"],
                        "type": art["type"],
                        "windowType": art.get("window_type", ""),
                        "title": art["title"],
                        "content": art["content"],
                        "update": "create",
                    })

        elif kind == "list_sessions":
            sessions = await self.server.session_store.list_sessions()
            await self.send({"event": "session_list", "sessions": sessions})

        elif kind == "settings":
            await self._apply_settings(event)

        elif kind == "audio_start":
            await self._handle_audio_start(event)

        elif kind == "audio_end":
            await self._handle_audio_end()

        elif kind == "consent_response":
            # Resolve a pending consent request.
            request_id = event.get("id", "")
            decision = event.get("decision", "cancel")
            self.server.consent.respond(request_id, decision)

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

        else:
            logger.debug("unhandled event: %s", kind)

    # ── Audio / STT ────────────────────────────────────────

    async def _handle_audio_start(self, event: dict[str, Any]) -> None:
        """Start a new STT session."""
        language = event.get("language", self._stt_language)
        if self._stt_manager is None:
            self._stt_manager = STTManager(language)
        else:
            self._stt_manager.set_language(language)
        self._stt_manager.start_session()
        logger.debug("STT session started (lang=%s)", language)

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
        if self._stt_manager is not None:
            stt = self._stt_manager.current()
            if stt is not None and stt.active:
                result = stt.accept(chunk)
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
                            await self.send(
                                {"event": "stt_final", "text": corrected}
                            )

    async def _handle_audio_end(self) -> None:
        """End the STT session and emit the final transcript."""
        if self._stt_manager is not None:
            stt = self._stt_manager.current()
            if stt is not None:
                result = stt.finish()
                text = result.get("text", "").strip()
                # Apply STT correction (fuzzy matching against game terms).
                corrected, changes = correct_stt_text(text)
                if changes:
                    logger.info("STT corrected: %s → %s (changes: %s)", text, corrected, changes)
                    await self.send({"event": "stt_uncorrected", "text": text})
                text = corrected
                await self.send({"event": "stt_final", "text": text})
            self._stt_manager.end_session()

        # Resume wake word if enabled.
        if self._wake_word_enabled and self._wake_word is not None:
            self._wake_word.start()

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

    async def _handle_input(self, content: str) -> None:
        """Route a user message through the agent and TTS pipeline."""
        session_id = self.session_id or "sess_unknown"
        self._current_task = asyncio.create_task(self._run_turn(content, session_id))

    async def _run_turn(self, content: str, session_id: str) -> None:
        """Run one agent turn: stream deltas, execute tools, then synthesize TTS."""
        accumulated = ""
        try:
            # Set the emit callback for tool events.
            self.server.agent.set_emit_callback(self.send)
            async for event in self.server.agent.respond(content, session_id, language=self._stt_language):
                if event.kind == "delta" and event.text:
                    accumulated += event.text
                    await self.send(
                        {"event": "delta", "session_id": session_id, "text": event.text}
                    )
                elif event.kind == "reasoning" and event.text:
                    await self.send(
                        {"event": "reasoning_delta", "session_id": session_id, "text": event.text}
                    )
                elif event.kind == "done":
                    break
        except asyncio.CancelledError:
            await self.send({"event": "turn_end", "session_id": session_id, "cancelled": True})
            return
        except Exception as exc:
            logger.exception("agent turn error")
            await self.send({"event": "error", "detail": str(exc)})
            return

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
        if "voice" in event:
            self.server.tts_pipeline.set_voice(voice=event["voice"])
        if "tts_mode" in event:
            self.server.tts_pipeline.set_voice(mode=event["tts_mode"])
        if "auto_tts" in event:
            self.server.tts_pipeline.set_auto_tts(bool(event["auto_tts"]))
        if "llm_model" in event:
            self.server.llm_provider._model = event["llm_model"]  # type: ignore[attr-defined]
        if "stt_language" in event:
            self._stt_language = event["stt_language"]
            if self._stt_manager is not None:
                self._stt_manager.set_language(self._stt_language)
        if "wake_word_enabled" in event:
            self._wake_word_enabled = bool(event["wake_word_enabled"])
            if self._wake_word_enabled:
                await self._start_wake_word()
            else:
                await self._stop_wake_word()
        if "profile" in event:
            self.server.executor.profile = event["profile"]
        if "input_mode" in event:
            self._input_mode = event["input_mode"]
        await self._emit_status()

    async def _emit_status(self) -> None:
        await self.send(
            {
                "event": "status",
                "llm_provider": self.server.llm_provider.provider_name,
                "llm_model": getattr(self.server.llm_provider, "_model", settings.llm_model),
                "tts_provider": self.server.tts_provider.provider_name,
                "voice": self.server.tts_pipeline.voice,
                "tts_mode": self.server.tts_pipeline.mode,
                "auto_tts": self.server.tts_pipeline.auto_tts,
                "capture_backend": "hyprland" if self.server.gaze_client.connected else "none",
                "profile": self.server.executor.profile,
                "stt_language": self._stt_language,
                "wake_word_enabled": self._wake_word_enabled,
                "input_mode": self._input_mode,
                "tools": [t.name for t in available_tools()],
                "available_profiles": [p["id"] for p in self.server.gateway.list_profiles()],
            }
        )

    async def send(self, payload: dict[str, Any]) -> None:
        try:
            await self.ws.send_json(payload)
        except Exception:
            logger.exception("send failed")