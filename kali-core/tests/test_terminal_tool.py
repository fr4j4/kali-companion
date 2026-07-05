"""Tests for CreateTerminalSessionTool and RunCommandTool streaming."""

from __future__ import annotations

import contextlib
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from kali_core.claws.base import ToolContext
from kali_core.claws.command import RunCommandTool
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


@pytest.mark.asyncio
async def test_run_command_streams_output_lines() -> None:
    """RunCommandTool emits command_start, command_output per line, command_end."""
    tool = RunCommandTool()
    emitted: list[dict] = []

    async def fake_emit(payload: dict) -> None:
        emitted.append(payload)

    ctx = ToolContext(
        session_id="test_session",
        working_dir=".",
        profile="dev",
        emit=fake_emit,
        call_id="cmd_test01",
    )
    result = await tool.run(
        {"command": "echo line1\\necho line2", "timeout": 5},
        ctx,
    )
    assert result.error is None
    assert result.output["exit_code"] == 0

    event_types = [e["event"] for e in emitted]
    assert "command_start" in event_types
    assert "command_end" in event_types

    start_ev = next(e for e in emitted if e["event"] == "command_start")
    assert start_ev["call_id"] == "cmd_test01"
    assert start_ev["command"] == "echo line1\\necho line2"

    end_ev = next(e for e in emitted if e["event"] == "command_end")
    assert end_ev["call_id"] == "cmd_test01"
    assert end_ev["exit_code"] == 0
    assert end_ev["status"] == "done"

    output_evs = [e for e in emitted if e["event"] == "command_output"]
    all_text = " ".join(e["line"] for e in output_evs)
    assert "line1" in all_text
    assert "line2" in all_text


@pytest.mark.asyncio
async def test_run_command_emits_on_error() -> None:
    """command_end is emitted with status=error on non-zero exit."""
    tool = RunCommandTool()
    emitted: list[dict] = []

    async def fake_emit(payload: dict) -> None:
        emitted.append(payload)

    ctx = ToolContext(
        session_id="test_session",
        working_dir=".",
        profile="dev",
        emit=fake_emit,
        call_id="cmd_test02",
    )
    result = await tool.run(
        {"command": "exit 1", "timeout": 5},
        ctx,
    )
    assert result.output["exit_code"] == 1
    end_ev = next(e for e in emitted if e["event"] == "command_end")
    assert end_ev["status"] == "error"
    assert end_ev["exit_code"] == 1


@pytest.mark.asyncio
async def test_run_command_persists_to_store(store: SessionStore) -> None:
    """Command and output are persisted to SQLite when session_store is available."""
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Test")

    tool = RunCommandTool()
    emitted: list[dict] = []

    async def fake_emit(payload: dict) -> None:
        emitted.append(payload)

    ctx = ToolContext(
        session_id=chat["id"],
        working_dir=".",
        profile="dev",
        emit=fake_emit,
        call_id="cmd_persist01",
        session_store=store,
    )
    result = await tool.run(
        {"command": "echo hello", "timeout": 5, "terminal_session_id": ts["id"]},
        ctx,
    )
    assert result.error is None

    full = await store.get_terminal_session_full(ts["id"])
    assert len(full["commands"]) == 1
    cmd = full["commands"][0]
    assert cmd["command"] == "echo hello"
    assert cmd["status"] == "done"
    assert cmd["exit_code"] == 0
    assert len(cmd["output_lines"]) >= 1
    assert any("hello" in line[1] for line in cmd["output_lines"])


@pytest.mark.asyncio
async def test_run_command_auto_creates_session(store: SessionStore) -> None:
    """When terminal_session_id is not provided, a session is auto-created."""
    chat = await store.create_session()

    tool = RunCommandTool()
    ctx = ToolContext(
        session_id=chat["id"],
        working_dir=".",
        profile="dev",
        call_id="cmd_auto01",
        session_store=store,
    )
    result = await tool.run(
        {"command": "echo test", "timeout": 5},
        ctx,
    )
    assert result.error is None
    sessions = await store.list_terminal_sessions(chat["id"])
    assert len(sessions) == 1
    full = await store.get_terminal_session_full(sessions[0]["id"])
    assert len(full["commands"]) == 1


@pytest.mark.asyncio
async def test_run_command_cancellation_kills_proc() -> None:
    """When cancelled, the subprocess is killed and command_end with status=cancelled is emitted."""
    import asyncio

    tool = RunCommandTool()
    emitted: list[dict] = []

    async def fake_emit(payload: dict) -> None:
        emitted.append(payload)

    ctx = ToolContext(
        session_id="test_session",
        working_dir=".",
        profile="dev",
        emit=fake_emit,
        call_id="cmd_cancel01",
    )

    task = asyncio.create_task(
        tool.run({"command": "sleep 30", "timeout": 60}, ctx)
    )
    await asyncio.sleep(0.1)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    end_ev = next((e for e in emitted if e["event"] == "command_end"), None)
    assert end_ev is not None
    assert end_ev["status"] == "cancelled"


@pytest.mark.asyncio
async def test_full_terminal_session_flow(store: SessionStore) -> None:
    """Create session → run command → verify persistence → close → verify completed."""
    from kali_core.claws.base import register
    from kali_core.collar.consent import ConsentManager
    from kali_core.collar.gateway import PermissionGateway
    from kali_core.mind.executor import Executor

    chat = await store.create_session(title="Integration test")

    register(CreateTerminalSessionTool())
    register(RunCommandTool())

    gw = PermissionGateway()
    consent = ConsentManager(timeout=10)

    async def auto_allow(payload):
        consent.respond(payload["id"], "allow")

    consent.set_send_callback(auto_allow)
    executor = Executor(
        gateway=gw, consent=consent, working_dir=".", profile="dev",
        session_store=store,
    )

    create_result = await executor.execute(
        "create_terminal_session",
        {"display_name": "Integration test build"},
        chat["id"],
    )
    assert create_result.error is None
    ts_id = create_result.output["terminal_session_id"]

    run_result = await executor.execute(
        "run_command",
        {"command": "echo integration-test", "timeout": 5, "terminal_session_id": ts_id},
        chat["id"],
    )
    assert run_result.error is None
    assert "integration-test" in run_result.output["stdout"]

    full = await store.get_terminal_session_full(ts_id)
    assert full["display_name"] == "Integration test build"
    assert full["status"] == "active"
    assert len(full["commands"]) == 1
    assert full["commands"][0]["command"] == "echo integration-test"
    assert any("integration-test" in line[1] for line in full["commands"][0]["output_lines"])

    closed_ids = await store.close_terminal_sessions_for_chat(chat["id"])
    assert ts_id in closed_ids

    sessions = await store.list_terminal_sessions(chat["id"])
    assert sessions[0]["status"] == "completed"

    replay_list = await store.list_terminal_sessions(chat["id"])
    assert len(replay_list) == 1
    assert replay_list[0]["command_count"] == 1

    replay_full = await store.get_terminal_session_full(ts_id)
    assert replay_full["status"] == "completed"
    assert len(replay_full["commands"]) == 1


@pytest.mark.asyncio
async def test_delete_chat_cleans_terminal_data(store: SessionStore) -> None:
    """Deleting a chat session removes all terminal sessions, commands, and output."""
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    cmd = await store.add_terminal_command(ts["id"], "cmd_001", "npm install", ".")
    await store.batch_add_terminal_output(cmd["id"], [("stdout", "hello", 0)])

    await store.delete_session(chat["id"])

    assert await store.list_terminal_sessions(chat["id"]) == []
    assert await store.get_terminal_session_full(ts["id"]) is None