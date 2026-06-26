"""kali-canvas streamer — generic progressive artifact streaming.

Replaces the three duplicated helpers (``_emit_widget`` in dota2_adapter,
two copies of ``_emit_stream`` in fetch_resource) with a single class that
owns the full artifact lifecycle: ``create`` → ``update``* → ``close``.

Usage in a tool/adapter:

    streamer = ArtifactStreamer(ctx, title="Pudge", widget_type="game_resource",
                                domain_type="hero", game="dota")
    await streamer.emit(sections=[], image=img)           # → "create"
    await streamer.emit(sections=[stats_section], image=img)  # → "update"
    await streamer.emit(sections=[stats, abilities, ...])    # → "update"
    schema.raw["_streamed"] = True
    schema.raw["_artifact_id"] = streamer.artifact_id
    return schema

The executor reads ``ToolResult.streamed`` (NOT a magic dict key) to decide
whether to skip the final WS emit. The streamer sets ``streamed=True`` via
``mark_streamed()`` which the tool propagates to ``ToolResult``.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from .registry import resolve_window_type

logger = logging.getLogger("kali_core.canvas.streamer")


class ArtifactStreamer:
    """Manages the progressive emission of a single widget artifact.

    Tolerates ``ctx=None`` (adapter called without context) and sync/async
    emit callbacks — both are no-ops or handled transparently.
    """

    def __init__(
        self,
        ctx: Any = None,
        *,
        title: str = "",
        widget_type: str = "game_resource",
        domain_type: str = "",
        game: str = "",
        artifact_id: str = "",
        window_type: str = "",
    ) -> None:
        self._ctx = ctx
        self._title = title
        self._widget_type = widget_type
        self._domain_type = domain_type
        self._game = game
        self._window_type = window_type or resolve_window_type(domain_type)
        self.artifact_id = artifact_id or f"art_{uuid.uuid4().hex[:8]}"
        self._emitted = False  # True after the first emit (create)
        self.streamed = False  # True once mark_streamed() is called

    @property
    def window_type(self) -> str:
        return self._window_type

    async def emit(
        self,
        sections: list[dict[str, Any]],
        *,
        image: dict[str, Any] | None = None,
        title: str | None = None,
        update: str | None = None,
    ) -> None:
        """Emit a widget payload. First call → ``create``, rest → ``update``.

        Pass ``update`` explicitly to override (e.g. ``"close"``).
        """
        emit = getattr(self._ctx, "emit", None) if self._ctx else None
        if emit is None:
            return

        effective_title = title if title is not None else self._title
        if update is None:
            update = "create" if not self._emitted else "update"

        data = {
            "game": self._game,
            "type": self._domain_type,
            "title": effective_title,
            "image": image,
            "sections": sections,
        }
        item = {
            "title": effective_title,
            "description": "",
            "status": "info",
            "widgetType": self._widget_type,
            "data": data,
        }
        payload = {
            "event": "artifact",
            "id": self.artifact_id,
            "type": "widget",
            "windowType": self._window_type,
            "title": effective_title,
            "content": json.dumps({"items": [item]}),
            "update": update,
        }
        try:
            result = emit(payload)
            if hasattr(result, "__await__"):
                await result
            self._emitted = True
        except Exception:
            logger.warning("Failed to emit artifact update", exc_info=True)

    async def close(self, *, image: dict | None = None) -> None:
        """Emit a ``close`` update, marking the artifact as closed."""
        # close carries no new content; emit with current state.
        await self.emit(sections=[], image=image, update="close")

    def mark_streamed(self) -> None:
        """Flag this streamer as having streamed (tool should set
        ``ToolResult.streamed=True`` and embed ``artifact_id`` in raw)."""
        self.streamed = True


__all__ = ["ArtifactStreamer"]