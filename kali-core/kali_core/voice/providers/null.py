"""NullTTSProvider — terminal fallback when no TTS provider can start.

Reports an unavailable state so the UI can show a clear indicator, and
raises actionable errors on synthesis so the pipeline logs the reason
instead of a cryptic HTTP error.
"""

from __future__ import annotations

from .base import TTSModelInfo, TTSResult


class NullTTSProvider:
    """A TTS provider that is never ready, used as the last-resort fallback."""

    _provider_name = "unavailable"

    def __init__(self, error: str = "") -> None:
        self._error = error or ""

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def is_loaded(self) -> bool:
        return False

    @property
    def device(self) -> str | None:
        return None

    @property
    def loaded_model(self) -> str | None:
        return None

    @property
    def is_available(self) -> bool:
        return False

    @property
    def last_error(self) -> str | None:
        return self._error or None

    def list_models(self) -> list[TTSModelInfo]:
        return []

    def load_model(self, model_id: str, device: str = "cpu") -> None:
        raise RuntimeError(f"TTS unavailable: {self._error}" if self._error else "TTS unavailable")

    def unload_model(self) -> None:
        pass

    async def list_voices(self) -> list[dict]:
        return []

    async def synthesize(self, text: str, voice: str, mode: str = "normal", language: str = "auto") -> TTSResult:
        raise RuntimeError(f"TTS unavailable: {self._error}" if self._error else "TTS unavailable")

    async def preview(self, voice_id: str, text: str, language: str = "en", mode: str = "normal") -> bytes:
        raise RuntimeError(f"TTS unavailable: {self._error}" if self._error else "TTS unavailable")