"""Tests for the TTS provider registry factory and fallback chain."""

import pytest
from kali_core.voice.providers import (
    get_tts_provider,
    list_tts_providers,
    get_tts_fallback,
    TTS_FALLBACK_CHAIN,
    reset_registry,
)


def test_list_tts_providers_returns_all_ids():
    providers = list_tts_providers()
    ids = [p["id"] for p in providers]
    assert "piper" in ids
    assert "qwen3" in ids
    assert "http" in ids
    assert "unavailable" in ids
    for p in providers:
        assert "display_name" in p


def test_get_tts_provider_unavailable_is_null():
    from kali_core.voice.providers.null import NullTTSProvider
    reset_registry()
    prov = get_tts_provider("unavailable")
    assert isinstance(prov, NullTTSProvider)
    assert prov.provider_name == "unavailable"
    assert prov.is_loaded is False
    assert prov.is_available is False
    reset_registry()


def test_get_tts_provider_unknown_raises():
    reset_registry()
    with pytest.raises(ValueError, match="Unknown TTS provider"):
        get_tts_provider("nonexistent")
    reset_registry()


def test_get_tts_fallback_chain():
    assert get_tts_fallback("qwen3") == "piper"
    assert get_tts_fallback("http") == "piper"
    assert get_tts_fallback("piper") == "unavailable"
    assert get_tts_fallback("unavailable") == "unavailable"


def test_fallback_chain_covers_all_known_ids():
    for pid in [p["id"] for p in list_tts_providers()]:
        assert pid in TTS_FALLBACK_CHAIN