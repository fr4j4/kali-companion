"""Tests for AgentRuntime with tool calls.

Verifies the multi-step agent loop: tool_call → execute → append result
→ second LLM stream → final reply. Uses a FakeToolLLMProvider that
emits a tool_call on the first invocation and a plain delta on the
second, so no real LLM is needed.
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest

from kali_core.claws.base import register
from kali_core.claws.fs import FsReadTool
from kali_core.mind.executor import Executor
from kali_core.mind.llm.provider import StreamEvent, ToolDef
from kali_core.mind.runtime import AgentRuntime


class FakeToolLLMProvider:
    """LLM that emits a tool_call on first stream, then a reply on second."""

    provider_name = "fake_tool"

    def __init__(self) -> None:
        self._call_count = 0
        self.seen_messages: list[list[dict]] = []  # track what was sent

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        self._call_count += 1
        self.seen_messages.append(messages)
        if self._call_count == 1:
            yield StreamEvent(
                kind="tool_call",
                tool_name="fs_read",
                tool_args={"path": "/tmp/test_kali.txt"},
                tool_call_id="call_abc123",
            )
            yield StreamEvent(kind="done")
        else:
            yield StreamEvent(kind="delta", text="Archivo leído correctamente.")
            yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        return {"text": "Archivo leído correctamente."}


class FakeGateway:
    """Permissive gateway — allows everything."""

    def check(self, tool_name: str, risk_level: str, params: dict, profile: str) -> SimpleNamespace:
        return SimpleNamespace(allow=True, needs_consent=False)

    def list_profiles(self) -> list[dict]:
        return [{"id": "dev"}, {"id": "general"}]


class FakeConsent:
    """Permissive consent — always allows."""

    def __init__(self) -> None:
        self._grants: dict[str, set[str]] = {}

    def is_granted(self, session_id: str, permission_key: str) -> bool:
        return permission_key in self._grants.get(session_id, set())

    def grant(self, session_id: str, permission_key: str) -> None:
        self._grants.setdefault(session_id, set()).add(permission_key)

    def revoke(self, session_id: str, permission_key: str) -> None:
        self._grants.get(session_id, set()).discard(permission_key)

    def clear_session(self, session_id: str) -> None:
        self._grants.pop(session_id, None)

    async def request(self, **kwargs: object) -> str:
        return "allow"


@pytest.fixture(autouse=True)
def _register_tools() -> None:
    """Ensure FsReadTool is registered for the test."""
    register(FsReadTool())


@pytest.mark.asyncio
async def test_tool_call_loop() -> None:
    """Full multi-step flow: tool_call → execute → second stream → reply."""
    fake_llm = FakeToolLLMProvider()
    executor = Executor(
        gateway=FakeGateway(),
        consent=FakeConsent(),
        working_dir="/tmp",
        profile="dev",
    )

    agent = AgentRuntime(fake_llm)
    agent.set_executor(executor)
    agent.set_tools([
        ToolDef(
            name="fs_read",
            description="Read a file within the working directory.",
            schema={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        ),
    ])

    # Collect emitted tool_events.
    tool_events: list[dict] = []

    async def capture_event(payload: dict) -> None:
        tool_events.append(payload)

    agent.set_emit_callback(capture_event)

    # Create a temp file so the tool can read it.
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, dir="/tmp"
    ) as f:
        f.write("Hello from Kali test!")
        tmp_path = f.name

    fake_llm.seen_messages = []
    async def patched_stream(messages, tools=None):
            self = fake_llm
            self._call_count += 1
            self.seen_messages.append(list(messages))  # copy — history mutates
            if self._call_count == 1:
                yield StreamEvent(
                    kind="tool_call",
                    tool_name="fs_read",
                    tool_args={"path": tmp_path},
                    tool_call_id="call_test_001",
                )
                yield StreamEvent(kind="done")
            else:
                yield StreamEvent(kind="delta", text="Archivo leído correctamente: ")
                yield StreamEvent(kind="done")

    fake_llm.stream = patched_stream  # type: ignore[assignment]
    fake_llm._call_count = 0

    # Run the agent.
    deltas: list[str] = []
    session_id = "test_sess_001"
    async for event in agent.respond("lee el archivo de prueba", session_id):
        if event.kind == "delta" and event.text:
            deltas.append(event.text)

    # ── Assertions ──────────────────────────────────────────

    # 1. The tool_events callback was invoked.
    assert len(tool_events) >= 2, (
        f"expected ≥2 tool_events (running + success), got {len(tool_events)}"
    )
    assert tool_events[0]["event"] == "tool_event"
    assert tool_events[0]["tool"] == "fs_read"
    assert tool_events[0]["status"] == "running"
    assert tool_events[-1]["status"] == "success"

    # 2. Deltas were produced after tool execution.
    assert len(deltas) > 0, "expected delta events after tool execution"

    # 3. LLM was called twice.
    assert fake_llm._call_count == 2, (
        f"expected 2 LLM calls, got {fake_llm._call_count}"
    )

    # 4. First call messages include the user message.
    first_msgs = fake_llm.seen_messages[0]
    assert first_msgs[-1]["role"] == "user"
    assert first_msgs[-1]["content"] == "lee el archivo de prueba"

    # 5. Second call messages include the tool call + tool result.
    second_msgs = fake_llm.seen_messages[1]

    # Find the assistant tool_call message.
    assistant_tc = next(m for m in second_msgs if m["role"] == "assistant" and "tool_calls" in m)
    assert len(assistant_tc["tool_calls"]) == 1
    tc = assistant_tc["tool_calls"][0]
    assert tc["type"] == "function"
    assert tc["function"]["name"] == "fs_read"
    assert json.loads(tc["function"]["arguments"]) == {"path": tmp_path}
    assert tc["id"] == "call_test_001"
    # content must be None when tool_calls are present.
    assert assistant_tc["content"] is None

    # Find the tool result message.
    tool_msg = next(m for m in second_msgs if m["role"] == "tool")
    assert tool_msg["tool_call_id"] == "call_test_001"
    assert "Hello from Kali test!" in tool_msg["content"]

    # 6. History is persisted on the agent.
    history = agent.get_history(session_id)
    assert len(history) >= 3  # user + assistant(tc) + tool + assistant(reply)
    # Last entry should be the assistant reply.
    assert history[-1]["role"] == "assistant"
    assert len(history[-1].get("content", "")) > 0
