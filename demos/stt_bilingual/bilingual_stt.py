"""BilingualSTT — dual-model Vosk with word-level merge.

Feeds audio to both ES and EN models simultaneously. At finish time,
compares per-word confidence on overlapping time intervals and picks
the best word for each segment.

This is a proof of concept — self-contained, no dependencies on kali_core.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import vosk

SAMPLE_RATE = 16000

# Default model search path (relative to this file).
_DEFAULT_MODELS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..",
    "kali-core", "kali_core", "ear", "models",
)
_MODELS_DIR = os.environ.get("VOSK_MODELS_DIR", os.path.normpath(_DEFAULT_MODELS_DIR))

# Cache loaded models to avoid reloading.
_model_cache: dict[str, vosk.Model] = {}


@dataclass
class Word:
    """A single recognized word with timing and confidence."""

    word: str
    start: float  # seconds
    end: float    # seconds
    conf: float   # 0.0 - 1.0
    source: str = "es"  # which model produced this ("es" or "en")


@dataclass
class ModelResult:
    """Full result from one Vosk model."""

    text: str
    words: list[Word] = field(default_factory=list)
    avg_confidence: float = 0.0


@dataclass
class MergeDecision:
    """How a particular word was chosen."""

    final: str
    start: float
    end: float
    conf: float
    source: str
    es_word: str | None = None
    es_conf: float | None = None
    en_word: str | None = None
    en_conf: float | None = None
    reason: str = ""


def _load_model(model_name: str) -> vosk.Model:
    """Load a Vosk model by name, with caching."""
    if model_name in _model_cache:
        return _model_cache[model_name]

    path = os.path.join(_MODELS_DIR, model_name)
    if not os.path.isdir(path):
        raise FileNotFoundError(
            f"Vosk model not found: {path}\n"
            f"Download from https://alphacephei.com/vosk/models"
        )

    print(f"  Loading model: {model_name} ...", end=" ", flush=True)
    model = vosk.Model(path)
    print("OK")
    _model_cache[model_name] = model
    return model


def _extract_result(vosk_result: dict, source: str) -> ModelResult:
    """Parse a Vosk final result dict into a ModelResult."""
    text = vosk_result.get("text", "").strip()
    raw_words = vosk_result.get("result", [])

    words: list[Word] = []
    conf_sum = 0.0

    for w in raw_words:
        word = w.get("word", "")
        start = float(w.get("start", 0.0))
        end = float(w.get("end", start))
        conf = float(w.get("conf", 0.0))
        if word:
            words.append(Word(word=word, start=start, end=end, conf=conf, source=source))
            conf_sum += conf

    avg = conf_sum / len(words) if words else 0.0
    return ModelResult(text=text, words=words, avg_confidence=avg)


def merge_word_level(
    es: ModelResult,
    en: ModelResult,
    confidence_floor: float = 0.4,
) -> tuple[list[Word], list[MergeDecision]]:
    """Merge two model results by picking the best word per time interval.

    Uses an interval-sweep algorithm:
    1. Collect all time boundaries (start/end) from both models.
    2. For each sub-interval, find the active ES word and EN word.
    3. Pick the one with higher confidence.
    4. Group consecutive sub-intervals won by the same word into a single
       output word. This correctly handles the case where one model hears
       a single long word and the other hears two shorter words for the
       same time span — both shorter words survive if they win.

    Returns (merged_words, decisions) where decisions explains each pick.
    """
    # Collect all time boundaries.
    boundaries: set[float] = set()
    for w in es.words + en.words:
        boundaries.add(round(w.start, 3))
        boundaries.add(round(w.end, 3))
    sorted_boundaries = sorted(boundaries)

    if len(sorted_boundaries) < 2:
        return [], []

    # For each sub-interval, find the active word from each model.
    # An word is "active" if its [start, end) overlaps the sub-interval.
    def _active_in(word: Word, seg_start: float, seg_end: float) -> bool:
        return word.start < seg_end and seg_start < word.end

    # Build per-segment winners.
    segment_winners: list[tuple[float, float, Word | None, Word | None, Word | None]] = []
    # (seg_start, seg_end, es_active, en_active, winner)

    for i in range(len(sorted_boundaries) - 1):
        seg_start = sorted_boundaries[i]
        seg_end = sorted_boundaries[i + 1]

        es_active = next(
            (w for w in es.words if _active_in(w, seg_start, seg_end)), None
        )
        en_active = next(
            (w for w in en.words if _active_in(w, seg_start, seg_end)), None
        )

        # Pick winner for this segment.
        candidates = []
        if es_active and es_active.conf >= confidence_floor:
            candidates.append(es_active)
        if en_active and en_active.conf >= confidence_floor:
            candidates.append(en_active)

        winner = max(candidates, key=lambda w: w.conf) if candidates else None
        segment_winners.append((seg_start, seg_end, es_active, en_active, winner))

    # Group consecutive segments won by the same word into one output.
    merged: list[Word] = []
    decisions: list[MergeDecision] = []

    current_word: Word | None = None
    current_es: Word | None = None
    current_en: Word | None = None
    seg_start: float = 0.0

    for seg_s, seg_e, es_w, en_w, winner in segment_winners:
        if winner is None:
            # Gap — flush current word if any.
            if current_word is not None:
                merged.append(current_word)
                decisions.append(_make_decision(current_word, current_es, current_en))
                current_word = None
                current_es = None
                current_en = None
            continue

        if current_word is None or winner.word != current_word.word:
            # New word starts — flush previous.
            if current_word is not None:
                merged.append(current_word)
                decisions.append(_make_decision(current_word, current_es, current_en))
            current_word = Word(
                word=winner.word,
                start=seg_s,
                end=seg_e,
                conf=winner.conf,
                source=winner.source,
            )
            current_es = es_w
            current_en = en_w
        else:
            # Same word continues — extend end time.
            current_word.end = seg_e

    # Flush last word.
    if current_word is not None:
        merged.append(current_word)
        decisions.append(_make_decision(current_word, current_es, current_en))

    return merged, decisions


def _make_decision(
    winner: Word,
    es_cand: Word | None,
    en_cand: Word | None,
) -> MergeDecision:
    """Build a MergeDecision explaining how a word was chosen."""
    reason_parts: list[str] = []
    if es_cand and en_cand:
        reason_parts.append(
            f"ES '{es_cand.word}' ({es_cand.conf:.2f}) vs "
            f"EN '{en_cand.word}' ({en_cand.conf:.2f}) "
            f"→ {winner.source.upper()} wins"
        )
    elif es_cand:
        reason_parts.append(f"ES only ({es_cand.conf:.2f})")
    elif en_cand:
        reason_parts.append(f"EN only ({en_cand.conf:.2f})")
    else:
        reason_parts.append("no candidates")

    return MergeDecision(
        final=winner.word,
        start=winner.start,
        end=winner.end,
        conf=winner.conf,
        source=winner.source,
        es_word=es_cand.word if es_cand else None,
        es_conf=es_cand.conf if es_cand else None,
        en_word=en_cand.word if en_cand else None,
        en_conf=en_cand.conf if en_cand else None,
        reason=" ".join(reason_parts),
    )


class BilingualSTT:
    """Runs ES + EN Vosk models in parallel, merges by word confidence."""

    def __init__(
        self,
        es_model_name: str = "vosk-model-small-es-0.42",
        en_model_name: str = "vosk-model-small-en-us-0.15",
        confidence_floor: float = 0.4,
    ) -> None:
        self._es_model = _load_model(es_model_name)
        self._en_model = _load_model(en_model_name)
        self._es_rec: vosk.KaldiRecognizer | None = None
        self._en_rec: vosk.KaldiRecognizer | None = None
        self._confidence_floor = confidence_floor

    def start(self) -> None:
        """Initialize both recognizers."""
        self._es_rec = vosk.KaldiRecognizer(self._es_model, SAMPLE_RATE)
        self._en_rec = vosk.KaldiRecognizer(self._en_model, SAMPLE_RATE)
        self._es_rec.SetWords(True)
        self._en_rec.SetWords(True)

    def feed(self, chunk: bytes) -> None:
        """Feed a PCM chunk to both models. Partials are discarded."""
        if self._es_rec:
            self._es_rec.AcceptWaveform(chunk)
        if self._en_rec:
            self._en_rec.AcceptWaveform(chunk)

    def finish(self) -> tuple[ModelResult, ModelResult, list[Word], list[MergeDecision]]:
        """End recognition and return both results + merged output.

        Returns:
            (es_result, en_result, merged_words, decisions)
        """
        es_raw = json.loads(self._es_rec.FinalResult()) if self._es_rec else {}
        en_raw = json.loads(self._en_rec.FinalResult()) if self._en_rec else {}

        es_result = _extract_result(es_raw, "es")
        en_result = _extract_result(en_raw, "en")

        merged, decisions = merge_word_level(
            es_result, en_result, self._confidence_floor
        )

        self._es_rec = None
        self._en_rec = None

        return es_result, en_result, merged, decisions

    @property
    def active(self) -> bool:
        return self._es_rec is not None and self._en_rec is not None