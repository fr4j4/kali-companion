"""User configuration persistence layer.

Loads / saves non-LLM user settings from user_config.json next to ai_config.json.
Falls back to None for all fields when the file does not exist so first-run
is frictionless.  Forward-compatible: unknown keys in the JSON are silently
dropped on load.

All fields default to None, meaning "not set — use env-var defaults".  This
distinguishes "user never configured this" from "user set it to False/0/empty".
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from pathlib import Path

logger = logging.getLogger("kali_core.user_config")

_CONFIG_PATH = Path(__file__).parent.parent.parent / "user_config.json"


@dataclass
class UserConfig:
    """All non-LLM user-settable keys.  None = not set (use env defaults)."""

    # ── Server-level (applied once on startup, shared across connections) ──
    tts_provider: str | None = None
    tts_model: str | None = None
    tts_device: str | None = None
    voice: str | None = None
    tts_mode: str | None = None
    auto_tts: bool | None = None
    stt_provider: str | None = None
    stt_model: str | None = None
    stt_device: str | None = None
    stt_streaming: bool | None = None
    stt_models_dir: str | None = None
    tts_models_dir: str | None = None
    profile: str | None = None
    artifact_diff_preview: bool | None = None
    game_session_path: str | None = None
    game_ai_global_timeout_ms: int | None = None
    game_connection_id: str | None = None
    game_model: str | None = None
    game_temperature: float | None = None
    game_max_tokens: int | None = None
    game_retry_timeout_1_ms: int | None = None
    game_retry_timeout_2_ms: int | None = None
    game_retry_timeout_3_ms: int | None = None
    game_max_retries: int | None = None
    game_reasoning_max_chars: int | None = None

    # ── Per-connection (applied on every new Connection, override env defaults) ──
    stt_enabled: bool | None = None
    stt_language: str | None = None
    ui_language: str | None = None
    stt_vad_enabled: bool | None = None
    stt_vad_mode: int | None = None
    stt_vad_silence_timeout: float | None = None
    stt_vad_auto_calibrate: bool | None = None
    stt_vad_rms_threshold: float | None = None
    wake_word_enabled: bool | None = None
    input_mode: str | None = None
    feedback_mode: str | None = None
    plan_mode: bool | None = None
    voice_instructions: str | None = None
    voice_seed: int | None = None


def load_or_default() -> UserConfig:
    """Load user config from file, falling back to all-None defaults."""
    if not _CONFIG_PATH.exists():
        logger.info("No user_config.json found — using env-var defaults")
        return UserConfig()
    try:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        known = {k: v for k, v in raw.items() if k in UserConfig.__dataclass_fields__}
        logger.info("Loaded user config from %s", _CONFIG_PATH)
        return UserConfig(**known)
    except Exception as exc:
        logger.warning("Failed to load user_config.json (%s) — using defaults", exc)
        return UserConfig()


def save(cfg: UserConfig) -> None:
    """Persist user config to file."""
    try:
        with open(_CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(asdict(cfg), fh, indent=2, ensure_ascii=False)
        logger.info("Saved user config to %s", _CONFIG_PATH)
    except Exception as exc:
        logger.error("Failed to write user_config.json: %s", exc)
        raise