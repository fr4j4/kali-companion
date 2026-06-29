"""Tests for NullTTSProvider — the terminal TTS fallback."""

import asyncio

import pytest
from kali_core.voice.providers.null import NullTTSProvider


def test_null_provider_reports_unavailable():
    p = NullTTSProvider(error="binary missing")
    assert p.provider_name == "unavailable"
    assert p.is_loaded is False
    assert p.is_available is False
    assert p.last_error == "binary missing"
    assert p.device is None
    assert p.loaded_model is None


def test_null_provider_no_error_message():
    p = NullTTSProvider()
    assert p.last_error is None


def test_null_provider_list_models_empty():
    p = NullTTSProvider(error="x")
    assert p.list_models() == []
    assert asyncio.run(p.list_voices()) == []


def test_null_provider_synthesize_raises():
    p = NullTTSProvider(error="qwen3 binary not found")
    with pytest.raises(RuntimeError, match="TTS unavailable: qwen3 binary not found"):
        asyncio.run(p.synthesize("hi", "serena"))


def test_null_provider_load_model_raises():
    p = NullTTSProvider(error="x")
    with pytest.raises(RuntimeError, match="TTS unavailable"):
        p.load_model("any-model")


def test_null_provider_unload_is_noop():
    p = NullTTSProvider(error="x")
    p.unload_model()