"""AgentRuntime — the main agent loop (kali-mind).

Receives a user message, calls the LLM provider in streaming mode, and
yields StreamEvents (delta text chunks, tool calls, done). Supports
multi-step tool calling: when the LLM emits a tool_call, the runtime
executes the tool and feeds the result back into the LLM for another
turn, repeating until the LLM produces a done event without tool_calls.

History is kept in memory per session (no SQLite yet). The runtime is
where the project owner will spend most learning time: prompting,
planning, memory, reflection. The `LLMProvider` interface isolates the
agent logic from the specific backend.

Supports two tool-calling mechanisms:
1. Native API tool_calls (OpenAI-compatible function calling)
2. Prompt-based tool calls: LLM outputs ``[TOOL_CALL: name] {args}`` in
   text. The runtime parses this and executes the tool, which works
   with any model regardless of native function-calling support.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .llm.provider import LLMProvider, StreamEvent

logger = logging.getLogger("kali_core.mind.runtime")

# Marker that starts a prompt-based tool call.
_TOOL_CALL_MARKER = "[TOOL_CALL:"


def _extract_json_block(text: str, start: int) -> tuple[str, int] | None:
    """Extract a balanced JSON block starting at position `start`.

    `text[start]` must be '{' or '['. Returns (json_string, end_index)
    where end_index is the position after the closing brace/bracket,
    or None if the block is unbalanced.
    """
    if start >= len(text):
        return None
    open_ch = text[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_string = False
    escape = False
    i = start
    while i < len(text):
        ch = text[i]
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
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1], i + 1
        i += 1
    return None


def _parse_tool_call(text: str) -> list[tuple[str, dict, str]] | None:
    """Parse text-based tool calls from the LLM output.

    Uses a balanced-brace JSON extractor instead of a regex, so nested
    JSON objects and strings containing braces (e.g. HTML with CSS) are
    handled correctly.

    Returns a list of ``(tool_name, args, full_match)`` tuples, or None
    if no tool calls are found.
    """
    calls: list[tuple[str, dict, str]] = []
    pos = 0
    while True:
        marker_pos = text.find(_TOOL_CALL_MARKER, pos)
        if marker_pos == -1:
            break
        # Find the tool name between ":" and "]"
        colon_pos = text.find(":", marker_pos)
        if colon_pos == -1:
            pos = marker_pos + 1
            continue
        bracket_pos = text.find("]", colon_pos)
        if bracket_pos == -1:
            pos = marker_pos + 1
            continue
        name = text[colon_pos + 1 : bracket_pos].strip()
        # Find the start of the JSON block (skip whitespace after "]")
        json_start = bracket_pos + 1
        while json_start < len(text) and text[json_start] in " \t\n\r":
            json_start += 1
        if json_start >= len(text) or text[json_start] not in "{[":
            pos = bracket_pos + 1
            continue
        block = _extract_json_block(text, json_start)
        if block is None:
            pos = bracket_pos + 1
            continue
        raw_args, end_pos = block
        try:
            args = json.loads(raw_args)
        except (json.JSONDecodeError, TypeError):
            args = {"raw": raw_args}
        if not isinstance(args, dict):
            args = {"raw": raw_args}
        full_match = text[marker_pos:end_pos]
        calls.append((name, args, full_match))
        pos = end_pos
    return calls or None


def _sanitize_tool_output(output: Any) -> str:
    """Convert tool output to a context-safe string for chat history.

    Strips fields that can blow the model's context window (e.g.
    ``image_base64`` from screenshots) while keeping useful metadata.
    """
    if isinstance(output, dict):
        cleaned = {
            k: v for k, v in output.items()
            if k not in ("image_base64", "data", "content_b64")
        }
        return str(cleaned)
    return str(output)


def _gen_tool_call_id() -> str:
    """Generate a unique tool call ID for prompt-based tool calls."""
    return f"prompt_tc_{uuid.uuid4().hex[:8]}"


class AgentRuntime:
    """Receives a message and produces a streaming response."""

    def __init__(self, llm: LLMProvider) -> None:
        self.llm = llm
        # session_id → list of {"role": ..., "content": ...}
        self._histories: dict[str, list[dict]] = {}
        # Optional: executor for tool calls.
        self._executor: Any | None = None
        # Optional: tool definitions to pass to the LLM.
        self._tools: list | None = None
        # Optional: callback to emit tool events to the frontend.
        self._emit_event: Any | None = None

    def set_executor(self, executor: Any) -> None:
        self._executor = executor

    def set_tools(self, tools: list) -> None:
        self._tools = tools

    def set_emit_callback(self, callback: Any) -> None:
        self._emit_event = callback

    def _get_history(self, session_id: str) -> list[dict]:
        if session_id not in self._histories:
            self._histories[session_id] = []
        return self._histories[session_id]

    def reset_history(self, session_id: str) -> None:
        self._histories.pop(session_id, None)

    async def respond(
        self,
        user_message: str,
        session_id: str,
        language: str = "en",
    ) -> AsyncIterator[StreamEvent]:
        """Stream the agent's response to a user message."""
        history = self._get_history(session_id)
        history.append({"role": "user", "content": user_message})

        # Reset per-turn game_resource flag.
        if self._executor is not None:
            self._executor._game_resource_returned.pop(session_id, None)

        accumulated = ""
        accumulated_reasoning = ""
        # Multi-step loop: keep going until no more tool calls.
        max_steps = 5
        for _step in range(max_steps):
            tool_call_pending = False
            native_tool_call = False
            # Streaming state for suppressing [TOOL_CALL:] blocks.
            # `yielded_len` tracks how many chars of `accumulated` have
            # already been sent to the frontend. When a TOOL_CALL marker
            # appears, we yield everything before it and stop yielding
            # until the JSON block is balanced.
            inside_tool_call = False
            brace_depth = 0
            in_string = False
            escape = False
            yielded_len = 0

            async for event in self.llm.stream(history, tools=self._tools):
                if event.kind == "delta" and event.text:
                    chunk = event.text
                    if not inside_tool_call:
                        accumulated += chunk
                        # Check if a TOOL_CALL marker has appeared.
                        marker_idx = accumulated.find(
                            _TOOL_CALL_MARKER, yielded_len
                        )
                        if marker_idx != -1:
                            # Yield any pending text before the marker.
                            if marker_idx > yielded_len:
                                yield StreamEvent(
                                    kind="delta",
                                    text=accumulated[yielded_len:marker_idx],
                                )
                            yielded_len = marker_idx
                            inside_tool_call = True
                            # Start counting braces from the marker.
                            rest = accumulated[marker_idx:]
                            for ch in rest:
                                if escape:
                                    escape = False
                                    continue
                                if ch == "\\":
                                    escape = True
                                    continue
                                if ch == '"':
                                    in_string = not in_string
                                    continue
                                if in_string:
                                    continue
                                if ch == "{":
                                    brace_depth += 1
                                elif ch == "}":
                                    brace_depth -= 1
                                    if brace_depth == 0:
                                        inside_tool_call = False
                                        yielded_len = len(accumulated)
                                        break
                        else:
                            # No marker — yield the new chunk (but hold
                            # back a few chars in case the marker spans
                            # the next chunk boundary).
                            hold = min(len(chunk), len(_TOOL_CALL_MARKER) - 1)
                            safe_end = len(accumulated) - hold
                            if safe_end > yielded_len:
                                yield StreamEvent(
                                    kind="delta",
                                    text=accumulated[yielded_len:safe_end],
                                )
                                yielded_len = safe_end
                    else:
                        # Inside a tool call block — accumulate without yielding.
                        accumulated += chunk
                        for ci, ch in enumerate(chunk):
                            if escape:
                                escape = False
                                continue
                            if ch == "\\":
                                escape = True
                                continue
                            if ch == '"':
                                in_string = not in_string
                                continue
                            if in_string:
                                continue
                            if ch == "{":
                                brace_depth += 1
                            elif ch == "}":
                                brace_depth -= 1
                                if brace_depth == 0:
                                    inside_tool_call = False
                                    yielded_len = len(accumulated)
                                    # Check if there's text after the
                                    # closing brace in this chunk — it
                                    # should be yielded as normal text.
                                    remaining_in_chunk = chunk[ci + 1:]
                                    if remaining_in_chunk:
                                        # Re-process as a new delta chunk.
                                        accumulated += remaining_in_chunk
                                        marker_idx = accumulated.find(
                                            _TOOL_CALL_MARKER, yielded_len
                                        )
                                        if marker_idx != -1:
                                            if marker_idx > yielded_len:
                                                yield StreamEvent(
                                                    kind="delta",
                                                    text=accumulated[yielded_len:marker_idx],
                                                )
                                            yielded_len = marker_idx
                                            inside_tool_call = True
                                            rest = accumulated[marker_idx:]
                                            for ch2 in rest:
                                                if escape:
                                                    escape = False
                                                    continue
                                                if ch2 == "\\":
                                                    escape = True
                                                    continue
                                                if ch2 == '"':
                                                    in_string = not in_string
                                                    continue
                                                if in_string:
                                                    continue
                                                if ch2 == "{":
                                                    brace_depth += 1
                                                elif ch2 == "}":
                                                    brace_depth -= 1
                                                    if brace_depth == 0:
                                                        inside_tool_call = False
                                                        yielded_len = len(accumulated)
                                                        break
                                        else:
                                            hold = min(len(remaining_in_chunk), len(_TOOL_CALL_MARKER) - 1)
                                            safe_end = len(accumulated) - hold
                                            if safe_end > yielded_len:
                                                yield StreamEvent(
                                                    kind="delta",
                                                    text=accumulated[yielded_len:safe_end],
                                                )
                                                yielded_len = safe_end
                                    break
                elif event.kind == "reasoning":
                    # Accumulate reasoning text so we can search for
                    # [TOOL_CALL:] markers in it too (some models put
                    # tool calls in the reasoning_content field).
                    if event.text:
                        accumulated_reasoning += event.text
                    yield event
                elif event.kind == "tool_call":
                    # Native API tool call.
                    logger.info(
                        "[tool_call] native name=%s args=%s",
                        event.tool_name,
                        json.dumps(event.tool_args),
                    )
                    native_tool_call = True
                    tool_call_pending = True
                    if self._executor is not None:
                        result = await self._executor.execute(
                            event.tool_name or "",
                            event.tool_args or {},
                            session_id,
                            emit_event=self._emit_event,
                            language=language,
                        )
                        history.append({
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": event.tool_call_id,
                                    "type": "function",
                                    "function": {
                                        "name": event.tool_name,
                                        "arguments": json.dumps(event.tool_args),
                                    },
                                }
                            ],
                        })
                        if result.error is None:
                            tool_output = result.output
                        else:
                            tool_output = {"error": result.error}
                        history.append({
                            "role": "tool",
                            "tool_call_id": event.tool_call_id,
                            "content": _sanitize_tool_output(tool_output),
                        })
                        accumulated = ""
                    else:
                        msg = accumulated or "[tool call attempted but no executor]"
                        history.append({"role": "assistant", "content": msg})
                        accumulated = ""
                elif event.kind == "done":
                    break

            # Flush any text held in the buffer (was kept back in case
            # a TOOL_CALL marker spanned the chunk boundary).
            if not inside_tool_call and yielded_len < len(accumulated):
                remaining = accumulated[yielded_len:]
                # Only yield if it's not part of a tool call block.
                if _TOOL_CALL_MARKER not in remaining:
                    yield StreamEvent(kind="delta", text=remaining)
                    yielded_len = len(accumulated)

            # If no native tool call was made, check for prompt-based
            # tool calls in the accumulated text AND reasoning.
            if not native_tool_call and self._executor is not None:
                tool_calls = _parse_tool_call(accumulated)
                # Also check reasoning content for tool calls (some
                # models like Qwen put [TOOL_CALL:] in reasoning_content).
                if tool_calls is None and accumulated_reasoning:
                    tool_calls = _parse_tool_call(accumulated_reasoning)
                    if tool_calls:
                        logger.info(
                            "[tool_call] found %d tool call(s) in reasoning_content",
                            len(tool_calls),
                        )
                if tool_calls:
                    tool_call_pending = True
                    # Strip all tool call markers from accumulated text.
                    for _name, _args, match in tool_calls:
                        accumulated = accumulated.replace(match, "", 1)
                    accumulated = accumulated.strip()
                    # Execute each tool call sequentially.
                    for tool_name, tool_args, _match in tool_calls:
                        tc_id = _gen_tool_call_id()
                        logger.info(
                            "[tool_call] prompt name=%s id=%s args=%s",
                            tool_name,
                            tc_id,
                            json.dumps(tool_args),
                        )
                        result = await self._executor.execute(
                            tool_name,
                            tool_args,
                            session_id,
                            emit_event=self._emit_event,
                            language=language,
                        )
                        # Add cleaned assistant text (only once, before
                        # the first tool call). Include a synthetic
                        # tool_calls field so servers that validate
                        # tool message ordering accept the history.
                        if accumulated:
                            history.append({
                                "role": "assistant",
                                "content": accumulated,
                                "tool_calls": [
                                    {
                                        "id": tc_id,
                                        "type": "function",
                                        "function": {
                                            "name": tool_name,
                                            "arguments": json.dumps(tool_args),
                                        },
                                    }
                                ],
                            })
                            accumulated = ""
                        else:
                            history.append({
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": tc_id,
                                        "type": "function",
                                        "function": {
                                            "name": tool_name,
                                            "arguments": json.dumps(tool_args),
                                        },
                                    }
                                ],
                            })
                        if result.error is None:
                            tool_output = result.output
                        else:
                            tool_output = {"error": result.error}
                        history.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": _sanitize_tool_output(tool_output),
                        })

            if not tool_call_pending:
                break

        # Persist the assistant reply into history.
        # Fallback: if the LLM produced tool calls but no text response,
        # inject a minimal message so the user sees something.
        if accumulated:
            history.append({"role": "assistant", "content": accumulated})
        else:
            # Check if any tool calls were made in this turn
            has_tool_results = any(
                msg.get("role") == "tool" for msg in history
            )
            if has_tool_results:
                fallbacks = {
                    "es": "Aquí tienes la información solicitada.",
                    "en": "Here's the information you requested.",
                }
                fallback_msg = fallbacks.get(language, fallbacks["en"])
                history.append({"role": "assistant", "content": fallback_msg})
                yield StreamEvent(kind="delta", text=fallback_msg)
            else:
                # The LLM produced absolutely nothing — no text, no tool
                # calls. This can happen with reasoning models that exhaust
                # their token budget on chain-of-thought. Warn and emit a
                # minimal message so the user is not left in silence.
                logger.warning(
                    "[turn] produced 0 chars and 0 tool calls (session %s)",
                    session_id[:8],
                )
                fallbacks = {
                    "es": (
                        "No generé respuesta. El modelo podría haber "
                        "agotado su contexto en razonamiento interno. "
                        "Intenta reformular la petición."
                    ),
                    "en": (
                        "I produced no response. The model may have "
                        "exhausted its token budget on internal reasoning. "
                        "Try rephrasing your request."
                    ),
                }
                fallback_msg = fallbacks.get(language, fallbacks["en"])
                history.append({"role": "assistant", "content": fallback_msg})
                yield StreamEvent(kind="delta", text=fallback_msg)

    def get_history(self, session_id: str) -> list[dict]:
        """Return a copy of the session's message history."""
        return list(self._get_history(session_id))