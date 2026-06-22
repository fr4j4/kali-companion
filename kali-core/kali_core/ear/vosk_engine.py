"""Vosk streaming speech-to-text — port of the legacy ai-voice-companion STT.

Accepts raw PCM audio (16 kHz, 16-bit signed, mono, little-endian) and
returns partial/final transcription results. Loads the Vosk model from
`kali_core/ear/models/<model_name>`.

The model cache supports multiple models (e.g., es + en) loaded
simultaneously. Grammar mode constrains recognition to a fixed phrase
list — used for wake word detection.
"""

from __future__ import annotations

import json
import logging
import os

import vosk

logger = logging.getLogger("kali_core.ear.vosk_engine")

# ── Model cache ───────────────────────────────────────────
_models: dict[str, vosk.Model] = {}
_model_paths: dict[str, str] = {}

DEFAULT_MODEL_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models"
)


def get_model(model_name: str | None = None) -> vosk.Model:
    """Load or return a cached Vosk model by name."""
    if model_name is None:
        model_name = os.environ.get("KALI_STT_MODEL", "vosk-model-small-es-0.42")

    if model_name in _models:
        return _models[model_name]

    search_paths = [
        os.path.join(DEFAULT_MODEL_DIR, model_name),
        os.path.join(DEFAULT_MODEL_DIR),
    ]

    model_path = None
    for path in search_paths:
        if os.path.isdir(path):
            if os.path.exists(os.path.join(path, "am", "final.mdl")):
                model_path = path
                break
            subdirs = [d for d in os.listdir(path) if os.path.isdir(os.path.join(path, d))]
            if subdirs:
                candidate = os.path.join(path, subdirs[0])
                if os.path.exists(os.path.join(candidate, "am", "final.mdl")):
                    model_path = candidate
                    break

    if model_path is None:
        raise FileNotFoundError(
            f"Vosk model not found in {DEFAULT_MODEL_DIR}. "
            "Download from https://alphacephei.com/vosk/models"
        )

    logger.info("Loading Vosk model from %s", model_path)
    model = vosk.Model(model_path)
    _models[model_name] = model
    _model_paths[model_name] = model_path
    return model


class StreamingSTT:
    """Streaming speech-to-text using Vosk.

    If `grammar` is provided, recognition is constrained to those phrases
    (used for wake word detection). Otherwise, full-vocabulary recognition
    is used.
    """

    SAMPLE_RATE = 16000.0

    def __init__(
        self,
        model_name: str = "vosk-model-small-es-0.42",
        grammar: list[str] | None = None,
    ) -> None:
        self._model_name = model_name
        self._grammar = grammar
        self._recognizer: vosk.KaldiRecognizer | None = None
        self._model: vosk.Model | None = None

    def start(self) -> None:
        """Initialize a new recognition session."""
        self._model = get_model(self._model_name)
        if self._grammar is not None:
            # Grammar mode: constrain recognition to the given phrases.
            grammar_json = json.dumps(self._grammar + ["[unk]"])
            self._recognizer = vosk.KaldiRecognizer(
                self._model, self.SAMPLE_RATE, grammar_json
            )
        else:
            self._recognizer = vosk.KaldiRecognizer(self._model, self.SAMPLE_RATE)
        self._recognizer.SetWords(True)

    def accept(self, chunk: bytes) -> dict | None:
        """Feed a PCM chunk and return any partial/final result."""
        if self._recognizer is None:
            return None

        if self._recognizer.AcceptWaveform(chunk):
            result = json.loads(self._recognizer.Result())
            text = result.get("text", "")
            if text:
                logger.debug("Vosk final: '%s'", text)
            return result
        partial = json.loads(self._recognizer.PartialResult())
        ptext = partial.get("partial", "")
        if ptext:
            logger.debug("Vosk partial: '%s'", ptext)
            return partial
        return None

    def finish(self) -> dict:
        """End recognition and return the final result."""
        if self._recognizer is None:
            return {"text": ""}
        result = json.loads(self._recognizer.FinalResult())
        self._recognizer = None
        return result

    @property
    def active(self) -> bool:
        return self._recognizer is not None