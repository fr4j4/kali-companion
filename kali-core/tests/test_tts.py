"""Smoke tests for kali-voice TTS pipeline."""

from __future__ import annotations

import pytest

from kali_core.voice import InProcTTSProvider, TTSPipeline
from kali_core.voice.audio_utils import get_wav_duration, numpy_to_wav_bytes, wav_bytes_to_numpy
from kali_core.voice.effects import apply_chain, available
from kali_core.voice.filter import filter_for_tts, segment_for_tts


def test_filter_strips_code_blocks():
    text = "Here is code:\n```python\nprint('hi')\n```\nDone."
    filtered = filter_for_tts(text)
    assert "print" not in filtered
    assert "code omitted" in filtered.lower() or "Done" in filtered


def test_filter_strips_urls():
    text = "See [docs](https://example.com) and https://x.com"
    filtered = filter_for_tts(text)
    assert "https" not in filtered
    assert "docs" in filtered


def test_filter_strips_markdown():
    text = "**bold** and *italic* and # heading"
    filtered = filter_for_tts(text)
    assert "**" not in filtered
    assert "*" not in filtered
    assert "bold" in filtered
    assert "italic" in filtered


def test_filter_strips_emojis():
    text = "Hola 🎉🐱✨ ¿qué tal? 😎"
    filtered = filter_for_tts(text)
    assert "🎉" not in filtered
    assert "🐱" not in filtered
    assert "✨" not in filtered
    assert "😎" not in filtered
    assert "Hola" in filtered
    assert "qué tal" in filtered


def test_filter_strips_zwj_emoji_sequences():
    text = "Listo 👨‍💻✅"
    filtered = filter_for_tts(text)
    assert "👨" not in filtered
    assert "💻" not in filtered
    assert "✅" not in filtered
    assert "Listo" in filtered


def test_segment_for_tts_short_text():
    chunks = segment_for_tts("Hello world.", 500)
    assert len(chunks) == 1
    assert chunks[0] == "Hello world."


def test_segment_for_tts_long_text():
    text = ". ".join(["word"] * 200) + "."
    chunks = segment_for_tts(text, 100)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 100


def test_wav_numpy_roundtrip():
    import numpy as np
    audio = np.random.randn(22050).astype(np.float32) * 0.1
    wav = numpy_to_wav_bytes(audio, 22050)
    back, sr = wav_bytes_to_numpy(wav)
    assert sr == 22050
    assert len(back) == len(audio)
    # Roughly equal within quantization error.
    assert abs(back.mean() - audio.mean()) < 0.01


def test_effects_registry_has_all_modes():
    names = available()
    for expected in ("normal", "whisper", "robotic", "radio", "deep", "processed"):
        assert expected in names, f"missing effect: {expected}"


def test_effects_apply_robotic():
    import numpy as np
    audio = np.random.randn(22050).astype(np.float32) * 0.3
    out = apply_chain(audio, 22050, ["robotic"])
    # Robotic includes pitch shift which changes length; just check it
    # produces valid audio of a similar magnitude.
    assert len(out) > 0
    assert out.dtype == np.float32
    assert abs(out).max() <= 1.0


@pytest.mark.asyncio
async def test_inproc_provider_synthesize_robotic():
    provider = InProcTTSProvider()
    result = await provider.synthesize("Hola.", voice="robot-es", mode="robotic")
    assert len(result.audio) > 44
    assert result.mode == "robotic"
    duration = get_wav_duration(result.audio)
    assert duration > 0.1


@pytest.mark.asyncio
async def test_pipeline_synthesize_stream():
    provider = InProcTTSProvider()
    pipeline = TTSPipeline(provider, voice="robot-es", mode="robotic")
    results = []
    async for r in pipeline.synthesize_stream("Hola. Soy Kali. Bienvenido."):
        results.append(r)
    assert len(results) >= 1
    for r in results:
        assert len(r.audio) > 44
        assert r.duration > 0.1