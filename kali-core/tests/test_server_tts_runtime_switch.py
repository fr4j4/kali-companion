"""Tests for runtime TTS provider/model switch + voice validation."""

from unittest.mock import patch, MagicMock, AsyncMock
import pytest


def test_validate_voice_for_provider_qwen3_rejects_glados():
    from kali_core.server import _validate_voice_for_provider
    from kali_core.voice.providers.qwen import QwenTTSProvider
    with patch.object(QwenTTSProvider, "__init__", return_value=None):
        prov = QwenTTSProvider.__new__(QwenTTSProvider)
        prov._voice_design = False
        with pytest.raises(ValueError, match="not valid for qwen3"):
            _validate_voice_for_provider("glados-es", prov)


def test_validate_voice_for_provider_qwen3_accepts_serena():
    from kali_core.server import _validate_voice_for_provider
    from kali_core.voice.providers.qwen import QwenTTSProvider
    with patch.object(QwenTTSProvider, "__init__", return_value=None):
        prov = QwenTTSProvider.__new__(QwenTTSProvider)
        prov._voice_design = False
        result = _validate_voice_for_provider("serena", prov)
        assert result == "serena"


def test_validate_voice_for_provider_piper_accepts_any():
    from kali_core.server import _validate_voice_for_provider
    from kali_core.voice.providers.piper import PiperTTSProvider
    with patch.object(PiperTTSProvider, "__init__", return_value=None):
        prov = PiperTTSProvider.__new__(PiperTTSProvider)
        prov._config_manager = MagicMock()
        prov._config_manager.has_voice.return_value = True
        result = _validate_voice_for_provider("glados-es", prov)
        assert result == "glados-es"


@pytest.mark.asyncio
async def test_apply_settings_tts_provider_switch_rolls_back_on_failure():
    from kali_core.server import Server, Connection
    from kali_core.voice.providers import reset_registry
    reset_registry()
    server = MagicMock(spec=Server)
    server.tts_provider = MagicMock()
    server.tts_provider.provider_name = "piper"
    server.tts_provider.is_available = True
    server.tts_provider.last_error = None
    server.tts_pipeline = MagicMock()
    server.tts_pipeline.voice = "glados-es"
    server.tts_pipeline.mode = "normal"
    server.tts_pipeline.auto_tts = True
    server._config_warnings = {}
    server.broadcast_status = AsyncMock()
    with patch("kali_core.voice.providers.qwen.QwenTTSProvider.__init__", side_effect=Exception("no qwen")):
        conn = Connection.__new__(Connection)
        conn.server = server
        conn.send = AsyncMock()
        conn._stt_session_active = False
        conn._voice_instructions = ""
        conn._voice_seed = -1
        conn._stt_language = "es"
        conn._stt_vad_enabled = False
        conn._stt_vad_mode = 0
        conn._stt_vad_silence_timeout = 0.0
        conn._stt_vad_auto_calibrate = False
        conn._stt_vad_rms_threshold = 0.0
        conn._wake_word_enabled = False
        conn._input_mode = "text"
        conn._feedback_mode = "minimal"
        conn._plan_mode = False
        conn._save_user_config_snapshot = MagicMock()
        conn._emit_status = AsyncMock()
        await conn._apply_settings({"tts_provider": "qwen3"})
        sent = [c.args[0] for c in conn.send.call_args_list]
        assert any(e.get("event") == "error" for e in sent)
        assert server.tts_provider.provider_name == "piper"
    reset_registry()


@pytest.mark.asyncio
async def test_voice_after_model_load_handles_qwen_and_piper_voice_keys():
    from kali_core.server import _voice_after_model_load
    qwen = MagicMock()
    qwen.list_voices = AsyncMock(return_value=[{"id": "serena", "name": "Serena"}, {"id": "vivian", "name": "Vivian"}])
    assert await _voice_after_model_load(qwen, "glados-es") == "serena"
    assert await _voice_after_model_load(qwen, "vivian") is None

    piper = MagicMock()
    piper.list_voices = AsyncMock(return_value=[{"voice_id": "glados-es"}, {"voice_id": "other"}])
    assert await _voice_after_model_load(piper, "serena") == "glados-es"
    assert await _voice_after_model_load(piper, "other") is None
