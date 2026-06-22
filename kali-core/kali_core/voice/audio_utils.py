"""Audio helpers for kali-voice.

WAV ↔ numpy conversions and silence insertion. Ported and simplified from
lapis-tts `src/utils/audio.py`.
"""

from __future__ import annotations

import io
import struct
import wave

import numpy as np


def wav_bytes_to_numpy(data: bytes) -> tuple[np.ndarray, int]:
    """Decode WAV bytes into a float32 numpy array and sample rate.

    Returns (audio_mono_float32, sample_rate).
    """
    if len(data) < 44 or data[:4] != b"RIFF":
        return np.zeros(0, dtype=np.float32), 22050

    # Parse fmt chunk for channels + sample_rate.
    offset = 12
    channels = 1
    sample_rate = 22050
    bits_per_sample = 16
    while offset < len(data) - 8:
        chunk_id = data[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
        if chunk_id == b"fmt ":
            channels = struct.unpack_from("<H", data, offset + 10)[0]
            sample_rate = struct.unpack_from("<I", data, offset + 12)[0]
            bits_per_sample = struct.unpack_from("<H", data, offset + 22)[0]
            break
        offset += 8 + chunk_size

    # Find data chunk.
    offset = 12
    pcm_data = b""
    while offset < len(data) - 8:
        chunk_id = data[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
        if chunk_id == b"data":
            if chunk_size >= 0xFFFFFFF0:
                chunk_size = len(data) - offset - 8
            pcm_data = data[offset + 8 : offset + 8 + chunk_size]
            break
        offset += 8 + chunk_size

    if not pcm_data:
        pcm_data = data[44:]

    if bits_per_sample == 16:
        audio = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
    elif bits_per_sample == 32:
        audio = np.frombuffer(pcm_data, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        audio = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    return audio, sample_rate


def numpy_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Encode a float32 numpy array into 16-bit PCM WAV bytes."""
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767).astype(np.int16).tobytes()

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()


def add_silence(audio: bytes, seconds: float, sample_rate: int = 22050) -> bytes:
    """Prepend `seconds` of silence to a WAV byte buffer."""
    arr, sr = wav_bytes_to_numpy(audio)
    silence = np.zeros(int(sr * seconds), dtype=np.float32)
    combined = np.concatenate([silence, arr])
    return numpy_to_wav_bytes(combined, sr)


def add_silence_at_end(audio: bytes, seconds: float, sample_rate: int = 22050) -> bytes:
    """Append `seconds` of silence to a WAV byte buffer."""
    arr, sr = wav_bytes_to_numpy(audio)
    silence = np.zeros(int(sr * seconds), dtype=np.float32)
    combined = np.concatenate([arr, silence])
    return numpy_to_wav_bytes(combined, sr)


def get_wav_duration(data: bytes) -> float:
    """Return the duration in seconds of a WAV byte buffer."""
    arr, sr = wav_bytes_to_numpy(data)
    return len(arr) / sr if sr > 0 else 0.0