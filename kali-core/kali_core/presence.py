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
