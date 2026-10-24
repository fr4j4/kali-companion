"""EmotionStreamFilter — extracts and strips ``[EMOTION: id]`` / ``[EMOTION: id 0.7]`` tags.

The model may tag its mood anywhere in the reply (ideally at the start, so the avatar's face
accompanies the voice). The tags never reach the user, the TTS or the history; each valid tag is
reported as soon as it is complete through :meth:`drain`. Tags split across stream chunks are held
back until they can be resolved, and bracketed text that is not a tag is released untouched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "avatar_catalog.json"

_TAG_RE = re.compile(r"\[EMOTION:\s*([^\]\s]+)(?:\s+(\d*\.?\d+))?\s*\]", re.IGNORECASE)
_PREFIX = "[EMOTION:"
_MAX_HOLD = 48


def _load() -> tuple[set[str], dict[str, str]]:
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return set(catalog["emotions"]), dict(catalog.get("emotionAliases", {}))


def strip_tags(text: str) -> str:
    """Remove every emotion tag from a complete text (defence in depth before saving history/TTS)."""
    return _TAG_RE.sub("", text).strip() if "[" in text else text


class EmotionStreamFilter:
    def __init__(self) -> None:
        self._valid, self._aliases = _load()
        self.reset()

    def reset(self) -> None:
        self._buf = ""
        self._events: list[tuple[str, float | None, int]] = []  # (emotion, intensity, offset in the text feed() returned)
        self._last = ""  # last character emitted ("" = nothing yet)
        self._strip_next = False  # a tag was just removed between spaces: drop the space after it

    def canonical(self, label: str) -> str | None:
        label = label.strip().lower()
        label = self._aliases.get(label, label)
        return label if label in self._valid else None

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        self._eat_space()
        out: list[str] = []
        while True:
            match = _TAG_RE.search(self._buf)
            if not match:
                break
            before = self._buf[: match.start()]
            if before:
                out.append(before)
                self._last = before[-1]
            emotion = self.canonical(match.group(1))
            if emotion:
                intensity = float(match.group(2)) if match.group(2) else None
                self._events.append((emotion, None if intensity is None else min(1.0, intensity), sum(len(piece) for piece in out)))
            self._buf = self._buf[match.end():]
            # A tag between spaces (or at the very start) must not leave a double/leading space.
            self._strip_next = not self._last or self._last.isspace()
            self._eat_space()
        hold = self._hold_index()
        if hold is None:
            released, self._buf = self._buf, ""
        else:
            released, self._buf = self._buf[:hold], self._buf[hold:]
        if released:
            out.append(released)
            self._last = released[-1]
        return "".join(out)

    def _eat_space(self) -> None:
        if self._strip_next:
            self._buf = self._buf.lstrip(" ")
            if self._buf:
                self._strip_next = False

    def _hold_index(self) -> int | None:
        i = self._buf.rfind("[")
        if i == -1:
            return None
        tail = self._buf[i:]
        if len(tail) > _MAX_HOLD:
            return None
        upper = tail.upper()
        if upper.startswith(_PREFIX):
            return i  # unfinished tag (complete ones were consumed above)
        return i if _PREFIX.startswith(upper) else None

    def drain(self) -> list[tuple[str, float | None]]:
        """Tags completed since the last call, as (emotion id, intensity or None)."""
        events, self._events = self._events, []
        return [(emotion, intensity) for emotion, intensity, _ in events]

    def drain_marks(self) -> list[tuple[str, float | None, int]]:
        """Like :meth:`drain`, plus the offset in the text the last ``feed`` returned where each tag stood.

        Lets the caller emit the text before a tag, then the emotion, then the text after it, so
        the emotion keeps its place in the reply (the TTS speaks each stretch with its own emotion).
        """
        events, self._events = self._events, []
        return events

    def flush(self) -> str:
        """End of stream: release held text, except an unterminated tag, which is dropped."""
        rest, self._buf = self._buf, ""
        if rest.upper().startswith(_PREFIX):
            return ""
        return rest


__all__ = ["EmotionStreamFilter", "strip_tags"]
