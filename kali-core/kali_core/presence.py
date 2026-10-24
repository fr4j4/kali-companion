"""Helpers for the compact presence stream mirrored to avatar agents."""

from __future__ import annotations

import base64
import binascii
import io
import wave
from typing import Any


def tts_duration(payload: dict[str, Any]) -> float:
    """Seconds of speech in a `tts_audio` payload.

    Some TTS providers (http, qwen) report duration 0; the avatar needs a real value to know
    how long to keep the mouth moving, so read it from the WAV header (stdlib only).
    """
    reported = payload.get("duration")
    if isinstance(reported, (int, float)) and reported > 0:
        return float(reported)
    audio = payload.get("audio")
    if not isinstance(audio, str) or not audio:
        return 0.0
    try:
        with wave.open(io.BytesIO(base64.b64decode(audio)), "rb") as wav:
            rate = wav.getframerate()
            return wav.getnframes() / rate if rate > 0 else 0.0
    except (binascii.Error, wave.Error, EOFError, ValueError):
        return 0.0


def tts_envelope(payload: dict[str, Any], hz: int = 20) -> str:
    """Mouth-energy envelope of a `tts_audio` WAV: one RMS byte per 1/hz s, base64 (stdlib only).

    Lets the floating and native avatars move the mouth with the real rhythm of the speech
    instead of a synthetic sine. Returns "" when the audio cannot be decoded.
    """
    from array import array

    audio = payload.get("audio")
    if not isinstance(audio, str) or not audio:
        return ""
    try:
        with wave.open(io.BytesIO(base64.b64decode(audio)), "rb") as wav:
            if wav.getsampwidth() != 2 or hz <= 0:
                return ""
            rate, channels = wav.getframerate(), wav.getnchannels()
            samples = array("h")
            samples.frombytes(wav.readframes(wav.getnframes()))
    except (binascii.Error, wave.Error, EOFError, ValueError):
        return ""
    if rate <= 0 or not samples:
        return ""
    window = max(1, rate * channels // hz)
    step = max(1, window // 32)
    raw: list[float] = []
    for start in range(0, len(samples), window):
        chunk = samples[start:start + window:step]
        if not chunk:
            break
        raw.append((sum(v * v for v in chunk) / len(chunk)) ** 0.5)
    peak = max(raw) or 1.0
    # Normalise to the loudest window, with a mild gamma so quiet syllables still open the mouth.
    return base64.b64encode(bytes(min(255, int(255 * (v / peak) ** 0.7)) for v in raw)).decode("ascii")
