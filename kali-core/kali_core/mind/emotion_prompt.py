"""Builds the emotion instruction fragment for the LLM system prompt."""

from __future__ import annotations
import json
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent / "emotion_catalog.json"


def build_emotion_prompt_fragment() -> str:
    """Return the emotion instruction text for the system prompt.

    Reads emotion_catalog.json and produces a human-readable list of
    valid emotion tags the LLM can emit via <emotion:ETIQUETA/>.
    """
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    instruction = catalog["instruction"]
    emotions = catalog["emotions"]
    lines = [instruction]
    for e in emotions:
        lines.append(f"  - {e['id']}: {e['description']}")
    lines.append(
        '\nEmite la emoción SIEMPRE al final de tu respuesta, incluso si fue breve.'
        '\nEjemplos:'
        '\n  "¡Listo! He creado el archivo. <emotion:feliz/>"'
        '\n  "Mmm, no estoy seguro de entender. <emotion:confundido/>"'
        '\n  "¡Vaya, no esperaba ese resultado! <emotion:sorprendido/>"'
        '\n  "No pude completar la tarea, hubo un error. <emotion:enojado/>"'
    )
    return "\n".join(lines)