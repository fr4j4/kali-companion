"""Tests for kali-claws tools, kali-collar permissions, and consent flow."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from kali_core.claws.base import ToolContext, available_tools, register
from kali_core.claws.command import RunCommandTool
from kali_core.claws.fs import FsListTool, FsReadTool
from kali_core.collar.gateway import PermissionGateway
from kali_core.mind.executor import Executor

# ── Tool registry ─────────────────────────────────────────


def test_tools_registered():
    """All Phase 1C tools are registered."""
    from kali_core.server import _register_tools
    _register_tools()
    names = [t.name for t in available_tools()]
    assert "fs_read" in names
    assert "fs_list" in names
    assert "run_command" in names
    assert "web_search" in names
    assert "web_fetch" in names


# ── fs_read tool ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_fs_read_tool():
    tool = FsReadTool()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write("hello world\nline 2\n")
        path = f.name
    try:
        ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
        result = await tool.run({"path": path}, ctx)
        assert result.error is None
        assert "hello world" in result.output["content"]
        assert "line 2" in result.output["content"]
    finally:
        Path(path).unlink()


@pytest.mark.asyncio
async def test_fs_read_nonexistent():
    tool = FsReadTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"path": "/nonexistent/file"}, ctx)
    assert result.error is not None
    assert "not found" in result.error.lower() or "no such file" in result.error.lower()


@pytest.mark.asyncio
async def test_fs_list_tool():
    tool = FsListTool()
    with tempfile.TemporaryDirectory() as d:
        Path(d, "a.txt").write_text("a")
        Path(d, "b.txt").write_text("b")
        ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
        result = await tool.run({"path": d}, ctx)
        assert result.error is None
        names = [e["name"] for e in result.output["entries"]]
        assert "a.txt" in names
        assert "b.txt" in names


# ── run_command tool ──────────────────────────────────────


@pytest.mark.asyncio
async def test_run_command_echo():
    tool = RunCommandTool()
    result = await tool.run(
        {"command": "echo hello", "timeout": 5},
        ToolContext(session_id="t", working_dir=".", profile="dev"),
    )
    assert result.error is None
    assert result.output["exit_code"] == 0
    assert "hello" in result.output["stdout"]


@pytest.mark.asyncio
async def test_run_command_timeout():
    tool = RunCommandTool()
    result = await tool.run(
        {"command": "sleep 10", "timeout": 1},
        ToolContext(session_id="t", working_dir=".", profile="dev"),
    )
    assert result.error is not None
    assert "timed out" in result.error.lower()


# ── PermissionGateway ──────────────────────────────────────


def test_gateway_safe_tool_allowed():
    gw = PermissionGateway()
    decision = gw.check("fs_read", "safe", {}, "dev")
    assert decision.allow
    assert not decision.needs_consent


def test_gateway_dangerous_needs_consent():
    gw = PermissionGateway()
    decision = gw.check("run_command", "dangerous", {"command": "rm -rf /"}, "general")
    assert not decision.allow
    assert decision.needs_consent


def test_gateway_sensitive_allowed_in_profile():
    gw = PermissionGateway()
    # run_tests is in dev profile's allowed_tools, but risk=sensitive.
    decision = gw.check("run_tests", "sensitive", {}, "dev")
    assert decision.allow


def test_gateway_sensitive_not_in_profile():
    gw = PermissionGateway()
    decision = gw.check("run_tests", "sensitive", {}, "general")
    assert not decision.allow
    assert decision.needs_consent


def test_gateway_command_whitelist():
    gw = PermissionGateway()
    # "pytest" is in dev profile's command_whitelist.
    decision = gw.check("run_command", "dangerous", {"command": "pytest"}, "dev")
    assert decision.allow


def test_gateway_command_not_in_whitelist():
    gw = PermissionGateway()
    decision = gw.check("run_command", "dangerous", {"command": "rm -rf /"}, "dev")
    assert not decision.allow
    assert decision.needs_consent


# ── Executor ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_executor_safe_tool():
    """Executor runs a safe tool without consent."""
    from kali_core.collar.consent import ConsentManager
    gw = PermissionGateway()
    consent = ConsentManager()
    register(FsReadTool())
    executor = Executor(gateway=gw, consent=consent, working_dir=".", profile="dev")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write("test content")
        path = f.name
    try:
        result = await executor.execute("fs_read", {"path": path}, "session1")
        assert result.error is None
        assert "test content" in result.output["content"]
    finally:
        Path(path).unlink()


@pytest.mark.asyncio
async def test_executor_dangerous_denied_without_consent():
    """Executor denies dangerous tool when consent is not given."""
    from kali_core.collar.consent import ConsentManager
    gw = PermissionGateway()
    consent = ConsentManager(timeout=0.5)  # Quick timeout for test.
    register(RunCommandTool())
    executor = Executor(gateway=gw, consent=consent, working_dir=".", profile="general")

    # No consent_response will come, so it should timeout and deny.
    result = await executor.execute(
        "run_command",
        {"command": "echo test"},
        "session1",
    )
    assert result.error is not None
    assert "denied" in result.error.lower() or "deny" in result.error.lower()


@pytest.mark.asyncio
async def test_executor_consent_allow():
    """Executor runs dangerous tool when consent is given."""
    from kali_core.collar.consent import ConsentManager
    gw = PermissionGateway()
    consent = ConsentManager(timeout=10)
    # Set up the callback to auto-respond "allow".
    async def auto_allow(payload):
        # Respond immediately.
        consent.respond(payload["id"], "allow")
    consent.set_send_callback(auto_allow)

    register(RunCommandTool())
    executor = Executor(gateway=gw, consent=consent, working_dir=".", profile="general")

    result = await executor.execute(
        "run_command",
        {"command": "echo consented", "timeout": 5},
        "session1",
    )
    assert result.error is None
    assert "consented" in result.output["stdout"]


@pytest.mark.asyncio
async def test_executor_consent_allow_session_remembers():
    """Executor remembers an 'allow_session' decision within the same chat session."""
    from kali_core.collar.consent import ConsentManager
    gw = PermissionGateway()
    consent = ConsentManager(timeout=10)

    responses = {"cmd1": "allow_session"}
    async def auto_respond(payload):
        responses.pop(payload["id"], None)
        consent.respond(payload["id"], "allow_session")
    consent.set_send_callback(auto_respond)

    register(RunCommandTool())
    executor = Executor(gateway=gw, consent=consent, working_dir=".", profile="general")

    # First call: user chooses "allow_session".
    result1 = await executor.execute(
        "run_command",
        {"command": "echo first", "timeout": 5},
        "session1",
    )
    assert result1.error is None
    assert "first" in result1.output["stdout"]

    # Second call: same session, different arguments, same command base.
    # No callback response is provided because it should be auto-granted.
    async def noop(_p):
        pass
    consent.set_send_callback(noop)
    result2 = await executor.execute(
        "run_command",
        {"command": "echo second", "timeout": 5},
        "session1",
    )
    assert result2.error is None
    assert "second" in result2.output["stdout"]
    assert consent.session_grant_count("session1") == 1


@pytest.mark.asyncio
async def test_executor_consent_allow_session_not_shared_between_sessions():
    """An 'allow_session' grant is scoped to one chat session."""
    from kali_core.collar.consent import ConsentManager
    gw = PermissionGateway()
    consent = ConsentManager(timeout=0.5)

    async def auto_respond(payload):
        consent.respond(payload["id"], "allow_session")
    consent.set_send_callback(auto_respond)

    register(RunCommandTool())
    executor = Executor(gateway=gw, consent=consent, working_dir=".", profile="general")

    result1 = await executor.execute(
        "run_command",
        {"command": "echo a", "timeout": 5},
        "session_a",
    )
    assert result1.error is None

    # Different session: should require consent again and timeout (deny).
    async def noop(_p):
        pass
    consent.set_send_callback(noop)
    result2 = await executor.execute(
        "run_command",
        {"command": "echo b", "timeout": 5},
        "session_b",
    )
    assert result2.error is not None
    assert "denied" in result2.error.lower() or "deny" in result2.error.lower()