"""TTSProvider — the interface every TTS backend implements.

Kali talks to TTS exclusively through this Protocol, so the rest of the
codebase is agnostic to whether synthesis happens in-process (Piper) or
via an external HTTP service (lapis-tts or compatible).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TTSProvider(Protocol):
    """Synthesize text into audio bytes (WAV) plus metadata."""

    @property
    def provider_name(self) -> str: ...

    async def synthesize(
        self,
        text: str,
        voice: str,
        mode: str = "normal",
    ) -> TTSResult:
        """Synthesize `text` using `voice` with the given `mode`.

        Returns a TTSResult with the WAV bytes and timing info.
        """
        ...

    async def list_voices(self) -> list[dict]:
        """Return available voice configs as dicts (id, name, modes)."""
        ...


class TTSResult:
    """Output of a single synthesis call."""

    __slots__ = ("audio", "sample_rate", "duration", "mode", "segment")

    def __init__(
        self,
        audio: bytes,
        sample_rate: int,
        duration: float,
        mode: str = "normal",
        segment: int = 0,
    ) -> None:
        self.audio = audio  # WAV bytes
        self.sample_rate = sample_rate
        self.duration = duration
        self.mode = mode
        self.segment = segment