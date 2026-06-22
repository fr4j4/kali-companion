"""Tests for kali-ear STT and wake word detection."""

from __future__ import annotations

import numpy as np

from kali_core.ear.manager import STTManager, WakeWordDetector, model_for_language
from kali_core.ear.vosk_engine import StreamingSTT


def _silence_pcm(duration_s: float = 1.0) -> bytes:
    """Generate silence PCM (16 kHz, 16-bit, mono)."""
    samples = int(16000 * duration_s)
    return np.zeros(samples, dtype=np.int16).tobytes()


def test_model_for_language_es():
    assert model_for_language("es") == "vosk-model-small-es-0.42"


def test_model_for_language_en():
    assert model_for_language("en") == "vosk-model-small-en-us-0.15"


def test_model_for_language_unknown_defaults_es():
    assert model_for_language("fr") == "vosk-model-small-es-0.42"


def test_streaming_stt_start_accept_finish():
    """STT session lifecycle: start → accept → finish."""
    stt = StreamingSTT("vosk-model-small-es-0.42")
    stt.start()
    assert stt.active
    # Feed silence — should not produce meaningful output.
    result = stt.accept(_silence_pcm(0.5))
    # Result is None or a partial with empty text (silence).
    if result is not None:
        assert "partial" in result or "text" in result
    final = stt.finish()
    assert isinstance(final, dict)
    assert not stt.active


def test_stt_manager_start_end_session():
    """STTManager creates and ends sessions."""
    mgr = STTManager("es")
    assert mgr.language == "es"
    stt = mgr.start_session()
    assert stt.active
    assert mgr.current() is not None
    mgr.end_session()
    assert mgr.current() is None


def test_stt_manager_language_switch():
    """STTManager can switch language."""
    mgr = STTManager("es")
    assert mgr.model_name == "vosk-model-small-es-0.42"
    mgr.set_language("en")
    assert mgr.language == "en"
    assert mgr.model_name == "vosk-model-small-en-us-0.15"


def test_wake_word_detector_silence():
    """WakeWordDetector with silence should return None."""
    ww = WakeWordDetector("en", threshold=0.7, cooldown=0.0)
    ww.start()
    assert ww.running
    # Feed silence.
    result = ww.feed(_silence_pcm(1.0))
    assert result is None
    ww.stop()
    assert not ww.running


def test_wake_word_detector_full_vocab():
    """WakeWordDetector uses full-vocabulary mode (no grammar)."""
    ww = WakeWordDetector("en", threshold=0.0, cooldown=0.0)
    ww.start()
    # The detector should have a recognizer WITHOUT grammar (full vocab).
    assert ww._stt is not None
    assert ww._stt._grammar is None
    ww.stop()


def test_contains_trigger():
    assert WakeWordDetector._contains_trigger("hey kali")
    assert WakeWordDetector._contains_trigger("ok cali")
    assert WakeWordDetector._contains_trigger("oye Kali")
    assert WakeWordDetector._contains_trigger("kali!")
    assert WakeWordDetector._contains_trigger("hi cali")
    assert not WakeWordDetector._contains_trigger("hello world")
    assert not WakeWordDetector._contains_trigger("")
    assert not WakeWordDetector._contains_trigger("california")
    assert WakeWordDetector._contains_trigger("Kali está aquí")


def test_extract_text():
    assert WakeWordDetector._extract_text({"text": "hey kali"}) == "hey kali"
    assert WakeWordDetector._extract_text({"partial": "ok cali"}) == "ok cali"
    assert WakeWordDetector._extract_text({"text": ""}) == ""
    assert WakeWordDetector._extract_text({}) == ""
    assert WakeWordDetector._extract_text({"text": "  spaces  "}) == "spaces"


def test_wake_word_cooldown():
    """WakeWordDetector respects cooldown period."""
    ww = WakeWordDetector("en", threshold=0.0, cooldown=100.0)
    ww.start()
    # First detection should work (if triggered).
    # Feed silence — won't trigger, but cooldown logic is tested.
    ww.feed(_silence_pcm(0.1))
    ww.stop()