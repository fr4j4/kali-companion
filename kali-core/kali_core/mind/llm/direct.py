"""DirectLLMProvider — OpenAI-compatible LLM via streaming Chat Completions.

Works with local Ollama, llama.cpp server, OpenRouter, OpenAI, or any
service that implements the OpenAI Chat Completions API. Ported from the
legacy ai-voice-companion `app/llm.py`, adapted to the new
`LLMProvider` interface.

Supports function calling: when `tools` are provided, they are passed as
OpenAI tools to the API. The provider parses `tool_calls` from the
streaming response and emits `StreamEvent(kind="tool_call")`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from kali_core.config import settings

from ..json_stream_extractor import StreamingArtifactArgParser
from .provider import StreamEvent, ToolDef

logger = logging.getLogger("kali_core.mind.direct")

# Ollama and some other backends expose chain-of-thought via a non-standard
# ``reasoning`` (or ``reasoning_content``) field on the streaming delta.
# The OpenAI SDK doesn't type this, so we use getattr to access it safely.
_REASONING_FIELDS = ("reasoning", "reasoning_content")


def _extract_reasoning(delta: Any) -> str:
    """Extract chain-of-thought text from a streaming delta.

    Returns an empty string if the delta carries no reasoning content.
    """
    for field in _REASONING_FIELDS:
        text = getattr(delta, field, None)
        if text:
            return text
    # Also check model_extra (pydantic v2 stores unknown fields there).
    extra = getattr(delta, "model_extra", None)
    if isinstance(extra, dict):
        for field in _REASONING_FIELDS:
            text = extra.get(field)
            if text:
                return text
    return ""


class DirectLLMProvider:
    """OpenAI-compatible streaming LLM."""

    provider_name = "direct"

    def __init__(self, *, api_url: str | None = None, api_key: str | None = None, model: str | None = None, max_tokens: int | None = None) -> None:
        self._api_url = api_url or settings.llm_api_url
        self._api_key = api_key or settings.llm_api_key
        self._model = model or settings.llm_model
        self._max_tokens = max_tokens or settings.llm_max_tokens
        self._system_prompt = settings.llm_system_prompt
        self._client = AsyncOpenAI(
            base_url=self._api_url,
            api_key=self._api_key or "unused",
        )

    def reconfigure(self, *, api_url: str, api_key: str, model: str, max_tokens: int | None = None) -> None:
        """Hot-swap the provider configuration without restarting."""
        old_client = self._client
        self._api_url = api_url
        self._api_key = api_key
        self._model = model
        if max_tokens is not None:
            self._max_tokens = max_tokens
        self._client = AsyncOpenAI(
            base_url=self._api_url,
            api_key=self._api_key or "unused",
        )
        logger.info("LLM provider reconfigured — url=%s model=%s", api_url, model)
        # Give in-flight requests a moment to drain before closing old client.
        try:
            if hasattr(old_client, "close"):
                asyncio.create_task(old_client.close())
        except Exception:
            pass

    def _build_tools_param(self, tools: list[ToolDef] | None) -> list[dict] | None:
        """Convert ToolDef list to OpenAI tools format."""
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.schema,
                },
            }
            for t in tools
        ]

    async def _try_create(self, kwargs: dict) -> Any:
        """Call the API, falling back to deprecated ``functions`` format or no tools."""
        try:
            return await self._client.chat.completions.create(**kwargs)
        except Exception as exc:
            is_400 = hasattr(exc, "status_code") and exc.status_code == 400
            is_tool_error = is_400 or "tool" in str(exc).lower()

            # 1st fallback: try the deprecated ``functions`` format.
            if is_tool_error and "tools" in kwargs:
                tools_raw = kwargs.pop("tools")
                kwargs.pop("tool_choice", None)
                kwargs["functions"] = [t["function"] for t in tools_raw]
                kwargs["function_call"] = "auto"
                logger.warning(
                    "tools format rejected by '%s', retrying with deprecated functions format",
                    self._model,
                )
                try:
                    return await self._client.chat.completions.create(**kwargs)
                except Exception:
                    pass  # fall through to the next fallback

            # 2nd fallback: remove all tool definitions entirely.
            if is_tool_error and ("functions" in kwargs or "tools" in kwargs):
                kwargs.pop("tools", None)
                kwargs.pop("tool_choice", None)
                kwargs.pop("functions", None)
                kwargs.pop("function_call", None)
                logger.warning(
                    "tools param rejected by '%s', retrying without tools "
                    "(text-based tool instructions remain in system prompt)",
                    self._model,
                )
                return await self._client.chat.completions.create(**kwargs)

            raise

    @staticmethod
    def _tool_descriptions_system(tools: list[ToolDef]) -> str:
        """Build a system message describing tools in text format.

        This is injected alongside the API ``tools`` parameter. Models
        that support native function calling ignore it; models that
        don't can use the text instructions to output tool calls in the
        ``[TOOL_CALL: name] {arg: val}`` format that the runtime parses.
        """
        lines = [
            "You have access to the following tools.",
            (
                "If you want to use a tool, output exactly one line in"
                " this format (without any surrounding text):"
            ),
            "  [TOOL_CALL: tool_name] {\"arg\": \"value\"}",
            "",
        ]
        for t in tools:
            lines.append(f"- {t.name}: {t.description}")
            lines.append(f"  Schema: {json.dumps(t.schema)}")
        return "\n".join(lines)

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        system_content = self._system_prompt
        if tools:
            system_content += "\n\n" + self._tool_descriptions_system(tools)
        full = [{"role": "system", "content": system_content}]
        full += messages
        tools_param = self._build_tools_param(tools)
        try:
            kwargs: dict = {
                "model": self._model,
                "messages": full,
                "stream": True,
                "temperature": 0.7,
                "max_tokens": self._max_tokens,
            }
            if tools_param:
                kwargs["tools"] = tools_param
                kwargs["tool_choice"] = "auto"

            stream = await self._try_create(kwargs)

            # Accumulate tool calls across chunks.
            tool_calls_acc: dict[int, dict] = {}
            has_reasoning = False

            async for chunk in stream:
                delta = chunk.choices[0].delta

                # Chain-of-thought / reasoning (non-standard Ollama field).
                # Emitted as reasoning events so the frontend can show it
                # in a collapsible panel; it does NOT become the response.
                reasoning_text = _extract_reasoning(delta)
                if reasoning_text:
                    has_reasoning = True
                    yield StreamEvent(kind="reasoning", text=reasoning_text)

                # Text content.
                if delta.content:
                    yield StreamEvent(kind="delta", text=delta.content)

                # Tool calls (accumulate across chunks).
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": tc.id or "",
                                "name": "",
                                "args": "",
                                # StreamingArtifactArgParser for live
                                # re-streaming of streamable artifact content
                                # (html/code/document/diff). None until the
                                # tool name is known to be create_artifact.
                                "art_parser": None,
                                # True once we've started emitting synthetic
                                # BEGIN_ARTIFACT deltas for this tool call.
                                "art_streaming": False,
                                # True if this tool call was fully handled via
                                # streaming (skip the batch tool_call event).
                                "art_streamed": False,
                            }
                        acc = tool_calls_acc[idx]
                        if tc.function:
                            if tc.function.name:
                                acc["name"] += tc.function.name
                            if tc.function.arguments:
                                acc["args"] += tc.function.arguments
                                # Live re-streaming of streamable artifacts.
                                # When the model uses native function calling
                                # to invoke create_artifact with an html/code/
                                # document/diff payload, the full content lives
                                # inside the JSON arguments (escaped). We parse
                                # it incrementally and emit synthetic delta
                                # events with [BEGIN_ARTIFACT]/[END_ARTIFACT]
                                # markers so ArtifactStreamProcessor (in the
                                # runtime) streams the artifact to the
                                # frontend in real time, instead of waiting
                                # for the whole JSON to arrive and executing
                                # the tool in batch at stream end.
                                if acc["name"] == "create_artifact":
                                    for synth_evt in self._maybe_stream_artifact_tool(
                                        acc, tc.function.arguments
                                    ):
                                        yield synth_evt

            if has_reasoning:
                logger.info(
                    "[llm] reasoning detected for model '%s' — emitted to frontend",
                    self._model,
                )

            # Emit token usage stats if available.
            if hasattr(stream, "usage") and stream.usage:
                usage = stream.usage
                reasoning_tokens = None
                if hasattr(usage, "completion_tokens_details") and usage.completion_tokens_details:
                    reasoning_tokens = getattr(usage.completion_tokens_details, "reasoning_tokens", None)
                yield StreamEvent(
                    kind="usage",
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    reasoning_tokens=reasoning_tokens,
                )

            # Emit accumulated tool calls.
            for idx in sorted(tool_calls_acc):
                tc = tool_calls_acc[idx]
                if not tc["name"]:
                    continue
                # If this create_artifact was already streamed live via
                # synthetic BEGIN/END deltas, skip the batch tool_call event
                # (the artifact already reached the frontend in real time).
                if tc.get("art_streamed"):
                    logger.info(
                        "[llm] create_artifact streamed live (id=%s, "
                        "type=%s) — skipping batch tool_call event",
                        tc["id"] or "?",
                        tc.get("art_type", "?"),
                    )
                    continue
                args = {}
                if tc["args"]:
                    try:
                        args = json.loads(tc["args"])
                    except json.JSONDecodeError:
                        # The streaming accumulation may have
                        # truncated the JSON. Try to salvage it
                        # by finding the last valid JSON block.
                        raw = tc["args"].strip()
                        # If it starts with { or [, try balanced
                        # extraction as a last resort.
                        if raw and raw[0] in "{[":
                            try:
                                # Find the longest valid prefix.
                                for end in range(len(raw), 0, -1):
                                    try:
                                        candidate = raw[:end]
                                        # Pad with closing braces if
                                        # unbalanced (truncated).
                                        opens = candidate.count("{") - candidate.count("}")
                                        brackets = candidate.count("[") - candidate.count("]")
                                        if opens > 0:
                                            candidate += "}" * opens
                                        if brackets > 0:
                                            candidate += "]" * brackets
                                        parsed = json.loads(candidate)
                                        if isinstance(parsed, dict):
                                            args = parsed
                                            logger.warning(
                                                "Salvaged truncated tool args for '%s' "
                                                "(added %d closing braces)",
                                                tc["name"], opens + brackets,
                                            )
                                            break
                                    except json.JSONDecodeError:
                                        continue
                                if not args:
                                    args = {"raw": raw}
                            except Exception:
                                args = {"raw": raw}
                        else:
                            args = {"raw": raw}
                yield StreamEvent(
                    kind="tool_call",
                    tool_name=tc["name"],
                    tool_args=args,
                    tool_call_id=tc["id"],
                )

            yield StreamEvent(kind="done")
        except Exception as exc:
            logger.error("LLM error: %s", exc)
            # Provide a user-friendly message instead of raw exception text.
            if "connection" in str(exc).lower() or "timeout" in str(exc).lower():
                msg = (
                    "No pude conectar con el modelo de IA. "
                    "Verifica que el endpoint esté activo y accesible."
                    if self._api_url and not self._api_url.startswith("http://localhost")
                    else "No pude conectar con el modelo de IA. "
                    "Verifica que el servidor local esté corriendo."
                )
            else:
                msg = f"Error del modelo de IA: {exc}"
            yield StreamEvent(kind="delta", text=msg)
            yield StreamEvent(kind="done")

    def _maybe_stream_artifact_tool(
        self, acc: dict, arguments_chunk: str
    ):  # -> Iterator[StreamEvent]
        """Re-stream a streamable create_artifact tool call as synthetic deltas.

        When the model uses native function calling for ``create_artifact`` with
        a streamable type (html/code/document/diff), the full content lives
        inside the escaped JSON ``arguments``. Instead of waiting for the whole
        JSON to arrive and executing the tool in batch at stream end, we parse
        the arguments incrementally and emit synthetic ``delta`` events shaped
        like ``[BEGIN_ARTIFACT: html] {"title":"…"} …content… [END_ARTIFACT]``.

        The runtime's ``ArtifactStreamProcessor`` (which only reads the delta
        channel) then streams the artifact to the frontend in real time, exactly
        as if the model had emitted the markers as plain text.

        For non-streamable types (table/mermaid/json/checklist/chart) or if the
        incremental parser fails, this method is a no-op: the tool call falls
        back to the batch path (accumulated and executed at stream end).

        Yields ``StreamEvent(kind="delta", ...)`` synthetic events. Is an
        iterator (uses ``yield``) so the caller does ``yield from``.
        """
        # Lazily create the parser when we first see this tool call.
        if acc["art_parser"] is None:
            acc["art_parser"] = StreamingArtifactArgParser()
        parser: StreamingArtifactArgParser = acc["art_parser"]

        # If the parser already failed, stop trying — batch fallback.
        if parser.failed:
            return

        events = parser.feed(arguments_chunk)
        for ev in events:
            if ev.kind == "field" and ev.key == "artifact_type":
                # Record the type so we can log it when skipping batch path.
                acc["art_type"] = ev.value
            elif ev.kind == "field" and ev.key == "title":
                # If we already started streaming (artifact_type was known and
                # streamable and content began before title arrived), the
                # create event used an empty title; that's fine — the close
                # event carries the full content and the frontend shows the
                # title from the create. We don't re-emit.
                pass
            elif ev.kind == "content_chunk":
                # First content chunk: emit the BEGIN marker + header.
                if not acc["art_streaming"]:
                    if parser.is_streamable is not True:
                        # Non-streamable type: don't stream. Fall back to batch.
                        # Mark the parser as done so we don't process further.
                        return
                    # Emit the synthetic BEGIN_ARTIFACT marker.
                    atype = parser.artifact_type
                    title = parser.title or ""
                    language = parser.language or ""
                    if language:
                        header = (
                            f'{{"title":"{title}",'
                            f'"language":"{language}"}}'
                        )
                    else:
                        header = f'{{"title":"{title}"}}'
                    yield StreamEvent(
                        kind="delta",
                        text=f"[BEGIN_ARTIFACT: {atype}] {header} ",
                    )
                    acc["art_streaming"] = True
                # Emit the unescaped content chunk as a synthetic delta.
                if ev.text:
                    yield StreamEvent(kind="delta", text=ev.text)
            elif ev.kind == "content_done":
                if acc["art_streaming"]:
                    # Emit the synthetic END_ARTIFACT marker.
                    yield StreamEvent(kind="delta", text="[END_ARTIFACT]")
                    acc["art_streamed"] = True
            elif ev.kind == "json_done":
                # JSON fully closed. If we were streaming, ensure END was sent
                # (content_done should have fired first, but be defensive).
                if acc["art_streaming"] and not acc["art_streamed"]:
                    yield StreamEvent(kind="delta", text="[END_ARTIFACT]")
                    acc["art_streamed"] = True

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        system_content = self._system_prompt
        if tools:
            system_content += "\n\n" + self._tool_descriptions_system(tools)
        full = [{"role": "system", "content": system_content}]
        full += messages
        tools_param = self._build_tools_param(tools)
        try:
            kwargs: dict = {
                "model": self._model,
                "messages": full,
                "temperature": 0.7,
                "max_tokens": self._max_tokens,
            }
            if tools_param:
                kwargs["tools"] = tools_param
                kwargs["tool_choice"] = "auto"
            resp = await self._try_create(kwargs)
            msg = resp.choices[0].message
            # Include reasoning in the returned dict so callers can inspect it.
            reasoning = _extract_reasoning(msg)
            if reasoning:
                logger.info(
                    "[llm] reasoning detected in non-streaming response for '%s'",
                    self._model,
                )
            return {
                "text": msg.content or "",
                **({"reasoning": reasoning} if reasoning else {}),
            }
        except Exception as exc:
            logger.error("LLM error: %s", exc)
            if "connection" in str(exc).lower() or "timeout" in str(exc).lower():
                return {"text": "No pude conectar con el modelo de IA. Verifica que el endpoint esté activo."}
            return {"text": f"Error del modelo de IA: {exc}"}