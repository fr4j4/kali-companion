"""Tests for terminal session persistence in SessionStore."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from kali_core.nest.store import SessionStore


@pytest_asyncio.fixture
async def store() -> SessionStore:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    s = SessionStore(db_path)
    yield s
    Path(db_path).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_create_terminal_session(store: SessionStore) -> None:
    chat = await store.create_session(title="Chat 1")
    ts = await store.create_terminal_session(chat["id"], "Deploy backend")
    assert ts["id"].startswith("tsess_")
    assert ts["chat_session_id"] == chat["id"]
    assert ts["display_name"] == "Deploy backend"
    assert ts["status"] == "active"
    assert "created" in ts


@pytest.mark.asyncio
async def test_list_terminal_sessions_empty(store: SessionStore) -> None:
    chat = await store.create_session()
    sessions = await store.list_terminal_sessions(chat["id"])
    assert sessions == []


@pytest.mark.asyncio
async def test_list_terminal_sessions_scoped_to_chat(store: SessionStore) -> None:
    chat1 = await store.create_session(title="Chat 1")
    chat2 = await store.create_session(title="Chat 2")
    await store.create_terminal_session(chat1["id"], "Build")
    await store.create_terminal_session(chat1["id"], "Deploy")
    await store.create_terminal_session(chat2["id"], "Other")

    s1 = await store.list_terminal_sessions(chat1["id"])
    s2 = await store.list_terminal_sessions(chat2["id"])
    assert len(s1) == 2
    assert len(s2) == 1
    assert s2[0]["display_name"] == "Other"


@pytest.mark.asyncio
async def test_list_terminal_sessions_includes_command_count(store: SessionStore) -> None:
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    await store.add_terminal_command(ts["id"], "cmd_001", "npm install", "/project")
    await store.add_terminal_command(ts["id"], "cmd_002", "npm run build", "/project")
    sessions = await store.list_terminal_sessions(chat["id"])
    assert sessions[0]["command_count"] == 2


@pytest.mark.asyncio
async def test_add_terminal_command(store: SessionStore) -> None:
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    cmd = await store.add_terminal_command(ts["id"], "cmd_001", "npm install", "/project")
    assert cmd["id"] == "cmd_001"
    assert cmd["terminal_session_id"] == ts["id"]
    assert cmd["command"] == "npm install"
    assert cmd["cwd"] == "/project"
    assert cmd["status"] == "running"
    assert cmd["exit_code"] is None
    assert "started" in cmd


@pytest.mark.asyncio
async def test_batch_add_terminal_output(store: SessionStore) -> None:
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    cmd = await store.add_terminal_command(ts["id"], "cmd_001", "echo hello", ".")
    lines = [
        ("stdout", "hello", 0),
        ("stderr", "warning", 1),
        ("stdout", "done", 2),
    ]
    await store.batch_add_terminal_output(cmd["id"], lines)
    full = await store.get_terminal_session_full(ts["id"])
    assert len(full["commands"]) == 1
    assert len(full["commands"][0]["output_lines"]) == 3
    assert full["commands"][0]["output_lines"][0] == ("stdout", "hello", 0)


@pytest.mark.asyncio
async def test_update_terminal_command(store: SessionStore) -> None:
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    cmd = await store.add_terminal_command(ts["id"], "cmd_001", "echo test", ".")
    await store.update_terminal_command(cmd["id"], exit_code=0, status="done")
    full = await store.get_terminal_session_full(ts["id"])
    assert full["commands"][0]["status"] == "done"
    assert full["commands"][0]["exit_code"] == 0
    assert full["commands"][0]["finished"] is not None


@pytest.mark.asyncio
async def test_close_terminal_sessions_for_chat(store: SessionStore) -> None:
    chat = await store.create_session()
    ts1 = await store.create_terminal_session(chat["id"], "Build")
    ts2 = await store.create_terminal_session(chat["id"], "Deploy")
    closed_ids = await store.close_terminal_sessions_for_chat(chat["id"])
    assert set(closed_ids) == {ts1["id"], ts2["id"]}
    sessions = await store.list_terminal_sessions(chat["id"])
    assert all(s["status"] == "completed" for s in sessions)


@pytest.mark.asyncio
async def test_close_terminal_sessions_only_active(store: SessionStore) -> None:
    chat = await store.create_session()
    await store.create_terminal_session(chat["id"], "Build")
    await store.close_terminal_sessions_for_chat(chat["id"])
    ts2 = await store.create_terminal_session(chat["id"], "Deploy")
    closed_ids = await store.close_terminal_sessions_for_chat(chat["id"])
    assert closed_ids == [ts2["id"]]


@pytest.mark.asyncio
async def test_delete_session_cleans_terminal_tables(store: SessionStore) -> None:
    chat = await store.create_session()
    ts = await store.create_terminal_session(chat["id"], "Build")
    cmd = await store.add_terminal_command(ts["id"], "cmd_001", "npm install", ".")
    await store.batch_add_terminal_output(cmd["id"], [("stdout", "hello", 0)])

    await store.delete_session(chat["id"])

    sessions = await store.list_terminal_sessions(chat["id"])
    assert sessions == []
    full = await store.get_terminal_session_full(ts["id"])
    assert full is None