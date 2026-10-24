"""Builds the optional emotion-tag instruction for the system prompt from the avatar catalog."""

from __future__ import annotations

import json
import os
from pathlib import Path

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "avatar_catalog.json"


def emotion_tag_enabled() -> bool:
    return os.getenv("KALI_AVATAR_EMOTION_TAG", "1").strip().lower() not in ("0", "false", "no", "off")


def build_emotion_prompt_fragment() -> str:
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    lines = [catalog["prompt"]["intro"]]
    for emotion_id, spec in catalog["emotions"].items():
        lines.append(f"- {emotion_id}: {spec['description']}")
    lines.append("Ejemplos: " + " · ".join(catalog["prompt"]["examples"]))
    return "\n".join(lines)
