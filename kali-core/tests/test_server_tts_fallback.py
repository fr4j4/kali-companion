"""Tests for TTS/STT startup fallback chain and config_warnings surfacing."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from kali_core.config import settings


def test_tts_fallback_to_piper_when_qwen3_fails():
    from kali_core.voice.providers import reset_registry
    reset_registry()
    with patch("kali_core.voice.providers.qwen.QwenTTSProvider.__init__") as mock_qwen_init, \
         patch("kali_core.voice.providers.piper.PiperTTSProvider.__init__", return_value=None):
        mock_qwen_init.side_effect = Exception("binary not found")
        from kali_core.server import _build_tts_provider_with_fallback
        provider, error = _build_tts_provider_with_fallback(configured_id="qwen3")
        assert provider.provider_name == "piper"
        assert error is not None
        assert "binary not found" in error
    reset_registry()


def test_tts_fallback_to_null_when_both_fail():
    from kali_core.voice.providers import reset_registry
    reset_registry()
    with patch("kali_core.voice.providers.qwen.QwenTTSProvider.__init__", side_effect=Exception("no qwen")), \
         patch("kali_core.voice.providers.piper.PiperTTSProvider.__init__", side_effect=Exception("no piper")):
        from kali_core.server import _build_tts_provider_with_fallback
        provider, error = _build_tts_provider_with_fallback(configured_id="qwen3")
        assert provider.provider_name == "unavailable"
        assert error is not None
    reset_registry()


def test_stt_fallback_to_null_when_vosk_model_missing():
    from kali_core.voice.providers import reset_registry
    reset_registry()
    with patch("kali_core.ear.providers.vosk.VoskSTTProvider.load_model", side_effect=FileNotFoundError("no model")):
        from kali_core.server import _build_stt_provider_with_fallback
        provider, error = _build_stt_provider_with_fallback(configured_id="vosk")
        assert provider.provider_name == "unavailable"
        assert error is not None
    reset_registry()


def test_qwen3_voicedesign_env_maps_to_qwen3_provider():
    from kali_core.voice.providers import reset_registry
    reset_registry()
    mock_provider = MagicMock()
    mock_provider.provider_name = "qwen3"
    with patch("kali_core.voice.providers.get_tts_provider", return_value=mock_provider):
        from kali_core.server import _build_tts_provider_with_fallback
        provider, error = _build_tts_provider_with_fallback(configured_id="qwen3-voicedesign")
        assert error is None
        mock_provider.load_model.assert_called_with("qwen3-tts-1.7b-voicedesign", settings.qwen_backend)
    reset_registry()


def test_user_config_has_tts_provider_model_device_fields():
    from kali_core.user_config import UserConfig
    cfg = UserConfig()
    assert cfg.tts_provider is None
    assert cfg.tts_model is None
    assert cfg.tts_device is None
    cfg = UserConfig(tts_provider="qwen3", tts_model="qwen3-tts-0.6b-customvoice", tts_device="cpu")
    assert cfg.tts_provider == "qwen3"
    assert cfg.tts_model == "qwen3-tts-0.6b-customvoice"
    assert cfg.tts_device == "cpu"