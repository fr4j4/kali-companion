"""LLMProvider — the interface every LLM backend implements.

Kali-mind talks to LLMs exclusively through this Protocol. Two
implementations ship: DirectLLMProvider (OpenAI-compatible) and
NanobotLLMProvider (wraps nanobot's WS protocol). Both produce the same
`StreamEvent` stream so the agent loop is provider-agnostic.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable


@dataclass
class ToolDef:
    """A tool the LLM can call."""
    name: str
    description: str
    schema: dict  # JSON schema for params


@dataclass
class StreamEvent:
    """A single event in the streaming response.

    `kind` is one of:
    - `delta`: a text chunk (assistant message streaming in)
    - `tool_call`: the LLM wants to call a tool
    - `reasoning`: the model's chain-of-thought (if the provider exposes it)
    - `done`: the stream is complete
    - `step`: signals the start of a new step in the multi-step loop
    """
    kind: Literal["delta", "tool_call", "reasoning", "done", "step", "usage"]
    text: str | None = None
    tool_name: str | None = None
    tool_args: dict | None = None
    tool_call_id: str | None = None
    step: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None


@runtime_checkable
class LLMProvider(Protocol):
    """Async LLM interface."""

    @property
    def provider_name(self) -> str: ...

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream the LLM response, yielding events as they arrive."""
        ...

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict | None = None,
    ) -> dict:
        """Get a complete (non-streamed) response."""
        ...