"""Numpy-based audio effects for kali-voice (no ffmpeg required).

Each effect is a function `apply(audio: np.ndarray, sr: int, params: dict)
-> np.ndarray`. Effects are registered by name and applied in chains via
`apply_chain`.

The effects aim for character rather than fidelity: `robotic` gives the
GLaDOS-style voice (ring modulation + slight pitch down), `whisper` is
breathy and quiet, `radio` is band-limited like an intercom, etc.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from scipy import signal as sps

# Effect function signature.
EffectFn = Callable[[np.ndarray, int, dict], np.ndarray]

_REGISTRY: dict[str, EffectFn] = {}


def register(name: str) -> Callable[[EffectFn], EffectFn]:
    """Decorator to register an effect under `name`."""

    def deco(fn: EffectFn) -> EffectFn:
        _REGISTRY[name] = fn
        return fn

    return deco


def apply_chain(
    audio: np.ndarray, sr: int, names: list[str], params: dict | None = None
) -> np.ndarray:
    """Apply a list of named effects in order."""
    p = params or {}
    for name in names:
        fn = _REGISTRY.get(name)
        if fn is None:
            continue
        audio = fn(audio, sr, p)
    return audio


def available() -> list[str]:
    return list(_REGISTRY)


# ── Helpers ───────────────────────────────────────────────


def _pitch_shift(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """Pitch shift by `semitones` using resampling (simple, no phase vocoder)."""
    if semitones == 0 or len(audio) == 0:
        return audio
    factor = 2.0 ** (-semitones / 12.0)
    new_len = max(1, int(len(audio) * factor))
    shifted = sps.resample(audio, new_len)
    return shifted.astype(np.float32)


def _lowpass(audio: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
    sos = sps.butter(4, cutoff / (sr / 2), btype="low", output="sos")
    return sps.sosfilt(sos, audio).astype(np.float32)


def _highpass(audio: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
    sos = sps.butter(4, cutoff / (sr / 2), btype="high", output="sos")
    return sps.sosfilt(sos, audio).astype(np.float32)


def _bandpass(audio: np.ndarray, sr: int, low: float, high: float) -> np.ndarray:
    sos = sps.butter(4, [low / (sr / 2), high / (sr / 2)], btype="band", output="sos")
    return sps.sosfilt(sos, audio).astype(np.float32)


# ── Effects ───────────────────────────────────────────────


@register("normal")
def _normal(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    return audio


@register("whisper")
def _whisper(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """Pitch up + reduce volume + low-pass: breathy, quiet whisper."""
    shifted = _pitch_shift(audio, sr, 2.5)
    filtered = _lowpass(shifted, sr, 4000.0)
    return (filtered * 0.5).astype(np.float32)


@register("robotic")
def _robotic(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """GLaDOS-style robotic voice: ring modulation + mid resonance + speaker sim.

    Authentic GLaDOS character (Portal 2):
      1. Ring modulation at ~55 Hz — the classic metallic robot buzz.
      2. Pitch shift UP ~0.5 semitones (davefx is male → neutral).
      3. Speaker-like bandpass (400–3400 Hz).
      4. Resonant peak at ~1.5 kHz (cone resonance).
      5. Light saturation for electronic warmth.
    """
    # 1. Ring modulation at 55 Hz (classic robot metallic buzz).
    t = np.arange(len(audio), dtype=np.float32) / sr
    carrier = np.sin(2 * np.pi * 55.0 * t).astype(np.float32)
    modulated = audio * carrier

    # 2. Pitch up slightly to neutralise the male voice.
    shifted = _pitch_shift(modulated, sr, 0.5)

    # 3. Speaker bandpass.
    band = _bandpass(shifted, sr, 400.0, 3400.0)

    # 4. Resonant peak at 1.5 kHz (biquad peaking EQ via scipy).
    b, a = sps.iirpeak(1500.0 / (sr / 2), Q=2.5)
    peak = sps.tf2sos(b, a)
    resonanted = sps.sosfilt(peak, band).astype(np.float32)

    # 5. Saturation for warmth + level.
    saturated = np.tanh(resonanted * 1.8) / 1.2
    return np.clip(saturated * 1.2, -1.0, 1.0).astype(np.float32)


@register("radio")
def _radio(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """Bandpass 500–3500 Hz + soft compression: intercom/radio sound."""
    band = _bandpass(audio, sr, 500.0, 3500.0)
    # Simple soft compressor (tanh saturation).
    compressed = np.tanh(band * 3.0) / 3.0
    return (compressed * 1.8).astype(np.float32)


@register("deep")
def _deep(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """Pitch down + light feedback reverb: deep, resonant voice."""
    shifted = _pitch_shift(audio, sr, -4.0)
    # Simple reverb: delayed copy at lower volume.
    delay_samples = int(sr * 0.08)
    out = shifted.copy()
    if len(out) > delay_samples:
        out[delay_samples:] += shifted[:-delay_samples] * 0.25
    return np.clip(out * 1.1, -1.0, 1.0).astype(np.float32)


@register("processed")
def _processed(audio: np.ndarray, sr: int, params: dict) -> np.ndarray:
    """Low-pass + tanh distortion: processed/synthetic feel."""
    filtered = _lowpass(audio, sr, 6000.0)
    distorted = np.tanh(filtered * 2.5) / 2.5
    return (distorted * 1.2).astype(np.float32)