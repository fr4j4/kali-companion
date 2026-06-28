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
import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import Literal

from ..canvas.registry import (
    NON_STREAMABLE_TYPES,
    STREAMABLE_TYPES,
)

# ── Artifact type classification ──────────────────────────────
#
# Reexported from ``canvas.registry`` (the single source of truth) so
# existing imports (`from kali_core.mind.artifact_stream import
# STREAMABLE_TYPES`) keep working. The canonical definitions live in
# registry.py alongside ``is_streamable_type``.
__all__ = [
    "ArtifactStreamProcessor",
    "ArtifactStreamEvent",
    "FeedResult",
    "STREAMABLE_TYPES",
    "NON_STREAMABLE_TYPES",
]

# All valid artifact types for BEGIN markers.
_VALID_BEGIN_TYPES: frozenset[str] = STREAMABLE_TYPES | NON_STREAMABLE_TYPES

# ── Markers ───────────────────────────────────────────────────

_BEGIN_MARKER = "[BEGIN_ARTIFACT:"
_END_MARKER = "[END_ARTIFACT]"

# Guard for the salvage fallback (1b): a well-formed header is tiny
# ({"title":"...","language":"..."}). If the balanced-scanner consumes more
# than this many chars without closing the JSON, the header is almost
# certainly malformed (e.g. unescaped quotes inside a "content" field) and
# we switch to best-effort salvage.
_SALVAGE_MAX_HEADER_CHARS = 4096

# Regex used by the salvage path to extract the title and to locate the
# start of a (malformed) "content" field. Compiled once.
_TITLE_RE = re.compile(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"')
_CONTENT_FIELD_RE = re.compile(r'"content"\s*:\s*"')

logger = logging.getLogger(__name__)

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
    language: str = ""        # programming language (e.g. "python", "java")


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
    language: str = ""
    is_streamable: bool = True
    last_emit_ts: float = 0.0
    salvaged_content: str = ""  # content pulled from a malformed "content" header field


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
                    atype, title, language, salvaged = header_result
                    if not atype:
                        # Malformed marker — treat as chat text.
                        # _chat_emitted was already advanced past it.
                        continue
                    # Start the artifact.
                    events.extend(self._start_artifact(atype, title, language))
                    if self._active is not None:
                        # If the header smuggled a "content" field
                        # (malformed streaming format), seed the artifact
                        # with that content and emit an initial update so
                        # the frontend shows it immediately.
                        if salvaged:
                            self._active.content = salvaged
                            self._active.salvaged_content = salvaged
                            events.append(
                                self._make_event("update", "streaming")
                            )
                            # 1b salvage: the entire buffer was consumed
                            # (the body lived inside the header JSON with
                            # unescaped quotes). Close immediately so any
                            # text the model emits afterwards does not
                            # leak into the artifact content.
                            if self._content_emitted >= len(self._buf):
                                events.extend(self._close_artifact())
                                self._active = None
                                self._content_emitted = 0
                                self._chat_emitted = len(self._buf)
                                self._chat_yielded = len(self._buf)
                                continue
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

    def _try_parse_begin_header(self) -> tuple[str, str, str, str] | None:
        """Try to parse [BEGIN_ARTIFACT: type] {header_json} from buf.

        Returns (artifact_type, title, language, salvaged_content) if
        complete and valid. ``salvaged_content`` is non-empty when the
        model smuggled the artifact body inside a ``"content"`` field of
        the header JSON (a malformed streaming format we rescue
        best-effort).

        Returns ("", "", "", "") if the marker is malformed (treat as
        chat text). Returns None if more chunks are needed.
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
            return ("", "", "", "")

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
            return (atype, "", "", "")

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
                    language = ""
                    salvaged = ""
                    try:
                        parsed = json.loads(raw_json)
                        if isinstance(parsed, dict):
                            title = str(parsed.get("title", ""))
                            language = str(parsed.get("language", ""))
                            # 1a — rescue a smuggled "content" field from a
                            # VALID header JSON. The model sometimes emits
                            # [BEGIN_ARTIFACT: html] {"title":"X","content":"..."}
                            # instead of writing the body as raw text after
                            # the header. Salvage it so the user still sees
                            # the content.
                            if "content" in parsed:
                                salvaged = str(parsed.get("content", ""))
                                logger.warning(
                                    "artifact_stream: header for %s included a "
                                    "'content' field (malformed streaming "
                                    "format) — salvaging %d chars",
                                    atype,
                                    len(salvaged),
                                )
                    except (json.JSONDecodeError, TypeError):
                        pass
                    return (atype, title, language, salvaged)
            i += 1

        # Phase 4 — salvage fallback (1b): the balanced scanner did not
        # close the JSON within a reasonable bound. This almost always
        # means the model put raw HTML/code with unescaped double quotes
        # inside a "content" field, breaking the string-state tracking.
        # Guard with two conditions to avoid false positives on legit
        # partial headers that just need more chunks:
        #   (a) the in-flight header is large (> salvage threshold), AND
        #   (b) the literal "content":" pattern appears in it.
        header_in_flight = self._buf[json_start:]
        if (
            len(header_in_flight) >= _SALVAGE_MAX_HEADER_CHARS
            and _CONTENT_FIELD_RE.search(header_in_flight)
        ):
            salvaged = self._salvage_unescaped_content(header_in_flight)
            if salvaged is not None:
                title_match = _TITLE_RE.search(header_in_flight)
                title = (
                    title_match.group(1)
                    if title_match
                    else ""
                )
                # Decode common JSON escapes in the salvaged title.
                try:
                    title = json.loads(f'"{title}"')
                except (json.JSONDecodeError, TypeError):
                    pass
                logger.warning(
                    "artifact_stream: header for %s had unescaped content "
                    "(malformed JSON) — salvaged %d chars via fallback",
                    atype,
                    len(salvaged),
                )
                # Consume the entire remainder so the artifact body does
                # not also leak as content; flush() will close it.
                self._content_start = n
                self._content_emitted = n
                return (atype, title, "", salvaged)

        return None  # JSON not complete yet

    @staticmethod
    def _salvage_unescaped_content(header: str) -> str | None:
        """Extract raw content from a malformed header of the form
        ``{"title":"...","content":"<raw with unescaped quotes>"}``.

        The model frequently emits the artifact body inside a ``content``
        field but forgets to escape double quotes inside it (e.g.
        ``charset="UTF-8"``), so the JSON is technically invalid. We
        locate the opening of the content string and take everything
        after it, stripping a trailing ``"}`` or ``")]`` if present, then
        decode the JSON escapes we can recognize.
        """
        m = _CONTENT_FIELD_RE.search(header)
        if not m:
            return None
        body = header[m.end():]
        # Strip a trailing close if the model appended one (best-effort).
        for tail in ('"}', '")]', '")\n]', '")'):
            if body.endswith(tail):
                body = body[: -len(tail)]
                break
        # Decode common JSON string escapes. The body may contain raw
        # (non-escaped) quotes from the original HTML, which we keep as-is.
        body = body.replace("\\n", "\n").replace("\\t", "\t")
        body = body.replace('\\"', '"').replace("\\\\", "\\")
        return body

    def _start_artifact(
        self, atype: str, title: str, language: str = ""
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
            language=language,
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
                language=language,
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
                    language=a.language,
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
                language=a.language,
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
            language=a.language,
        )


# NOTE: ``__all__`` is declared near the top of this module (next to the
# reexported STREAMABLE_TYPES / NON_STREAMABLE_TYPES) to keep the public
# surface grouped with the canonical definitions in ``canvas.registry``.