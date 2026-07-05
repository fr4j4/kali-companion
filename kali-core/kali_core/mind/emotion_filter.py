"""EmotionStreamFilter — detects and strips <emotion:ETIQUETA/> blocks.

The LLM emits <emotion:ETIQUETA/> blocks to express emotion. This filter
removes them from the text stream (they are not visible to the user) while
accumulating the emotion labels for later reporting.

Handles blocks split across chunks by maintaining a buffer. Only holds back
enough characters to capture a potentially split opening tag.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent / "emotion_catalog.json"

_EMOTION_BLOCK_RE = re.compile(r"<emotion:([a-zA-Z_-]+)/>")
_MAX_HOLD = 25


def _load_valid_emotions() -> set[str]:
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return {e["id"] for e in catalog["emotions"]}


def _find_incomplete_tag(text: str) -> int | None:
    idx = text.rfind("<emotion:")
    if idx == -1:
        return None
    rest = text[idx + len("<emotion:"):]
    if ">" in rest:
        return None
    return idx


class EmotionStreamFilter:
    def __init__(self) -> None:
        self._valid_emotions = _load_valid_emotions()
        self._buf = ""
        self._emotions: list[str] = []

    def reset(self) -> None:
        self._buf = ""
        self._emotions = []

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        return self._process()

    def _process(self) -> str:
        out_parts: list[str] = []

        while True:
            match = _EMOTION_BLOCK_RE.search(self._buf)
            if not match:
                break
            start, end = match.start(), match.end()
            before = self._buf[:start].rstrip()
            if before:
                out_parts.append(before)
            emotion = match.group(1)
            if emotion in self._valid_emotions:
                self._emotions.append(emotion)
            self._buf = self._buf[end:]

        if self._buf:
            incomplete = _find_incomplete_tag(self._buf)
            if incomplete is not None:
                safe_end = max(0, incomplete)
                out_parts.append(self._buf[:safe_end])
                self._buf = self._buf[safe_end:]
            elif len(self._buf) > _MAX_HOLD:
                safe_end = len(self._buf) - _MAX_HOLD
                out_parts.append(self._buf[:safe_end])
                self._buf = self._buf[safe_end:]
            else:
                out_parts.append(self._buf)
                self._buf = ""
        return "".join(out_parts)

    def flush(self) -> list[str]:
        match = _EMOTION_BLOCK_RE.search(self._buf)
        if match:
            emotion = match.group(1)
            if emotion in self._valid_emotions:
                self._emotions.append(emotion)
            self._buf = self._buf[match.end():]
        return self._emotions


__all__ = ["EmotionStreamFilter"]
