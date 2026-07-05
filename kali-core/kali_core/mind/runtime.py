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

from kali_core.lang_map import normalize

from .llm.provider import LLMProvider, StreamEvent
from .marker_suppressor import MarkerSuppressor
from .artifact_stream import ArtifactStreamProcessor, ArtifactStreamEvent
from .emotion_filter import EmotionStreamFilter

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

    def __init__(self, llm: LLMProvider | None) -> None:
        self.llm = llm
        # session_id → list of {"role": ..., "content": ...}
        self._histories: dict[str, list[dict]] = {}
        # Optional: executor for tool calls.
        self._executor: Any | None = None
        # Optional: tool definitions to pass to the LLM.
        self._tools: list | None = None
        # Optional: callback to emit tool events to the frontend.
        self._emit_event: Any | None = None
        # Optional: session store for persisting streamed artifacts so they
        # survive page refresh. Set by the server.
        self._session_store: Any = None

    def set_executor(self, executor: Any) -> None:
        self._executor = executor

    def set_tools(self, tools: list) -> None:
        self._tools = tools

    def set_emit_callback(self, callback: Any) -> None:
        self._emit_event = callback

    def set_session_store(self, store: Any) -> None:
        """Wire the session store so streamed artifacts are persisted on close."""
        self._session_store = store

    async def _emit_artifact_event(
        self, evt: ArtifactStreamEvent, session_id: str
    ) -> None:
        """Forward an artifact stream event as a WS ``artifact`` event.

        Builds the payload in the same shape as ``ArtifactEnvelope.to_payload``
        plus the ``phase`` field, and sends it via the emit callback.
        """
        if self._emit_event is None:
            return
        payload = {
            "event": "artifact",
            "id": evt.artifact_id,
            "type": evt.artifact_type,
            "windowType": evt.window_type,
            "title": evt.title,
            "content": evt.content,
            "update": evt.action,
            "phase": evt.phase,
            "language": evt.language,
            "session_id": session_id,
        }
        logger.info(
            "[artifact_stream] %s id=%s type=%s phase=%s content_len=%d",
            evt.action,
            evt.artifact_id,
            evt.artifact_type,
            evt.phase,
            len(evt.content),
        )
        await self._emit_event(payload)

        # Persist the artifact on close so it survives page refresh.
        # Uses INSERT OR REPLACE (idempotent): if the executor already
        # persisted via the batch tool-call path, this overwrites cleanly
        # with the streamed content (identical). For artifacts streamed via
        # synthetic deltas (native create_artifact re-streamed), the
        # executor never runs, so this is the only persistence path.
        if evt.action == "close" and self._session_store is not None:
            try:
                await self._session_store.add_artifact(
                    session_id,
                    evt.artifact_id,
                    evt.artifact_type,
                    evt.title,
                    evt.content,
                    evt.window_type,
                    evt.language,
                )
            except Exception:
                logger.warning(
                    "Failed to persist streamed artifact %s",
                    evt.artifact_id,
                    exc_info=True,
                )

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
        language = normalize(language)

        # ── No LLM configured → localized guidance ──────────────────────
        if self.llm is None:
            msg = (
                "Todavía no tengo un proveedor de IA configurado. "
                "Ve a Ajustes → Proveedor IA para conectar uno, y así podré ayudarte."
                if language == "es"
                else
                "I don't have an AI provider configured yet. "
                "Go to Settings → AI Provider to connect one, and I'll be ready to help you."
            )
            yield StreamEvent(kind="delta", text=msg)
            return
        history = self._get_history(session_id)
        history.append({"role": "user", "content": user_message})

        # Reset per-turn game_resource flag.
        if self._executor is not None:
            self._executor._game_resource_returned.pop(session_id, None)

        accumulated = ""
        accumulated_reasoning = ""
        turn_emotions: list[str] = []
        # Multi-step loop: keep going until no more tool calls.
        max_steps = 5
        for _step in range(max_steps):
            # Signal the start of a new step so the frontend can show
            # feedback during the gap between steps (the LLM call can
            # take 10-60+ seconds before the first token arrives).
            yield StreamEvent(kind="step", step=_step + 1)
            tool_call_pending = False
            native_tool_call = False
            # Streaming filters: suppress [TOOL_CALL: ...] blocks from
            # both the main delta channel and the reasoning channel so the
            # raw marker + escaped JSON never reaches the frontend. The
            # full buffer (including markers) is still available after the
            # stream for tool-call parsing.
            delta_filter = MarkerSuppressor(_TOOL_CALL_MARKER)
            reasoning_filter = MarkerSuppressor(_TOOL_CALL_MARKER)
            # Artifact stream processor: detects [BEGIN_ARTIFACT]/[END_ARTIFACT]
            # markers in the delta channel and produces progressive artifact
            # create/update/close events. The chat text (markers stripped)
            # flows through to delta as normal; artifact content goes to
            # the artifact window via _emit_artifact_event.
            artifact_processor = ArtifactStreamProcessor()
            emotion_filter = EmotionStreamFilter()

            async for event in self.llm.stream(history, tools=self._tools):
                if event.kind == "delta" and event.text:
                    # First pass through tool-call suppressor.
                    safe_from_tc = delta_filter.feed(event.text)
                    if not safe_from_tc:
                        continue
                    # Then through emotion filter (strips <emotion:.../> blocks).
                    safe_from_emotion = emotion_filter.feed(safe_from_tc)
                    # Then through artifact stream processor.
                    result = artifact_processor.feed(safe_from_emotion)
                    if result.chat_text:
                        yield StreamEvent(kind="delta", text=result.chat_text)
                    for art_evt in result.artifact_events:
                        await self._emit_artifact_event(art_evt, session_id)
                elif event.kind == "reasoning":
                    # Filter reasoning the same way as delta: hold back
                    # [TOOL_CALL: ...] blocks so the reasoning panel does
                    # not show the raw marker and escaped JSON payload.
                    # Some reasoning models (DeepSeek-R1, Qwen) emit tool
                    # calls inside reasoning_content.
                    if event.text:
                        safe = reasoning_filter.feed(event.text)
                        if safe:
                            yield StreamEvent(
                                kind="reasoning", text=safe
                            )
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

            # Flush any held-back text (kept in case a marker spanned the
            # chunk boundary). Suppressed tool-call blocks are not flushed.
            tail = delta_filter.flush()
            if tail:
                art_result = artifact_processor.feed(tail)
                if art_result.chat_text:
                    yield StreamEvent(kind="delta", text=art_result.chat_text)
                for art_evt in art_result.artifact_events:
                    await self._emit_artifact_event(art_evt, session_id)
            reasoning_tail = reasoning_filter.flush()
            if reasoning_tail:
                yield StreamEvent(kind="reasoning", text=reasoning_tail)

            # Flush the artifact processor (closes any open artifact).
            art_flush = artifact_processor.flush()
            if art_flush.chat_text:
                yield StreamEvent(kind="delta", text=art_flush.chat_text)
            for art_evt in art_flush.artifact_events:
                await self._emit_artifact_event(art_evt, session_id)

            # Flush emotion filter and accumulate emotions for this step.
            step_emotions = emotion_filter.flush()
            if step_emotions:
                logger.info("[emotion] step %d captured: %s", _step + 1, step_emotions)
            turn_emotions.extend(step_emotions)

            # The full buffers (with markers) are what we parse for tool
            # calls after the stream completes.
            accumulated = delta_filter.buffer
            accumulated_reasoning = reasoning_filter.buffer

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

        # Emit accumulated emotions from all steps of this turn.
        if turn_emotions:
            logger.info("[emotion] turn total: %s", turn_emotions)
            yield StreamEvent(kind="emotion", emotions=turn_emotions)
        else:
            logger.info("[emotion] turn produced no emotions")

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