"""TTSPipeline — orchestrates filter → segment → synthesize → emit.

Given raw LLM text, this pipeline:
  1. Filters the text (strip code/URLs/markdown) for speech-friendliness.
  2. Segments it into ≤max_chunk natural chunks.
  3. Synthesizes each segment via the active TTSProvider.
  4. Yields TTSResult objects in order, so the caller can stream them.

Inspired by the legacy `nanobot.py:_process_tts` flow.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from kali_core.voice.filter import filter_for_tts, segment_for_tts

from .providers.base import TTSProvider, TTSResult

logger = logging.getLogger("kali_core.voice.pipeline")


class TTSPipeline:
    """Filters, segments, and synthesizes text into streaming TTS results."""

    def __init__(
        self,
        provider: TTSProvider,
        voice: str = "glados-es",
        mode: str = "robotic",
        auto_tts: bool = True,
        max_chunk: int = 500,
    ) -> None:
        self.provider = provider
        self.voice = voice
        self.mode = mode
        self.auto_tts = auto_tts
        self.max_chunk = max_chunk

    def set_voice(self, voice: str | None = None, mode: str | None = None) -> None:
        if voice is not None:
            self.voice = voice
        if mode is not None:
            self.mode = mode

    def set_auto_tts(self, enabled: bool) -> None:
        self.auto_tts = enabled

    def filter_text(self, raw_text: str) -> tuple[str, str]:
        """Return (filtered_text, raw_text) for reporting."""
        filtered = filter_for_tts(raw_text)
        return filtered, raw_text

    async def synthesize_stream(self, raw_text: str) -> AsyncIterator[TTSResult]:
        """Filter, segment, and synthesize. Yields TTSResult per segment."""
        if not self.auto_tts:
            return

        filtered, raw = self.filter_text(raw_text)
        if not filtered.strip():
            return

        segments = segment_for_tts(filtered, max_chunk=self.max_chunk)
        if not segments:
            return

        for i, segment in enumerate(segments):
            try:
                result = await self.provider.synthesize(
                    segment,
                    voice=self.voice,
                    mode=self.mode,
                )
                result.segment = i
                yield result
            except Exception as exc:
                logger.error("TTS synthesis failed for segment %d: %s", i, exc)