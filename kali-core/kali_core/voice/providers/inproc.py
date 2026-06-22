"""In-process TTS provider — runs Piper directly inside kali-core.

Loads `.onnx` voice models from `kali_core/voice/voices/` and configs from
`kali_core/voice/voice_configs/`. Synthesizes text into WAV bytes, then
applies the mode's effects chain (numpy-based, no ffmpeg).
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from kali_core.config import settings
from kali_core.voice.audio_utils import (
    get_wav_duration,
    numpy_to_wav_bytes,
    wav_bytes_to_numpy,
)
from kali_core.voice.effects import apply_chain
from kali_core.voice.engine import PiperEngine
from kali_core.voice.voice_config import VoiceConfigManager

from .base import TTSResult

logger = logging.getLogger("kali_core.voice.inproc")


class InProcTTSProvider:
    """In-process Piper TTS with numpy effects."""

    provider_name = "inproc"

    def __init__(
        self,
        voices_dir: Path | None = None,
        voice_configs_dir: Path | None = None,
    ) -> None:
        self.voices_dir = voices_dir or settings.voices_dir
        self.voice_configs_dir = voice_configs_dir or settings.voice_configs_dir
        self._engine = PiperEngine(self.voices_dir)
        self._config_manager = VoiceConfigManager(self.voice_configs_dir)

    async def synthesize(
        self,
        text: str,
        voice: str,
        mode: str = "normal",
    ) -> TTSResult:
        config = self._config_manager.get_voice(voice)
        if config is None:
            raise ValueError(
                f"Voice config '{voice}' not found. "
                f"Available: {[v['voice_id'] for v in self._config_manager.list_voices()]}"
            )

        model = config["model"]
        params = self._config_manager.get_params(voice)
        active_mode = mode or config.get("default_mode", "normal")
        effects = self._config_manager.get_effects_for_mode(voice, active_mode)

        # 1. Piper synthesis → WAV bytes (run in thread to avoid blocking event loop)
        wav_bytes = await asyncio.to_thread(
            self._engine.synthesize,
            model,
            text,
            length_scale=params.get("length_scale", 1.0),
            noise_scale=params.get("noise_scale", 0.667),
            noise_w_scale=params.get("noise_w_scale", 0.8),
        )

        # 2. Apply effects (numpy) if any — also in thread to avoid blocking.
        if effects:
            audio_np, sr = wav_bytes_to_numpy(wav_bytes)
            processed = await asyncio.to_thread(apply_chain, audio_np, sr, effects)
            wav_bytes = numpy_to_wav_bytes(processed, sr)

        duration = get_wav_duration(wav_bytes)
        return TTSResult(
            audio=wav_bytes,
            sample_rate=22050,
            duration=duration,
            mode=mode or config.get("default_mode", "normal"),
        )

    async def list_voices(self) -> list[dict]:
        return self._config_manager.list_voices()