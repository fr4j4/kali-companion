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
import re
from collections.abc import AsyncIterator
from typing import Any

from .llm.provider import LLMProvider, StreamEvent

logger = logging.getLogger("kali_core.mind.runtime")

# Regex for prompt-based tool calls.
# Matches ``[TOOL_CALL: name] {"arg": "val"}`` or similar.
_TOOL_CALL_RE = re.compile(
    r"\[\s*TOOL_CALL\s*:\s*(\w+)\s*\]\s*(\{.*?\}|\[.*?\])\s*",
    re.DOTALL,
)


def _parse_tool_call(text: str) -> list[tuple[str, dict, str]] | None:
    """Parse text-based tool calls from the LLM output.

    Returns a list of ``(tool_name, args, full_match)`` tuples, or None
    if no tool calls are found.
    """
    calls: list[tuple[str, dict, str]] = []
    for match in _TOOL_CALL_RE.finditer(text):
        name = match.group(1)
        raw_args = match.group(2)
        try:
            args = json.loads(raw_args)
        except (json.JSONDecodeError, TypeError):
            args = {"raw": raw_args}
        if not isinstance(args, dict):
            args = {"raw": raw_args}
        calls.append((name, args, match.group(0)))
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
        # Multi-step loop: keep going until no more tool calls.
        max_steps = 5
        for _step in range(max_steps):
            tool_call_pending = False
            native_tool_call = False

            async for event in self.llm.stream(history, tools=self._tools):
                if event.kind == "delta" and event.text:
                    # Strip prompt-based tool call markers from the
                    # text before sending to the frontend. The raw text
                    # is still accumulated for back-end parsing.
                    chunk = event.text
                    # Filter chunks that only contain tool call markers.
                    stripped = chunk.strip()
                    if stripped.startswith("[TOOL_CALL:"):
                        accumulated += chunk
                        continue
                    accumulated += chunk
                    yield event
                elif event.kind == "reasoning":
                    yield event
                elif event.kind == "tool_call":
                    # Native API tool call.
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

            # If no native tool call was made, check for prompt-based
            # tool calls in the accumulated text.
            if not native_tool_call and self._executor is not None:
                tool_calls = _parse_tool_call(accumulated)
                if tool_calls:
                    tool_call_pending = True
                    # Strip all tool call markers from accumulated text.
                    for _name, _args, match in tool_calls:
                        accumulated = accumulated.replace(match, "", 1)
                    accumulated = accumulated.strip()
                    # Execute each tool call sequentially.
                    for tool_name, tool_args, _match in tool_calls:
                        result = await self._executor.execute(
                            tool_name,
                            tool_args,
                            session_id,
                            emit_event=self._emit_event,
                            language=language,
                        )
                        # Add cleaned assistant text (only once, before
                        # the first tool call).
                        if accumulated:
                            history.append({
                                "role": "assistant",
                                "content": accumulated,
                            })
                            accumulated = ""
                        if result.error is None:
                            tool_output = result.output
                        else:
                            tool_output = {"error": result.error}
                        history.append({
                            "role": "tool",
                            "tool_call_id": "prompt_tc",
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

    def get_history(self, session_id: str) -> list[dict]:
        """Return a copy of the session's message history."""
        return list(self._get_history(session_id))