"""Tool protocol — the interface every tool implements.

A tool is an action the agent can take in the user's system. Each tool
declares a `risk_level` and goes through kali-collar (PermissionGateway)
before running.

- `safe` tools run unconditionally.
- `sensitive` tools run if whitelisted by the active profile, else they
  ask for consent.
- `dangerous` tools always ask for consent, regardless of profile.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

RiskLevel = Literal["safe", "sensitive", "dangerous"]


@dataclass
class ToolResult:
    """Output of a tool execution."""
    output: Any = None
    error: str | None = None
    artifact: dict | None = None  # canvas artifact to render, if any


@dataclass
class ToolContext:
    """Per-call context passed to every tool."""
    session_id: str
    working_dir: str
    profile: str
    consent_callback: Any = None  # callable that emits consent_request
    gaze_client: Any = None  # GazeClient instance for screen capture
    llm_provider: Any = None  # LLM provider for vision/multimodal
    job_mgr: Any = None  # JobManager for spawning background jobs
    emit: Any = None  # emit_callback for sending WS events directly
    language: str = "en"  # user's language code (e.g. "es", "en")


@runtime_checkable
class Tool(Protocol):
    """A single action Kali can perform."""

    name: str
    description: str
    schema: dict
    risk_level: RiskLevel

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult: ...


# ── Registry ───────────────────────────────────────────────
_REGISTRY: dict[str, Tool] = {}


def register(tool: Tool) -> Tool:
    """Register a tool so the agent loop can find it by name."""
    _REGISTRY[tool.name] = tool
    return tool


def available_tools() -> list[Tool]:
    return list(_REGISTRY.values())


def get(name: str) -> Tool | None:
    return _REGISTRY.get(name)