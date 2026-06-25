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

    def __init__(self, *, api_url: str | None = None, api_key: str | None = None, model: str | None = None) -> None:
        self._api_url = api_url or settings.llm_api_url
        self._api_key = api_key or settings.llm_api_key
        self._model = model or settings.llm_model
        self._system_prompt = settings.llm_system_prompt
        self._client = AsyncOpenAI(
            base_url=self._api_url,
            api_key=self._api_key or "unused",
        )

    def reconfigure(self, *, api_url: str, api_key: str, model: str) -> None:
        """Hot-swap the provider configuration without restarting."""
        old_client = self._client
        self._api_url = api_url
        self._api_key = api_key
        self._model = model
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
                "max_tokens": 16384,
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
                            }
                        if tc.function:
                            if tc.function.name:
                                tool_calls_acc[idx]["name"] += tc.function.name
                            if tc.function.arguments:
                                tool_calls_acc[idx]["args"] += tc.function.arguments

            if has_reasoning:
                logger.info(
                    "[llm] reasoning detected for model '%s' — emitted to frontend",
                    self._model,
                )

            # Emit accumulated tool calls.
            for idx in sorted(tool_calls_acc):
                tc = tool_calls_acc[idx]
                if tc["name"]:
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
            yield StreamEvent(kind="delta", text=f"[LLM error: {exc}]")
            yield StreamEvent(kind="done")

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
                "max_tokens": 16384,
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
            return {"text": f"[LLM error: {exc}]"}