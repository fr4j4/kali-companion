"""PiperEngine — in-process Piper TTS synthesis.

Loads `.onnx` voice models from `kali_core/voice/voices/` and synthesizes
text into WAV bytes. Models are cached in memory after first load.

Ported from lapis-tts `src/tts/engine.py`, adapted to the kali package
layout.
"""

from __future__ import annotations

import io
import logging
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig

logger = logging.getLogger("kali_core.voice.engine")


class PiperEngine:
    """Speech synthesis engine using Piper (in-process)."""

    def __init__(self, voices_dir: Path | str) -> None:
        self.voices_dir = Path(voices_dir)
        self._voices: dict[str, PiperVoice] = {}

    def load_voice(self, voice_id: str) -> PiperVoice | None:
        """Load a voice model into memory (cached)."""
        if voice_id in self._voices:
            return self._voices[voice_id]

        model_path = self.voices_dir / f"{voice_id}.onnx"
        config_path = self.voices_dir / f"{voice_id}.onnx.json"

        if not model_path.exists():
            logger.warning("Model not found: %s", model_path)
            return None

        try:
            voice = PiperVoice.load(str(model_path), config_path=str(config_path))
            self._voices[voice_id] = voice
            logger.info("Voice loaded: %s", voice_id)
            return voice
        except Exception as e:
            logger.error("Error loading voice %s: %s", voice_id, e)
            return None

    def synthesize(
        self,
        voice_id: str,
        text: str,
        length_scale: float = 1.0,
        noise_scale: float = 0.667,
        noise_w_scale: float = 0.8,
    ) -> bytes:
        """Generate audio in memory as WAV bytes (16-bit PCM)."""
        voice = self._voices.get(voice_id) or self.load_voice(voice_id)
        if voice is None:
            raise ValueError(f"Voice not found: {voice_id}")

        syn_config = SynthesisConfig(
            length_scale=length_scale,
            noise_scale=noise_scale,
            noise_w_scale=noise_w_scale,
        )

        chunks = list(voice.synthesize(text, syn_config=syn_config))
        if not chunks:
            raise ValueError(f"No audio generated for: {text!r}")

        sample_rate = chunks[0].sample_rate
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            for chunk in chunks:
                wav.writeframes(chunk.audio_int16_bytes)
        return buf.getvalue()

    def list_voices(self) -> list[dict]:
        """List available `.onnx` voice models in the directory."""
        voices: list[dict] = []
        if not self.voices_dir.exists():
            return voices
        for onnx_file in sorted(self.voices_dir.glob("*.onnx")):
            voice_id = onnx_file.stem
            config_file = self.voices_dir / f"{voice_id}.onnx.json"
            voices.append(
                {
                    "voice_id": voice_id,
                    "name": voice_id,
                    "file": str(onnx_file),
                    "config_exists": config_file.exists(),
                }
            )
        return voices