"""kali-ear STT manager — session management, language hot-swap, wake word.

Manages StreamingSTT sessions for the active language and provides a
lightweight wake word detector using Vosk full-vocabulary mode, scanning
partial and final results for trigger keywords ("kali" / "cali").
"""

from __future__ import annotations

import logging
import re
import time

from kali_core.config import settings

from .vosk_engine import StreamingSTT

logger = logging.getLogger("kali_core.ear.manager")

# Trigger words checked in every partial / final result.
_TRIGGER_WORDS = ["kali", "cali"]

# Map language code → default Vosk model name.
_LANG_MODELS: dict[str, str] = {
    "es": "vosk-model-small-es-0.42",
    "en": "vosk-model-small-en-us-0.15",
}


def model_for_language(lang: str) -> str:
    """Return the Vosk model name for a language code."""
    if lang == "es":
        return settings.stt_model
    if lang == "en":
        return settings.stt_model_en
    return settings.stt_model


class STTManager:
    """Manages recognition sessions and language hot-swap."""

    def __init__(self, language: str = "es") -> None:
        self.language = language
        self.model_name = model_for_language(language)
        self._current: StreamingSTT | None = None

    def set_language(self, lang: str) -> None:
        """Switch the active language (takes effect on next session)."""
        self.language = lang
        self.model_name = model_for_language(lang)

    def start_session(self) -> StreamingSTT:
        self._current = StreamingSTT(self.model_name)
        self._current.start()
        return self._current

    def current(self) -> StreamingSTT | None:
        return self._current

    def end_session(self) -> None:
        if self._current is not None:
            self._current.finish()
            self._current = None


class WakeWordDetector:
    """Always-on wake word detector using Vosk full-vocabulary mode.

    Transcribes audio freely (no grammar) and checks every partial / final
    result for trigger keywords ("kali", "cali") at word boundaries.  This
    catches natural variations like "Ok Kali", "Hey, Kali", "Oye Kali",
    "Kali!" and even handles the Vosk model transcribing "Kali" as "Cali".
    """

    def __init__(
        self,
        language: str = "es",
        threshold: float | None = None,
        cooldown: float | None = None,
    ) -> None:
        self.language = language
        self.threshold = threshold or settings.stt_wake_word_threshold
        self.cooldown = cooldown or settings.stt_wake_word_cooldown
        self._stt: StreamingSTT | None = None
        self._last_trigger: float = 0.0
        self._running = False

    def start(self) -> None:
        """Start the wake word listener (full-vocab mode, no grammar)."""
        model_name = model_for_language(self.language)
        self._stt = StreamingSTT(model_name)
        self._stt.start()
        self._running = True
        logger.info(
            "Wake word detector started (model=%s threshold=%.2f)",
            model_name,
            self.threshold,
        )

    def stop(self) -> None:
        """Stop the wake word listener."""
        if self._stt is not None:
            self._stt.finish()
            self._stt = None
        self._running = False
        logger.info("Wake word detector stopped")

    # ── helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _extract_text(result: dict) -> str:
        """Extract the transcription text from a Vosk result dict.

        Final results use the ``text`` key; partials use ``partial``.
        """
        return (result.get("text") or result.get("partial") or "").strip().lower()

    @staticmethod
    def _contains_trigger(text: str) -> bool:
        """Return ``True`` if *text* contains a trigger word at a word boundary."""
        words = re.findall(r"[a-zA-Záéíóúüñ]+", text)
        for w in words:
            wl = w.lower()
            for tw in _TRIGGER_WORDS:
                if wl == tw:
                    return True
        return False

    # ── public API ─────────────────────────────────────────────────────

    def feed(self, chunk: bytes) -> str | None:
        """Feed audio and return the detected phrase if triggered, else None.

        Triggers when a partial *or* final result contains a trigger word
        at word boundaries and (if word-level confidence is available) the
        average confidence meets the threshold.
        """
        if not self._running or self._stt is None:
            return None

        result = self._stt.accept(chunk)
        if result is None:
            return None

        text = self._extract_text(result)
        if not text or text == "[unk]":
            return None

        # Word-level confidence (only present on final results).
        words = result.get("result", [])
        confidence = 1.0
        if words:
            confidence = sum(w.get("conf", 0.0) for w in words) / len(words)
        if confidence < self.threshold:
            logger.debug(
                "WakeWord: '%s' below threshold (conf=%.2f < %.2f)",
                text,
                confidence,
                self.threshold,
            )
            return None

        # Cooldown gate.
        now = time.time()
        if now - self._last_trigger < self.cooldown:
            logger.debug(
                "WakeWord: '%s' in cooldown (%.1fs left)",
                text,
                self.cooldown - (now - self._last_trigger),
            )
            return None

        if not self._contains_trigger(text):
            logger.debug("WakeWord: '%s' no trigger word", text)
            return None

        self._last_trigger = now
        logger.info("Wake word detected: '%s' (confidence=%.2f)", text, confidence)
        return text

    @property
    def running(self) -> bool:
        return self._running