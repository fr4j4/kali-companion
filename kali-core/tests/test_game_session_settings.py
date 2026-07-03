"""Tests for game-session path settings via _apply_settings and _build_status_payload."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from kali_core.config import settings
from kali_core.server import Connection, Server


@pytest.fixture
def settings_helper(monkeypatch):
    class FakeServer:
        _config_warnings: dict[str, str] = {}
        llm_provider = None
        tts_available = True
        tts_error = None
        tts_provider = SimpleNamespace(
            provider_name="piper",
            is_loaded=False,
            loaded_model=None,
            device="cpu",
            is_available=True,
            last_error=None,
            tts_variant=None,
            _talker_models_dir="/tmp",
        )
        tts_pipeline = SimpleNamespace(voice="default", mode="normal", auto_tts=False)
        stt_provider = SimpleNamespace(
            provider_name="vosk",
            loaded_model=None,
            device="cpu",
            is_loaded=False,
            _streaming=True,
            _models_dir="/tmp",
        )
        gaze_client = SimpleNamespace(connected=False)
        executor = SimpleNamespace(profile="dev")
        connections_store = SimpleNamespace(list=lambda: [])
        gateway = SimpleNamespace(list_profiles=lambda: [])

        async def broadcast_status(self) -> None:
            pass

        _build_status_payload = Server._build_status_payload

    class SettingsConnectionHelper(Connection):
        def __init__(self, server: Any) -> None:
            self.server = server
            self.session_id = None
            self._sent: list[dict] = []
            self._stt_session_active = False
            self._input_mode = "ptt"
            self._wake_word_enabled = False
            self._wake_word = None
            self._stt_vad_enabled = True
            self._stt_vad_mode = 2
            self._stt_vad_silence_timeout = 1.0
            self._stt_enabled = False
            self._stt_language = "es"
            self._ui_language = "en"
            self._voice_instructions = ""
            self._voice_seed = -1

        async def send(self, payload: dict) -> None:
            self._sent.append(payload)

        def _save_user_config_snapshot(self) -> None:
            pass

        async def _emit_status(self) -> None:
            payload = self.server._build_status_payload()
            self._sent.append(payload)

    return SettingsConnectionHelper(FakeServer())


@pytest.mark.asyncio
async def test_apply_settings_custom_path(settings_helper, monkeypatch, tmp_path):
    custom = tmp_path / "custom-sessions"
    monkeypatch.setattr(settings, "game_session_path", str(tmp_path / "initial"))
    await settings_helper._apply_settings({
        "event": "settings",
        "game_session_path": str(custom),
    })
    assert settings.game_session_path == custom


@pytest.mark.asyncio
async def test_apply_settings_empty_path_resets_to_default(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_session_path", "/tmp/something")
    await settings_helper._apply_settings({
        "event": "settings",
        "game_session_path": "",
    })
    assert settings.game_session_path == Path.home() / ".kali" / "game-sessions"


@pytest.mark.asyncio
async def test_apply_settings_tilde_expands(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_session_path", "")
    await settings_helper._apply_settings({
        "event": "settings",
        "game_session_path": "~/my-sessions",
    })
    assert settings.game_session_path == Path.home() / "my-sessions"


@pytest.mark.asyncio
async def test_apply_settings_missing_key_leaves_unchanged(settings_helper, monkeypatch, tmp_path):
    current = str(tmp_path / "unchanged")
    monkeypatch.setattr(settings, "game_session_path", current)
    await settings_helper._apply_settings({"event": "settings"})
    assert str(settings.game_session_path) == current


@pytest.mark.asyncio
async def test_build_status_payload_includes_game_session_path(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_session_path", "/tmp/test-game-sessions")
    await settings_helper._emit_status()
    payload = settings_helper._sent[0]
    assert str(payload["game_session_path"]) == "/tmp/test-game-sessions"


@pytest.mark.asyncio
async def test_apply_settings_game_ai_global_timeout_ms(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_ai_global_timeout_ms", 20_000)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_ai_global_timeout_ms": 45_000,
    })
    assert settings.game_ai_global_timeout_ms == 45_000


@pytest.mark.asyncio
async def test_apply_settings_game_ai_global_timeout_ms_rejects_too_low(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_ai_global_timeout_ms", 20_000)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_ai_global_timeout_ms": 1_000,
    })
    assert settings.game_ai_global_timeout_ms == 20_000
    assert any(msg.get("event") == "error" for msg in settings_helper._sent)


@pytest.mark.asyncio
async def test_build_status_payload_includes_game_ai_global_timeout_ms(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_ai_global_timeout_ms", 30_000)
    await settings_helper._emit_status()
    payload = settings_helper._sent[0]
    assert payload["game_ai_global_timeout_ms"] == 30_000


@pytest.mark.asyncio
async def test_apply_settings_game_temperature(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.7)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_temperature": 0.3,
    })
    assert settings.game_temperature == 0.3


@pytest.mark.asyncio
async def test_apply_settings_game_temperature_rejects_out_of_range(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.7)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_temperature": 3.0,
    })
    assert settings.game_temperature == 0.7
    assert any(msg.get("event") == "error" for msg in settings_helper._sent)


@pytest.mark.asyncio
async def test_apply_settings_game_temperature_accepts_boundary(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_temperature", 0.7)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_temperature": 0.0,
    })
    assert settings.game_temperature == 0.0
    await settings_helper._apply_settings({
        "event": "settings",
        "game_temperature": 2.0,
    })
    assert settings.game_temperature == 2.0


@pytest.mark.asyncio
async def test_apply_settings_game_max_tokens(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_tokens", 256)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_max_tokens": 512,
    })
    assert settings.game_max_tokens == 512


@pytest.mark.asyncio
async def test_apply_settings_game_max_tokens_rejects_too_low(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_tokens", 256)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_max_tokens": 8,
    })
    assert settings.game_max_tokens == 256
    assert any(msg.get("event") == "error" for msg in settings_helper._sent)


@pytest.mark.asyncio
async def test_apply_settings_game_max_retries(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_retries", 2)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_max_retries": 3,
    })
    assert settings.game_max_retries == 3


@pytest.mark.asyncio
async def test_apply_settings_game_max_retries_rejects_out_of_range(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_max_retries", 2)
    await settings_helper._apply_settings({
        "event": "settings",
        "game_max_retries": 10,
    })
    assert settings.game_max_retries == 2
    assert any(msg.get("event") == "error" for msg in settings_helper._sent)


@pytest.mark.asyncio
async def test_apply_settings_game_connection_id(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_connection_id", "")
    await settings_helper._apply_settings({
        "event": "settings",
        "game_connection_id": "conn-abc-123",
    })
    assert settings.game_connection_id == "conn-abc-123"


@pytest.mark.asyncio
async def test_apply_settings_game_retry_timeouts(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_retry_timeouts", [12_000, 3_000, 2_000])
    await settings_helper._apply_settings({
        "event": "settings",
        "game_retry_timeout_1_ms": 8_000,
        "game_retry_timeout_2_ms": 4_000,
        "game_retry_timeout_3_ms": 1_500,
    })
    assert settings.game_retry_timeouts == [8_000, 4_000, 1_500]


@pytest.mark.asyncio
async def test_build_status_payload_includes_game_ai_params(settings_helper, monkeypatch):
    monkeypatch.setattr(settings, "game_connection_id", "conn-xyz")
    monkeypatch.setattr(settings, "game_model", "deepseek-v4-flash")
    monkeypatch.setattr(settings, "game_temperature", 0.5)
    monkeypatch.setattr(settings, "game_max_tokens", 128)
    monkeypatch.setattr(settings, "game_retry_timeouts", [10_000, 4_000, 1_000])
    monkeypatch.setattr(settings, "game_max_retries", 3)
    await settings_helper._emit_status()
    payload = settings_helper._sent[0]
    assert payload["game_connection_id"] == "conn-xyz"
    assert payload["game_model"] == "deepseek-v4-flash"
    assert payload["game_temperature"] == 0.5
    assert payload["game_max_tokens"] == 128
    assert payload["game_retry_timeout_1_ms"] == 10_000
    assert payload["game_retry_timeout_2_ms"] == 4_000
    assert payload["game_retry_timeout_3_ms"] == 1_000
    assert payload["game_max_retries"] == 3
