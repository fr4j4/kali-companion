"""StreamingArtifactArgParser — incremental JSON parser for the arguments of
a native ``create_artifact`` tool call.

When an LLM uses OpenAI-style native function calling to invoke
``create_artifact``, the HTML/code/document content lives inside the
``arguments`` JSON string (``{"artifact_type":"html","title":"…","content":"…"}``).
That JSON arrives in many small chunks via ``delta.tool_calls[].function.arguments``
and is *escaped* (newlines as ``\\n``, quotes as ``\\"``, etc.).

To show the artifact being built live on the frontend, we want to stream the
unescaped ``content`` to the runtime as if the model had emitted the plain-text
``[BEGIN_ARTIFACT: html] … [END_ARTIFACT]`` markers in ``delta.content`` (which
``ArtifactStreamProcessor`` already knows how to parse in real time).

This module parses the arguments JSON incrementally, char-by-char, tracking
JSON string/escape/brace state (inspired by ``MarkerSuppressor``), and emits:

- ``Field(key, value)`` — when a short field (``artifact_type`` / ``title``)
  completes. Lets the caller decide whether the artifact is streamable before
  the (potentially long) ``content`` arrives.
- ``ContentChunk(text)`` — an *unescaped* slice of the ``content`` string, as
  soon as it arrives. The caller forwards these to the runtime as synthetic
  deltas so ``ArtifactStreamProcessor`` can stream them live.
- ``ContentDone()`` — the ``content`` string closed. The caller emits the
  synthetic ``[END_ARTIFACT]`` marker.
- ``JsonDone(raw_json)`` — the whole JSON object closed. Returned so the
  caller can fall back to the batch tool-call path if needed.

The parser is a single-level object parser: it supports a flat
``{"key": value, …}`` object where values are strings (the schema of
``create_artifact`` is exactly that — ``artifact_type``, ``title``, ``content``
are all strings). Nested objects/arrays inside ``content`` are fine because
they live inside a JSON string (the JSON parser only tracks string escapes,
not nested structure inside strings).

If parsing fails or the JSON is malformed, :attr:`failed` becomes True and
the caller should fall back to the batch path (accumulate the raw JSON and
emit a normal ``tool_call`` event at stream end).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal, Union

from .artifact_stream import STREAMABLE_TYPES

# Keys we care about inside the create_artifact arguments object.
_KEY_ARTIFACT_TYPE = "artifact_type"
_KEY_TITLE = "title"
_KEY_CONTENT = "content"

ArgEventKind = Literal["field", "content_chunk", "content_done", "json_done"]


@dataclass
class ArgEvent:
    """An event emitted by :class:`StreamingArtifactArgParser`."""

    kind: ArgEventKind
    key: str = ""
    value: str = ""
    text: str = ""
    raw_json: str = ""


# Sentinel states for the char-stream state machine.
_S_OBJECT_START = "object_start"      # expecting '{'
_S_KEY_OR_END = "key_or_end"         # inside object, expecting key string or '}'
_S_KEY = "key"                       # scanning a key string
_S_COLON = "colon"                   # expecting ':'
_S_VALUE = "value"                   # expecting a value (only strings supported)
_S_VALUE_STRING = "value_string"     # scanning a value string
_S_AFTER_VALUE = "after_value"        # ',' or '}'
_S_DONE = "done"                     # object closed


class StreamingArtifactArgParser:
    """Incremental parser for a flat ``create_artifact`` arguments JSON.

    Feed chunks via :meth:`feed`. It returns a list of :class:`ArgEvent`
    events. Call :meth:`reset` between tool calls.

    Attributes:
        artifact_type: the resolved artifact type (once known).
        title: the resolved title (once known).
        raw_json: the full accumulated JSON text (for fallback batch path).
        is_streamable: True once ``artifact_type`` is known and is in
            :data:`STREAMABLE_TYPES`.
        failed: True if the JSON is malformed; the caller should fall back to
            accumulating the raw text and parsing it at stream end.
        content_done: True once the ``content`` string closed.
        json_done: True once the whole JSON object closed.
    """

    def __init__(self) -> None:
        self.raw_json: str = ""
        self.reset()

    def reset(self) -> None:
        """Clear state for a new tool call."""
        self.raw_json = ""
        self._buf: str = ""
        self._pos: int = 0
        self._state: str = _S_OBJECT_START
        self._key: str = ""
        self._value: str = ""
        self._escape: bool = False
        self._escape_buf: str = ""
        self._pending_high_surrogate: str | None = None
        # Public-ish results.
        self.artifact_type: str = ""
        self.title: str = ""
        self.content: str = ""
        self.is_streamable: bool | None = None
        self.failed: bool = False
        self.content_done: bool = False
        self.json_done: bool = False
        # Whether we've already emitted the Field event for a key.
        self._artifact_type_emitted: bool = False
        self._title_emitted: bool = False

    # ── Public API ────────────────────────────────────────────

    def feed(self, chunk: str) -> list[ArgEvent]:
        """Append ``chunk`` and return events parsed this call."""
        if not chunk:
            return []
        if self.failed or self.json_done:
            return []
        self.raw_json += chunk
        self._buf += chunk
        events: list[ArgEvent] = []

        while self._pos < len(self._buf) and not self.failed and not self.json_done:
            ch = self._buf[self._pos]
            try:
                if self._state == _S_OBJECT_START:
                    self._handle_object_start(ch)
                elif self._state == _S_KEY_OR_END:
                    self._handle_key_or_end(ch, events)
                elif self._state == _S_KEY:
                    self._handle_key(ch)
                elif self._state == _S_COLON:
                    self._handle_colon(ch)
                elif self._state == _S_VALUE:
                    self._handle_value(ch, events)
                elif self._state == _S_VALUE_STRING:
                    self._handle_value_string(ch, events)
                elif self._state == _S_AFTER_VALUE:
                    self._handle_after_value(ch)
                else:  # _S_DONE
                    break
            except _ParseError as exc:
                self.failed = True
                # Stash the error reason for debugging.
                self._fail_reason = str(exc)
                return events
            self._pos += 1

        # Trim consumed bytes to keep the buffer small.
        if self._pos > 0:
            self._buf = self._buf[self._pos:]
            self._pos = 0
        return events

    def finalize(self) -> ArgEvent | None:
        """At stream end, attempt to parse the full raw_json as a fallback.

        Returns a ``json_done`` event with the raw text if the stream ended
        cleanly, or ``None`` if already done/failed. If the incremental parser
        never finished (e.g. truncated JSON), :attr:`failed` reflects it.
        """
        if self.json_done:
            return ArgEvent(kind="json_done", raw_json=self.raw_json)
        if self.failed:
            return None
        # Try to fully parse the accumulated raw_json. If it's valid, mark done.
        try:
            parsed = json.loads(self.raw_json)
        except (json.JSONDecodeError, TypeError):
            self.failed = True
            return None
        if not isinstance(parsed, dict):
            self.failed = True
            return None
        # Backfill any fields the incremental parser didn't finish.
        if not self.artifact_type:
            self.artifact_type = str(parsed.get(_KEY_ARTIFACT_TYPE, ""))
            self.is_streamable = self.artifact_type in STREAMABLE_TYPES
        if not self.title:
            self.title = str(parsed.get(_KEY_TITLE, ""))
        if not self.content_done:
            self.content = str(parsed.get(_KEY_CONTENT, ""))
            self.content_done = True
        self.json_done = True
        return ArgEvent(kind="json_done", raw_json=self.raw_json)

    # ── State handlers ────────────────────────────────────────

    def _handle_object_start(self, ch: str) -> None:
        if ch in " \t\n\r":
            return
        if ch == "{":
            self._state = _S_KEY_OR_END
            return
        raise _ParseError(f"expected '{{', got {ch!r}")

    def _handle_key_or_end(self, ch: str, events: list[ArgEvent]) -> None:
        if ch in " \t\n\r":
            return
        if ch == "}":
            self._state = _S_DONE
            self.json_done = True
            events.append(ArgEvent(kind="json_done", raw_json=self.raw_json))
            return
        if ch == '"':
            self._state = _S_KEY
            self._key = ""
            self._escape = False
            return
        raise _ParseError(f"expected key or '}}', got {ch!r}")

    def _handle_key(self, ch: str) -> None:
        if self._escape:
            self._key += _unescape_char(ch)
            self._escape = False
            return
        if ch == "\\":
            self._escape = True
            return
        if ch == '"':
            self._state = _S_COLON
            return
        self._key += ch

    def _handle_colon(self, ch: str) -> None:
        if ch in " \t\n\r":
            return
        if ch == ":":
            self._state = _S_VALUE
            self._value = ""
            self._escape = False
            self._escape_buf = ""
            return
        raise _ParseError(f"expected ':', got {ch!r}")

    def _handle_value(self, ch: str, events: list[ArgEvent]) -> None:
        if ch in " \t\n\r":
            return
        if ch == '"':
            self._state = _S_VALUE_STRING
            self._value = ""
            self._escape = False
            self._escape_buf = ""
            return
        # create_artifact only has string values; numbers/null are malformed.
        raise _ParseError(f"expected string value, got {ch!r}")

    def _handle_value_string(self, ch: str, events: list[ArgEvent]) -> None:
        if self._escape:
            # Accumulate the escape sequence: backslash + next char(s).
            self._escape_buf += ch
            decoded = _decode_escape(self._escape_buf)
            if decoded is None:
                # Need more chars (e.g. \uXXXX requires 4 hex digits).
                return
            # We have a complete escape sequence.
            self._escape = False
            self._escape_buf = ""
            if self._key == _KEY_CONTENT:
                self._emit_content_text(decoded, events)
            else:
                self._value += decoded
            return
        if ch == "\\":
            self._escape = True
            self._escape_buf = "\\"
            return
        if ch == '"':
            # Value string closed. Flush any pending high surrogate first.
            self._flush_pending_surrogate(events)
            self._state = _S_AFTER_VALUE
            if self._key == _KEY_CONTENT:
                self.content_done = True
                events.append(ArgEvent(kind="content_done"))
            else:
                self._emit_field(self._key, self._value, events)
            return
        # Regular char.
        self._flush_pending_surrogate(events)
        if self._key == _KEY_CONTENT:
            self._emit_content_text(ch, events)
        else:
            self._value += ch

    def _emit_content_text(self, decoded: str, events: list[ArgEvent]) -> None:
        """Append decoded text to content and emit content_chunk events.

        Handles UTF-16 surrogate pair combination: if a high surrogate is
        pending and ``decoded`` starts with a low surrogate, combine them into
        a single code point before emitting. Otherwise buffer a pending high
        surrogate (without emitting) until the next char arrives, so a lone
        high surrogate never reaches the frontend as a broken char.
        """
        # If we have a pending high surrogate, try to combine with the first
        # char of decoded.
        if self._pending_high_surrogate is not None:
            if decoded and _is_low_surrogate(decoded[0]):
                combined = _combine_surrogate(self._pending_high_surrogate, decoded[0])
                self._pending_high_surrogate = None
                # Emit the combined char + any remaining decoded text.
                full = (combined or "") + decoded[1:]
                if full:
                    self.content += full
                    events.append(ArgEvent(kind="content_chunk", text=full))
                return
            # Not a low surrogate: emit the pending high surrogate as-is,
            # then fall through to emit decoded normally.
            self.content += self._pending_high_surrogate
            events.append(
                ArgEvent(kind="content_chunk", text=self._pending_high_surrogate)
            )
            self._pending_high_surrogate = None

        # If decoded is a single high surrogate, buffer it (don't emit yet)
        # so we can combine with a possible following low surrogate.
        if len(decoded) == 1 and _is_high_surrogate(decoded):
            self._pending_high_surrogate = decoded
            return

        # Normal case: emit decoded text directly.
        if decoded:
            self.content += decoded
            events.append(ArgEvent(kind="content_chunk", text=decoded))

    def _flush_pending_surrogate(self, events: list[ArgEvent]) -> None:
        """Emit any buffered high surrogate as-is (no low surrogate followed)."""
        if self._pending_high_surrogate is not None:
            self.content += self._pending_high_surrogate
            events.append(
                ArgEvent(kind="content_chunk", text=self._pending_high_surrogate)
            )
            self._pending_high_surrogate = None

    def _handle_after_value(self, ch: str) -> None:
        if ch in " \t\n\r":
            return
        if ch == ",":
            self._state = _S_KEY_OR_END
            return
        if ch == "}":
            self._state = _S_DONE
            self.json_done = True
            return
        raise _ParseError(f"expected ',' or '}}', got {ch!r}")

    def _emit_field(self, key: str, value: str, events: list[ArgEvent]) -> None:
        """Emit a Field event for a completed short field."""
        if key == _KEY_ARTIFACT_TYPE and not self._artifact_type_emitted:
            self.artifact_type = value
            self.is_streamable = value in STREAMABLE_TYPES
            self._artifact_type_emitted = True
            events.append(ArgEvent(kind="field", key=key, value=value))
        elif key == _KEY_TITLE and not self._title_emitted:
            self.title = value
            self._title_emitted = True
            events.append(ArgEvent(kind="field", key=key, value=value))
        else:
            # Unknown key or duplicate; still emit so callers can inspect.
            events.append(ArgEvent(kind="field", key=key, value=value))


class _ParseError(Exception):
    """Internal: raised when the JSON is malformed."""


# ── Escape decoding helpers ─────────────────────────────────


def _unescape_char(ch: str) -> str:
    """Decode a single simple JSON escape (the char after backslash)."""
    if ch == "n":
        return "\n"
    if ch == "t":
        return "\t"
    if ch == "r":
        return "\r"
    if ch == '"':
        return '"'
    if ch == "\\":
        return "\\"
    if ch == "/":
        return "/"
    if ch == "u":
        # Needs 4 more hex digits — caller should use _decode_escape.
        return "\\" + "u"
    # Unknown escape: keep it literal (lenient).
    return ch


def _decode_escape(seq: str) -> str | None:
    """Decode a complete JSON escape sequence starting with backslash.

    Returns the decoded char/str, or ``None`` if more chars are needed
    (only ``\\uXXXX`` needs to wait for 4 hex digits after the ``u``).
    """
    if not seq.startswith("\\"):
        return None
    if len(seq) < 2:
        return None
    kind = seq[1]
    if kind in ("n", "t", "r", '"', "\\", "/"):
        mapping = {
            "n": "\n",
            "t": "\t",
            "r": "\r",
            '"': '"',
            "\\": "\\",
            "/": "/",
        }
        return mapping[kind]
    if kind == "u":
        # \uXXXX — need 4 hex digits.
        if len(seq) < 6:
            return None
        hex_digits = seq[2:6]
        try:
            code_point = int(hex_digits, 16)
        except ValueError:
            return ""  # malformed, drop
        # Handle UTF-16 surrogate pairs (emoji etc.): \uD83C\uDF1F
        if 0xD800 <= code_point <= 0xDBFF:
            # High surrogate: wait for the following \uXXXX low surrogate.
            # The parser doesn't track across escapes, so emit the raw bytes
            # as a surrogate char; Python str can hold lone surrogates and
            # the runtime/frontend will recombine them. To keep it simple
            # and robust, we encode back to surrogate pair and decode.
            return chr(code_point)
        return chr(code_point)
    # Unknown escape: keep backslash + char literal (lenient).
    return seq


def _is_high_surrogate(ch: str) -> bool:
    """True if ``ch`` is a single UTF-16 high surrogate code unit."""
    if not ch:
        return False
    return 0xD800 <= ord(ch) <= 0xDBFF


def _is_low_surrogate(ch: str) -> bool:
    """True if ``ch`` is a single UTF-16 low surrogate code unit."""
    if not ch:
        return False
    return 0xDC00 <= ord(ch) <= 0xDFFF


def _combine_surrogate(high: str | None, low: str) -> str | None:
    """Combine a pending high surrogate with a low surrogate into one code point.

    Returns the combined character (e.g. the emoji 🌟), or ``None`` if ``high``
    is None or ``low`` is not a low surrogate (caller should emit ``low`` alone).
    """
    if high is None or not _is_high_surrogate(high):
        return None
    if not _is_low_surrogate(low):
        return None
    code_point = 0x10000 + ((ord(high) - 0xD800) << 10) + (ord(low) - 0xDC00)
    return chr(code_point)


__all__ = [
    "StreamingArtifactArgParser",
    "ArgEvent",
]