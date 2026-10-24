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
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

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
        language: str = "auto",
    ) -> None:
        self.provider = provider
        self.voice = voice
        self.mode = mode
        self.auto_tts = auto_tts
        self.max_chunk = max_chunk
        self.language = language

    def set_voice(self, voice: str | None = None, mode: str | None = None, language: str | None = None) -> None:
        if voice is not None:
            self.voice = voice
        if mode is not None:
            self.mode = mode
        if language is not None:
            self.language = language

    def set_auto_tts(self, enabled: bool) -> None:
        self.auto_tts = enabled

    def filter_text(self, raw_text: str) -> tuple[str, str]:
        """Return (filtered_text, raw_text) for reporting."""
        filtered = filter_for_tts(raw_text)
        return filtered, raw_text

    def _prepare(self, raw_text: str) -> tuple[list[str], str] | None:
        """Filter and segment *raw_text*; returns (segments, voice) or None when nothing to say."""
        if not self.auto_tts:
            return None

        filtered, raw = self.filter_text(raw_text)
        if not filtered.strip():
            return None

        segments = segment_for_tts(filtered, max_chunk=self.max_chunk)
        if not segments:
            return None

        # Defensive voice validation: if the current voice is not valid for
        # this provider (e.g. after switching providers), try to fall back
        # to the first available voice instead of failing every segment.
        effective_voice = self.voice
        try:
            name = getattr(self.provider, "provider_name", "")
            if name == "piper":
                # Check config manager
                if hasattr(self.provider, "_config_manager") and self.provider._config_manager.has_voice(effective_voice):
                    pass # Valid
                else:
                    # Check disk
                    stem = effective_voice.split("::")[0] if "::" in effective_voice else effective_voice
                    if not (Path(self.provider.voices_dir) / f"{stem}.onnx").exists():
                        # Try to find ANY voice
                        onnx_files = sorted(Path(self.provider.voices_dir).glob("*.onnx"))
                        if onnx_files:
                            effective_voice = onnx_files[0].stem
                            logger.warning(
                                "Voice '%s' not found for piper — falling back to '%s'",
                                self.voice, effective_voice,
                            )
        except Exception:
            pass  # Can't validate — let the synthesizer try and report

        logger.info(
            "synthesize_stream start: provider=%s voice=%s mode=%s lang=%s segments=%d",
            getattr(self.provider, "provider_name", "?"),
            effective_voice,
            self.mode,
            self.language,
            len(segments),
        )
        return segments, effective_voice

    async def synthesize_stream(self, raw_text: str) -> AsyncIterator[TTSResult]:
        """Filter, segment, and synthesize. Yields TTSResult per segment."""
        prepared = self._prepare(raw_text)
        if prepared is None:
            return
        segments, effective_voice = prepared

        for i, segment in enumerate(segments):
            try:
                t0 = time.perf_counter()
                logger.info(
                    "synthesize segment %d: chars=%d voice=%s text_preview=%r",
                    i, len(segment), effective_voice, segment[:80],
                )
                result = await self.provider.synthesize(
                    segment,
                    voice=effective_voice,
                    mode=self.mode,
                    language=self.language,
                )
                elapsed = time.perf_counter() - t0
                logger.info(
                    "synthesize segment %d done: %.3fs bytes=%d",
                    i, elapsed, len(result.audio),
                )
                result.segment = i
                yield result
            except Exception as exc:
                logger.error(
                    "TTS synthesis failed for segment %d (voice=%s, provider=%s): %s",
                    i,
                    self.voice,
                    getattr(self.provider, "provider_name", "?"),
                    exc,
                    exc_info=True,
                )

    @property
    def can_stream_pcm(self) -> bool:
        return self.auto_tts and bool(getattr(self.provider, "supports_streaming", False))

    async def synthesize_pcm_stream(self, raw_text: str) -> AsyncIterator[PcmPiece | TTSResult]:
        """Like synthesize_stream, but yields the provider's PCM as it is generated.

        Per segment: PcmPiece chunks, then one empty PcmPiece with final=True. If the
        stream fails before any audio, that segment falls back to a whole TTSResult
        (WAV), so the caller can keep the old path for it.
        """
        prepared = self._prepare(raw_text)
        if prepared is None:
            return
        segments, effective_voice = prepared
        for i, segment in enumerate(segments):
            got_audio = False
            try:
                async for data in self.provider.synthesize_pcm(  # type: ignore[attr-defined]
                    segment, voice=effective_voice, mode=self.mode, language=self.language,
                ):
                    got_audio = True
                    yield PcmPiece(i, data)
                yield PcmPiece(i, b"", final=True)
                continue
            except Exception as exc:
                if got_audio:
                    # Part of the segment already sounded: close it rather than repeat it.
                    logger.error("PCM stream broke mid-segment %d: %s", i, exc)
                    yield PcmPiece(i, b"", final=True)
                    continue
                logger.warning("PCM stream failed for segment %d (%s); falling back to WAV", i, exc)
            try:
                result = await self.provider.synthesize(
                    segment, voice=effective_voice, mode=self.mode, language=self.language,
                )
                result.segment = i
                yield result
            except Exception as exc:
                logger.error("TTS synthesis failed for segment %d: %s", i, exc, exc_info=True)


@dataclass
class PcmPiece:
    """Raw s16le PCM from a streaming provider; segment is the index within the text."""

    segment: int
    pcm: bytes
    final: bool = False
