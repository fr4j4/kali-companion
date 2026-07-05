"""Tests for CreateTerminalSessionTool and RunCommandTool streaming."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from kali_core.claws.base import ToolContext
from kali_core.claws.terminal_session import CreateTerminalSessionTool
from kali_core.nest.store import SessionStore


@pytest_asyncio.fixture
async def store() -> SessionStore:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    s = SessionStore(db_path)
    yield s
    Path(db_path).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_create_terminal_session_tool(store: SessionStore) -> None:
    chat = await store.create_session(title="Chat 1")
    tool = CreateTerminalSessionTool()
    ctx = ToolContext(
        session_id=chat["id"],
        working_dir=".",
        profile="dev",
        session_store=store,
    )
    result = await tool.run({"display_name": "Deploy backend"}, ctx)
    assert result.error is None
    assert result.output["terminal_session_id"].startswith("tsess_")
    assert result.output["display_name"] == "Deploy backend"


def test_create_terminal_session_tool_safe_risk() -> None:
    tool = CreateTerminalSessionTool()
    assert tool.risk_level == "safe"
    assert tool.name == "create_terminal_session"


@pytest.mark.asyncio
async def test_create_terminal_session_tool_missing_name(store: SessionStore) -> None:
    tool = CreateTerminalSessionTool()
    ctx = ToolContext(session_id="x", working_dir=".", profile="dev", session_store=store)
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "display_name" in result.error.lower()