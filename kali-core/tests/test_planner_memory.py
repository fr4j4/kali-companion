"""Tests for Planner and Memory modules."""

from __future__ import annotations

import pytest

from kali_core.mind.planner import Plan, Planner, _is_simple
from kali_core.nest.memory import Memory

# ── Planner ────────────────────────────────────────────────


def test_planner_simple_message_returns_empty_plan():
    """Simple messages should return an empty plan (direct execution)."""
    assert _is_simple("hola") is True
    assert _is_simple("what is 2+2?") is True


def test_planner_complex_message_not_simple():
    """Complex messages should not be flagged as simple."""
    assert not _is_simple("implement a REST API with authentication and database")
    assert not _is_simple("refactor the entire codebase to use async")


@pytest.mark.asyncio
async def test_planner_no_llm_returns_empty():
    """Planner without LLM returns empty plan for any message."""
    planner = Planner(llm=None)
    plan = await planner.plan("implement a complex feature")
    assert isinstance(plan, Plan)
    assert len(plan.steps) == 0


@pytest.mark.asyncio
async def test_planner_with_fake_llm():
    """Planner with a fake LLM generates steps from the response."""

    class FakeLLM:
        async def complete(self, messages, tools=None):
            import json
            return {
                "text": json.dumps({
                    "reasoning": "Break into 2 steps",
                    "steps": ["First step", "Second step"],
                })
            }

    planner = Planner(llm=FakeLLM())
    plan = await planner.plan("implement a complex feature with tests")
    assert len(plan.steps) == 2
    assert plan.steps[0] == "First step"
    assert plan.reasoning == "Break into 2 steps"


@pytest.mark.asyncio
async def test_planner_llm_error_returns_empty():
    """Planner returns empty plan when LLM fails."""

    class BrokenLLM:
        async def complete(self, messages, tools=None):
            return {"text": "not valid json"}

    planner = Planner(llm=BrokenLLM())
    plan = await planner.plan("implement a complex feature")
    assert len(plan.steps) == 0


# ── Memory ─────────────────────────────────────────────────


def test_memory_add_and_recent():
    """Memory stores recent messages and respects the window."""
    mem = Memory(max_recent=5)
    for i in range(3):
        mem.add({"role": "user", "content": f"msg {i}"})
    assert len(mem.recent) == 3
    assert mem.recent[0]["content"] == "msg 0"


def test_memory_overflow_summarizes():
    """When recent exceeds max, older messages are summarized."""
    mem = Memory(max_recent=4)
    # Add 6 messages: overflow triggers on the 5th (len=5 > 4).
    # The first 2 (max_recent//2=2) get summarized, leaving 3 in recent.
    # The 6th message brings recent back to 4.
    for i in range(6):
        mem.add({"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"})
    assert len(mem.recent) == 4  # 4 remain after overflow + 1 more added
    assert len(mem.summaries) == 1
    assert "msg 0" in mem.summaries[0]


def test_memory_context_messages_includes_summaries():
    """context_messages includes summaries as a system message."""
    mem = Memory(max_recent=10)
    mem.add_summary("Summary of past conversation")
    mem.add({"role": "user", "content": "hello"})
    msgs = mem.context_messages()
    assert msgs[0]["role"] == "system"
    assert "Summary of past conversation" in msgs[0]["content"]
    assert msgs[-1]["content"] == "hello"


def test_memory_context_empty():
    """Empty memory produces empty context."""
    mem = Memory()
    assert mem.context_messages() == []


def test_memory_serialize_deserialize():
    """Memory can be serialized and restored."""
    mem = Memory(max_recent=10)
    mem.add({"role": "user", "content": "test"})
    mem.add_summary("summary 1")
    data = mem.to_dict()
    restored = Memory.from_dict(data, max_recent=10)
    assert restored.recent == mem.recent
    assert restored.summaries == mem.summaries