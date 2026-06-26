"""ArtifactStreamProcessor — detects [BEGIN_ARTIFACT]/[END_ARTIFACT] markers
in the LLM token stream and produces progressive artifact events.

When a reasoning-capable or text-based LLM wants to create an artifact that
the user can watch being built in real time, it emits:

    [BEGIN_ARTIFACT: code] {"title": "Herencia Java"}
    public class HerenciaYPolimorfismo {
        ...
    }
    [END_ARTIFACT]

The content between BEGIN and END is plain text (NOT an escaped JSON string),
which is easier for the model to produce and for the user to follow.

This processor is a character-stream state machine that:
1. Passes through normal chat text unchanged (returned as ``chat_text``).
2. On [BEGIN_ARTIFACT: <type>] {<header_json>}: starts capturing an artifact,
   emits a "create" event.
3. While inside: accumulates content. For *streamable* types (code, document,
   diff, html) emits throttled "update" events so the frontend shows the
   content growing live. For *non-streamable* types (mermaid, table, json,
   checklist, chart, quiz) just accumulates silently.
4. On [END_ARTIFACT]: emits a "close" event with the final content.
5. If the stream ends without [END_ARTIFACT]: closes the open artifact with
   whatever content was accumulated (possibly incomplete).

The processor does NOT handle [TOOL_CALL: create_artifact] — that path
remains in the runtime for backward compatibility.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Literal

# ── Artifact type classification ──────────────────────────────

# Streamable types: content is plain text that renders meaningfully as it
# grows. The frontend shows the content live during streaming.
STREAMABLE_TYPES: frozenset[str] = frozenset({
    "code", "document", "diff", "html",
})

# Non-streamable types: content needs to be complete to render (JSON,
# Mermaid syntax, table rows, etc.). The frontend shows a spinner during
# streaming and renders only on close.
NON_STREAMABLE_TYPES: frozenset[str] = frozenset({
    "mermaid", "json", "table", "checklist", "chart", "quiz",
})

# All valid artifact types for BEGIN markers.
_VALID_BEGIN_TYPES: frozenset[str] = STREAMABLE_TYPES | NON_STREAMABLE_TYPES

# ── Markers ───────────────────────────────────────────────────

_BEGIN_MARKER = "[BEGIN_ARTIFACT:"
_END_MARKER = "[END_ARTIFACT]"

# ── Events ────────────────────────────────────────────────────

Phase = Literal["streaming", "complete"]
ArtifactAction = Literal["create", "update", "close"]


@dataclass
class ArtifactStreamEvent:
    """An event emitted by the processor for the runtime to forward as a
    WS ``artifact`` event.

    Fields mirror the WS ``artifact`` payload plus ``phase``.
    """

    artifact_id: str
    artifact_type: str        # domain type: code, document, html, table, ...
    window_type: str          # resolved frontend window type
    title: str
    content: str              # accumulated content so far (or final)
    action: ArtifactAction    # create | update | close
    phase: Phase              # streaming | complete


@dataclass
class FeedResult:
    """Result of feeding a chunk: chat text to emit + artifact events.

    ``chat_text`` is the safe, marker-stripped text that should be yielded
    to the frontend as a delta event. ``artifact_events`` are artifact
    create/update/close events to emit as WS ``artifact`` events.
    """

    chat_text: str = ""
    artifact_events: list[ArtifactStreamEvent] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.artifact_events is None:
            self.artifact_events = []


@dataclass
class _ActiveArtifact:
    """Internal state for an artifact currently being streamed."""

    artifact_id: str
    artifact_type: str
    window_type: str
    title: str
    content: str = ""
    is_streamable: bool = True
    last_emit_ts: float = 0.0


class ArtifactStreamProcessor:
    """Process LLM token stream, detecting BEGIN/END artifact markers.

    Feed chunks via :meth:`feed`. It returns a :class:`FeedResult` with:
    - ``chat_text``: safe text to yield as delta (markers stripped).
    - ``artifact_events``: create/update/close events to emit as WS artifacts.

    The processor also acts as a marker suppressor: text inside BEGIN/END
    is NOT emitted as chat text (it goes to the artifact content buffer).
    """

    def __init__(self, *, throttle_ms: int = 80) -> None:
        self._throttle_s: float = throttle_ms / 1000.0
        self._begin_len: int = len(_BEGIN_MARKER)
        self._end_len: int = len(_END_MARKER)
        self.reset()

    def reset(self) -> None:
        """Clear all state for a fresh streaming step."""
        self._buf: str = ""
        self._chat_emitted: int = 0
        self._chat_yielded: int = 0  # how much chat text has been returned
        self._active: _ActiveArtifact | None = None
        self._content_start: int = 0  # where artifact content begins in buf
        self._content_emitted: int = 0  # how much content has been consumed

    @property
    def has_active_artifact(self) -> bool:
        """True if currently inside a [BEGIN_ARTIFACT] block."""
        return self._active is not None

    def feed(self, chunk: str) -> FeedResult:
        """Append ``chunk`` and return chat text + artifact events.

        Call :meth:`flush` at stream end to close any open artifact and
        release remaining chat text.
        """
        if not chunk:
            return FeedResult()
        self._buf += chunk
        chat_out: list[str] = []
        events: list[ArtifactStreamEvent] = []

        while True:
            if self._active is None:
                # ── Normal chat mode ──
                idx = self._buf.find(_BEGIN_MARKER, self._chat_emitted)
                if idx != -1:
                    # Emit chat text before the marker.
                    if idx > self._chat_yielded:
                        chat_out.append(self._buf[self._chat_yielded:idx])
                    self._chat_emitted = idx
                    self._chat_yielded = idx
                    # Try to parse the BEGIN header.
                    header_result = self._try_parse_begin_header()
                    if header_result is None:
                        # Header not complete — need more chunks.
                        break
                    atype, title = header_result
                    if not atype:
                        # Malformed marker — treat as chat text.
                        # _chat_emitted was already advanced past it.
                        continue
                    # Start the artifact.
                    events.extend(self._start_artifact(atype, title))
                    if self._active is not None:
                        # Continue the loop in artifact mode to process
                        # any content already in the buffer.
                        continue
                    continue
                else:
                    # No BEGIN marker — emit safe chat text, holding back
                    # enough chars for marker boundary detection.
                    hold = min(
                        len(self._buf) - self._chat_emitted,
                        self._begin_len - 1,
                    )
                    safe_end = len(self._buf) - hold
                    if safe_end > self._chat_yielded:
                        chat_out.append(
                            self._buf[self._chat_yielded:safe_end]
                        )
                        self._chat_yielded = safe_end
                    self._chat_emitted = safe_end
                    break
            else:
                # ── Inside artifact ──
                end_idx = self._buf.find(_END_MARKER, self._content_emitted)
                if end_idx != -1:
                    # Emit content up to END marker.
                    new_content = self._buf[self._content_emitted:end_idx]
                    if new_content:
                        self._active.content += new_content
                    self._content_emitted = end_idx + self._end_len
                    # Close the artifact.
                    events.extend(self._close_artifact())
                    # Back to chat mode: chat pointers jump past the END.
                    self._chat_emitted = self._content_emitted
                    self._chat_yielded = self._content_emitted
                    self._active = None
                    self._content_emitted = 0
                    continue
                else:
                    # No END marker — accumulate content (throttled if
                    # streamable), holding back chars for boundary.
                    hold = min(
                        len(self._buf) - self._content_emitted,
                        self._end_len - 1,
                    )
                    safe_end = len(self._buf) - hold
                    if safe_end > self._content_emitted:
                        new_content = self._buf[
                            self._content_emitted:safe_end
                        ]
                        self._active.content += new_content
                        self._content_emitted = safe_end
                        if self._active.is_streamable:
                            now = time.monotonic()
                            if (
                                now - self._active.last_emit_ts
                                >= self._throttle_s
                            ):
                                events.append(
                                    self._make_event("update", "streaming")
                                )
                                self._active.last_emit_ts = now
                    break

        return FeedResult(
            chat_text="".join(chat_out),
            artifact_events=events,
        )

    def flush(self) -> FeedResult:
        """Close any open artifact at stream end and return final events.

        If an artifact is open, emits a "close" event with whatever
        content was accumulated (possibly incomplete). Also releases any
        held-back chat text.
        """
        events: list[ArtifactStreamEvent] = []
        chat_out: list[str] = []

        if self._active is not None:
            # Emit any remaining content that was held back.
            if self._content_emitted < len(self._buf):
                remaining = self._buf[self._content_emitted:]
                end_idx = remaining.find(_END_MARKER)
                if end_idx != -1:
                    self._active.content += remaining[:end_idx]
                else:
                    self._active.content += remaining
            events.extend(self._close_artifact())
            self._active = None
            self._content_emitted = 0
            self._chat_emitted = len(self._buf)
            self._chat_yielded = len(self._buf)
        else:
            # Release held-back chat text.
            if self._chat_yielded < len(self._buf):
                chat_out.append(self._buf[self._chat_yielded:])
                self._chat_yielded = len(self._buf)

        return FeedResult(
            chat_text="".join(chat_out),
            artifact_events=events,
        )

    # ── Internal helpers ──

    def _try_parse_begin_header(self) -> tuple[str, str] | None:
        """Try to parse [BEGIN_ARTIFACT: type] {header_json} from buf.

        Returns (artifact_type, title) if complete and valid.
        Returns ("", "") if the marker is malformed (treat as chat text).
        Returns None if more chunks are needed.
        """
        n = len(self._buf)
        scan = self._chat_emitted + self._begin_len

        # Phase 1: find the closing ']' of [BEGIN_ARTIFACT: type]
        bracket_idx = self._buf.find("]", scan)
        if bracket_idx == -1:
            return None
        atype = self._buf[scan:bracket_idx].strip()
        if atype not in _VALID_BEGIN_TYPES:
            # Invalid type — treat marker as plain chat text.
            # Don't advance _chat_yielded so the marker text gets emitted.
            self._chat_emitted = bracket_idx + 1
            return ("", "")

        # Phase 2: skip whitespace after ']' and find JSON '{'
        json_start = bracket_idx + 1
        while json_start < n and self._buf[json_start] in " \t\n\r":
            json_start += 1
        if json_start >= n:
            return None  # need more chunks
        if self._buf[json_start] != "{":
            # No JSON header — allow [BEGIN_ARTIFACT: code] without JSON.
            self._content_start = json_start
            self._content_emitted = json_start
            return (atype, "")

        # Phase 3: balanced JSON extraction for the header.
        i = json_start + 1
        depth = 1
        in_string = False
        escape = False
        while i < n:
            ch = self._buf[i]
            if escape:
                escape = False
                i += 1
                continue
            if ch == "\\":
                escape = True
                i += 1
                continue
            if ch == '"':
                in_string = not in_string
                i += 1
                continue
            if in_string:
                i += 1
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    raw_json = self._buf[json_start : i + 1]
                    self._content_start = i + 1
                    self._content_emitted = i + 1
                    title = ""
                    try:
                        parsed = json.loads(raw_json)
                        if isinstance(parsed, dict):
                            title = str(parsed.get("title", ""))
                    except (json.JSONDecodeError, TypeError):
                        pass
                    return (atype, title)
            i += 1
        return None  # JSON not complete yet

    def _start_artifact(
        self, atype: str, title: str
    ) -> list[ArtifactStreamEvent]:
        """Start a new active artifact and emit the create event."""
        events: list[ArtifactStreamEvent] = []
        if self._active is not None:
            events.extend(self._close_artifact())

        artifact_id = f"art_{uuid.uuid4().hex[:12]}"
        from ..canvas.registry import resolve_window_type

        window_type = resolve_window_type(atype)
        is_streamable = atype in STREAMABLE_TYPES

        self._active = _ActiveArtifact(
            artifact_id=artifact_id,
            artifact_type=atype,
            window_type=window_type,
            title=title,
            is_streamable=is_streamable,
            last_emit_ts=time.monotonic(),
        )
        events.append(
            ArtifactStreamEvent(
                artifact_id=artifact_id,
                artifact_type=atype,
                window_type=window_type,
                title=title,
                content="",
                action="create",
                phase="streaming",
            )
        )
        return events

    def _close_artifact(self) -> list[ArtifactStreamEvent]:
        """Emit the close event for the active artifact."""
        if self._active is None:
            return []
        a = self._active
        events: list[ArtifactStreamEvent] = []

        # For non-streamable types, emit a final update with all content
        # before the close, so the frontend gets the complete payload.
        if not a.is_streamable:
            events.append(
                ArtifactStreamEvent(
                    artifact_id=a.artifact_id,
                    artifact_type=a.artifact_type,
                    window_type=a.window_type,
                    title=a.title,
                    content=a.content,
                    action="update",
                    phase="streaming",
                )
            )

        events.append(
            ArtifactStreamEvent(
                artifact_id=a.artifact_id,
                artifact_type=a.artifact_type,
                window_type=a.window_type,
                title=a.title,
                content=a.content,
                action="close",
                phase="complete",
            )
        )
        return events

    def _make_event(
        self, action: ArtifactAction, phase: Phase
    ) -> ArtifactStreamEvent:
        """Build an event from the active artifact."""
        a = self._active
        assert a is not None
        return ArtifactStreamEvent(
            artifact_id=a.artifact_id,
            artifact_type=a.artifact_type,
            window_type=a.window_type,
            title=a.title,
            content=a.content,
            action=action,
            phase=phase,
        )


__all__ = [
    "ArtifactStreamProcessor",
    "ArtifactStreamEvent",
    "FeedResult",
    "STREAMABLE_TYPES",
    "NON_STREAMABLE_TYPES",
]