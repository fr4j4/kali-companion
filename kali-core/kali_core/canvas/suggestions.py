"""Suggested changes on a document artifact.

``update_artifact`` in suggestion mode does not touch the text: it stores a
list of proposed replacements (``old`` → ``new``, with a short ``note``). The
document window shows each one struck out and underlined with Accept and
Discard; the user's decision comes back as an ``artifact_suggestion`` event
and is applied here.

The stored content stays plain markdown. What travels to the frontend while
suggestions are pending is ``{"content": md, "suggestions": [...]}``, which
the document widget reads as its data.
"""

from __future__ import annotations

import json
from typing import Any

# Window types whose text can carry suggestions.
SUGGESTIBLE_WINDOW_TYPES = frozenset({"document"})
SUGGESTIBLE_TYPES = frozenset({"markdown", "document"})

MAX_PENDING = 30


def can_suggest(art_type: str, window_type: str) -> bool:
    return window_type in SUGGESTIBLE_WINDOW_TYPES or art_type in SUGGESTIBLE_TYPES


def load(raw: str | None) -> list[dict[str, Any]]:
    """Pending suggestions from their stored JSON (anything malformed counts as none)."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    return [s for s in data if isinstance(s, dict) and isinstance(s.get("id"), str)
            and isinstance(s.get("old"), str) and isinstance(s.get("new"), str)]


def dump(suggestions: list[dict[str, Any]]) -> str:
    return json.dumps(suggestions, ensure_ascii=False)


def add(
    content: str,
    pending: list[dict[str, Any]],
    proposed: Any,
) -> tuple[list[dict[str, Any]], str]:
    """Validate proposed suggestions against the text and append them.

    Returns ``(new_pending, error)``. Every ``old`` must appear in the text
    exactly once, so the frontend and the core mark and replace the same spot.
    """
    if not isinstance(proposed, list) or not proposed:
        return pending, "'suggestions' must be a non-empty list of {old, new, note}."
    out = list(pending)
    next_n = 1 + max((int(s["id"].rsplit("_", 1)[-1]) for s in pending
                      if s["id"].rsplit("_", 1)[-1].isdigit()), default=0)
    for i, s in enumerate(proposed):
        if not isinstance(s, dict) or not isinstance(s.get("old"), str) or not isinstance(s.get("new"), str):
            return pending, f"suggestions[{i}] needs 'old' and 'new' text."
        old = s["old"]
        if not old:
            return pending, f"suggestions[{i}].old is empty."
        count = content.count(old)
        if count == 0:
            return pending, f"suggestions[{i}].old was not found in the document."
        if count > 1:
            return pending, f"suggestions[{i}].old appears {count} times; include more words so it is unique."
        if any(p["old"] == old for p in out):
            return pending, f"suggestions[{i}] overlaps a pending suggestion on the same text."
        item = {"id": f"sug_{next_n}", "old": old, "new": s["new"]}
        note = s.get("note")
        if isinstance(note, str) and note.strip():
            item["note"] = note.strip()[:400]
        out.append(item)
        next_n += 1
    if len(out) > MAX_PENDING:
        return pending, f"Too many pending suggestions (max {MAX_PENDING})."
    return out, ""


def decide(
    content: str,
    pending: list[dict[str, Any]],
    suggestion_id: str,
    decision: str,
) -> tuple[str, list[dict[str, Any]], dict[str, Any] | None]:
    """Apply or drop one suggestion.

    Returns ``(content, pending, suggestion)``; ``suggestion`` is None when the
    id is unknown (already decided, or never existed), and then nothing changes.
    Accepting replaces the first occurrence of ``old``; if the text changed in
    between and ``old`` is gone, the suggestion is dropped without effect.
    """
    found = next((s for s in pending if s["id"] == suggestion_id), None)
    if found is None:
        return content, pending, None
    rest = [s for s in pending if s["id"] != suggestion_id]
    if decision == "accept" and found["old"] in content:
        content = content.replace(found["old"], found["new"], 1)
    # Suggestions whose text no longer exists cannot be shown or applied.
    rest = [s for s in rest if s["old"] in content]
    return content, rest, found


def prune(content: str, pending: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop suggestions whose text a later edit removed."""
    return [s for s in pending if s["old"] in content]


def wire_content(content: str, pending: list[dict[str, Any]]) -> str:
    """What the frontend receives: plain text, or text plus pending suggestions."""
    if not pending:
        return content
    return json.dumps({"content": content, "suggestions": pending}, ensure_ascii=False)


__all__ = ["can_suggest", "load", "dump", "add", "decide", "prune", "wire_content", "MAX_PENDING"]
