"""Builds the emotion instruction fragment for the LLM system prompt."""

from __future__ import annotations
import json
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent / "emotion_catalog.json"


def build_emotion_prompt_fragment() -> str:
    """Return the emotion instruction text for the system prompt.

    Reads emotion_catalog.json and produces a human-readable list of
    valid emotion tags the LLM can emit via [EMOTION: ETIQUETA].
    """
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    instruction = catalog["instruction"]
    emotions = catalog["emotions"]
    lines = [instruction]
    for e in emotions:
        lines.append(f"  - {e['id']}: {e['description']}")
    lines.append(
        '\nSIEMPRE emite la emoción al final, incluso si la respuesta fue breve.'
        '\nEjemplos:'
        '\n  "¡Listo! He creado el archivo. [EMOTION: feliz]"'
        '\n  "Mmm, no estoy seguro de entender. [EMOTION: confundido]"'
        '\n  "¡Vaya, no esperaba ese resultado! [EMOTION: sorprendido]"'
        '\n  "No pude completar la tarea, hubo un error. [EMOTION: enojado]"'
        '\n  "Lo siento mucho, entiendo cómo te sientes. [EMOTION: triste]"'
        '\n  "¡Me alegra saber eso! [EMOTION: feliz]"'
        '\nRecuerda: NUNCA omitas el bloque [EMOTION: ...] al final.'
    )
    return "\n".join(lines)