"""MarkerSuppressor — real-time streaming filter for [TOOL_CALL: ...] blocks.

When the LLM emits a prompt-based tool call (``[TOOL_CALL: name] {json}``),
the runtime must NOT stream that raw text to the frontend: the marker and
the JSON payload (which may contain large escaped source code) should be
held back until the runtime parses and executes the call.

This class implements the suppression as a character-stream state machine.
Feed chunks via :meth:`feed`; it returns the safe, marker-stripped text to
emit in real time. Call :meth:`flush` at stream end to release any
held-back non-marker text. The full buffer (including suppressed markers)
is available via :meth:`buffer` so the runtime can still parse tool calls
from it after the stream completes.

Two instances are used by the runtime: one for ``delta`` (main response
content) and one for ``reasoning`` (chain-of-thought). Reasoning models
(e.g. DeepSeek-R1) sometimes emit ``[TOOL_CALL:]`` inside
``reasoning_content``; suppressing it there too prevents the raw marker
and escaped JSON from leaking into the reasoning panel.
"""

from __future__ import annotations


class MarkerSuppressor:
    """Stream text while suppressing ``[TOOL_CALL: name] {json}`` blocks.

    The state machine has two modes:

    - NORMAL: emit text, but hold back up to ``len(marker)-1`` chars so a
      marker that spans a chunk boundary is not partially emitted. When the
      marker is found, switch to INSIDE.
    - INSIDE: skip chars while tracking JSON string/escape/brace depth.
      When the JSON block closes, switch back to NORMAL and continue.

    A marker whose header is not followed by ``{`` or ``[`` (i.e. not a
    real tool call) is re-emitted as plain text.
    """

    def __init__(self, marker: str) -> None:
        self._marker = marker
        self._mlen = len(marker)
        self.reset()

    def reset(self) -> None:
        """Clear all state for a fresh streaming step."""
        self._buf = ""
        self._emitted = 0          # index into buf up to which text was emitted
        self._inside = False
        self._scan_pos = 0         # next char to scan while inside
        self._awaiting_close_bracket = False
        self._depth = 0
        self._in_string = False
        self._escape = False
        self._open_ch = ""
        self._close_ch = ""

    @property
    def buffer(self) -> str:
        """The full accumulated text, including suppressed markers."""
        return self._buf

    def feed(self, chunk: str) -> str:
        """Append ``chunk`` and return the safe text to emit now."""
        if not chunk:
            return ""
        self._buf += chunk
        out: list[str] = []
        while True:
            if not self._inside:
                idx = self._buf.find(self._marker, self._emitted)
                if idx != -1:
                    if idx > self._emitted:
                        out.append(self._buf[self._emitted:idx])
                    self._emitted = idx
                    self._inside = True
                    self._scan_pos = idx + self._mlen
                    self._awaiting_close_bracket = True
                    self._depth = 0
                    self._in_string = False
                    self._escape = False
                    self._open_ch = ""
                    self._close_ch = ""
                    out.append(self._advance_inside())
                    if self._inside:
                        break
                    continue
                hold = min(len(self._buf) - self._emitted, self._mlen - 1)
                safe_end = len(self._buf) - hold
                if safe_end > self._emitted:
                    out.append(self._buf[self._emitted:safe_end])
                self._emitted = safe_end
                break
            else:
                out.append(self._advance_inside())
                if self._inside:
                    break
                continue
        return "".join(out)

    def _advance_inside(self) -> str:
        """Scan buffered chars looking for the end of the tool-call block.

        Returns any text that should be re-emitted (only when the marker
        turns out not to be a real tool call). On a real tool-call close,
        advances ``_emitted`` past the closing brace and clears ``_inside``.
        If the buffer is exhausted while still inside, leaves state intact
        so the next chunk resumes mid-block and returns "".
        """
        n = len(self._buf)

        # Phase 1: find the closing ']' of the marker header.
        if self._awaiting_close_bracket:
            idx = self._buf.find("]", self._scan_pos)
            if idx == -1:
                return ""
            self._scan_pos = idx + 1
            self._awaiting_close_bracket = False

        # Phase 2: skip whitespace and locate the JSON open char.
        if self._depth == 0 and not self._in_string and not self._escape:
            while self._scan_pos < n and self._buf[self._scan_pos] in " \t\n\r":
                self._scan_pos += 1
            if self._scan_pos >= n:
                return ""
            open_ch = self._buf[self._scan_pos]
            if open_ch not in "{[":
                # Marker not followed by JSON: re-emit the marker text.
                self._inside = False
                text = self._buf[self._emitted:self._scan_pos]
                self._emitted = self._scan_pos
                return text
            self._open_ch = open_ch
            self._close_ch = "}" if open_ch == "{" else "]"
            self._scan_pos += 1
            self._depth = 1

        # Phase 3: scan the balanced JSON block.
        i = self._scan_pos
        while i < n:
            ch = self._buf[i]
            if self._escape:
                self._escape = False
                i += 1
                continue
            if ch == "\\":
                self._escape = True
                i += 1
                continue
            if ch == '"':
                self._in_string = not self._in_string
                i += 1
                continue
            if self._in_string:
                i += 1
                continue
            if ch == self._open_ch:
                self._depth += 1
            elif ch == self._close_ch:
                self._depth -= 1
                if self._depth == 0:
                    self._emitted = i + 1
                    self._inside = False
                    self._scan_pos = i + 1
                    self._in_string = False
                    self._escape = False
                    self._open_ch = ""
                    self._close_ch = ""
                    return ""
            i += 1
        self._scan_pos = i
        return ""

    def flush(self) -> str:
        """Release any held-back text at stream end.

        Returns "" if currently inside an unbalanced tool-call block (the
        marker is suppressed rather than emitted as partial text).
        """
        if self._inside:
            return ""
        if self._emitted < len(self._buf):
            out = self._buf[self._emitted:]
            self._emitted = len(self._buf)
            return out
        return ""


__all__ = ["MarkerSuppressor"]