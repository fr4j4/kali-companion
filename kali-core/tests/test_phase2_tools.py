"""Tests for Phase 2 tools: run_tests, git_worktree, git_diff, launch_app."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from kali_core.claws.base import ToolContext, available_tools
from kali_core.claws.git import GitDiffTool, GitWorktreeTool
from kali_core.claws.launcher import LaunchAppTool
from kali_core.claws.tests import RunTestsTool
from kali_core.server import _register_tools

# ── Tool registry ─────────────────────────────────────────


def test_phase2_tools_registered():
    """All Phase 2 tools are registered."""
    _register_tools()
    names = [t.name for t in available_tools()]
    assert "run_tests" in names
    assert "git_worktree" in names
    assert "git_diff" in names
    assert "launch_app" in names


# ── run_tests tool ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_tests_detect_pytest():
    """run_tests auto-detects pytest from pyproject.toml."""
    tool = RunTestsTool()
    with tempfile.TemporaryDirectory() as d:
        # Create a minimal pyproject.toml to trigger pytest detection.
        Path(d, "pyproject.toml").write_text("[tool.pytest.ini_options]\n")
        # Create a passing test file.
        Path(d, "test_pass.py").write_text("def test_ok(): assert True\n")

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({}, ctx)
        assert result.error is None
        assert result.output["framework"] == "pytest"
        assert result.output["passed"] is True


@pytest.mark.asyncio
async def test_run_tests_explicit_framework():
    """run_tests uses the framework param when provided."""
    tool = RunTestsTool()
    with tempfile.TemporaryDirectory() as d:
        # Create a minimal passing test file.
        Path(d, "test_pass.py").write_text("def test_ok(): assert True\n")
        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"framework": "pytest", "timeout": 30}, ctx)
        assert result.error is None
        assert result.output["framework"] == "pytest"
        assert result.output["passed"] is True


# ── git_worktree tool ──────────────────────────────────────


@pytest.mark.asyncio
async def test_git_worktree_creates_branch():
    """git_worktree creates a worktree + branch in a temp git repo."""
    tool = GitWorktreeTool()
    with tempfile.TemporaryDirectory() as d:
        # Initialize a git repo with one commit.
        import subprocess
        subprocess.run(["git", "init"], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=d, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=d, capture_output=True)
        Path(d, "README.md").write_text("# Test\n")
        subprocess.run(["git", "add", "."], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=d, capture_output=True, check=True)

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"branch": "feature-1"}, ctx)
        assert result.error is None
        assert result.output["branch"] == "feature-1"
        assert "worktree_path" in result.output
        # Verify the worktree was created.
        assert Path(result.output["worktree_path"]).exists()


@pytest.mark.asyncio
async def test_git_worktree_not_a_repo():
    """git_worktree fails gracefully when not in a git repo."""
    tool = GitWorktreeTool()
    with tempfile.TemporaryDirectory() as d:
        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"branch": "test"}, ctx)
        assert result.error is not None
        assert "git" in result.error.lower() or "not a git" in result.error.lower()


# ── git_diff tool ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_git_diff_no_changes():
    """git_diff returns empty diff when there are no changes."""
    tool = GitDiffTool()
    with tempfile.TemporaryDirectory() as d:
        import subprocess
        subprocess.run(["git", "init"], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=d, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=d, capture_output=True)
        Path(d, "file.txt").write_text("hello\n")
        subprocess.run(["git", "add", "."], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=d, capture_output=True, check=True)

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({}, ctx)
        assert result.error is None
        assert result.output["diff"] == ""


@pytest.mark.asyncio
async def test_git_diff_with_changes():
    """git_diff shows changes and emits a diff artifact."""
    tool = GitDiffTool()
    with tempfile.TemporaryDirectory() as d:
        import subprocess
        subprocess.run(["git", "init"], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=d, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=d, capture_output=True)
        Path(d, "file.txt").write_text("hello\n")
        subprocess.run(["git", "add", "."], cwd=d, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=d, capture_output=True, check=True)
        # Make a change.
        Path(d, "file.txt").write_text("hello world\n")

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({}, ctx)
        assert result.error is None
        assert "hello" in result.output["diff"]
        assert result.artifact is not None
        assert result.artifact["type"] == "diff"


# ── launch_app tool ────────────────────────────────────────


@pytest.mark.asyncio
async def test_launch_app_not_found():
    """launch_app returns error for nonexistent app."""
    tool = LaunchAppTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"name": "nonexistent-app-xyz123"}, ctx)
    assert result.error is not None
    assert "not found" in result.error.lower() or "no such" in result.error.lower()


# ── web_search tool ───────────────────────────────────────


@pytest.mark.asyncio
async def test_web_search_returns_results(monkeypatch):
    """web_search returns parsed results from SearXNG."""
    from kali_core.claws.web import WebSearchTool

    fake_response = {
        "results": [
            {"title": "Python docs", "url": "https://python.org", "content": "Python is great"},
            {"title": "PyPI", "url": "https://pypi.org", "content": "Package index"},
        ]
    }

    class FakeResponse:
        def raise_for_status(self): pass
        def json(self): return fake_response
        def headers(self): return {}

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs): return FakeResponse()

    monkeypatch.setattr("kali_core.claws.web.httpx.AsyncClient", lambda **kw: FakeClient())

    tool = WebSearchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"query": "python", "num_results": 2}, ctx)
    assert result.error is None
    assert result.output["query"] == "python"
    assert len(result.output["results"]) == 2
    assert result.output["results"][0]["title"] == "Python docs"


@pytest.mark.asyncio
async def test_web_search_missing_query():
    """web_search returns error when query is missing."""
    from kali_core.claws.web import WebSearchTool

    tool = WebSearchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "query" in result.error.lower()


@pytest.mark.asyncio
async def test_web_search_http_error(monkeypatch):
    """web_search handles HTTP errors gracefully."""
    import httpx

    from kali_core.claws.web import WebSearchTool

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr("kali_core.claws.web.httpx.AsyncClient", lambda **kw: FakeClient())

    tool = WebSearchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"query": "test"}, ctx)
    assert result.error is not None
    assert "search failed" in result.error.lower()


# ── web_fetch tool ────────────────────────────────────────


@pytest.mark.asyncio
async def test_web_fetch_extracts_text(monkeypatch):
    """web_fetch fetches a URL and extracts text content."""
    from kali_core.claws.web import WebFetchTool

    class FakeResponse:
        status_code = 200
        text = "<html><body><h1>Hello</h1><p>World</p></body></html>"
        headers = {"content-type": "text/html"}
        def raise_for_status(self): pass

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs): return FakeResponse()

    monkeypatch.setattr("kali_core.claws.web.httpx.AsyncClient", lambda **kw: FakeClient())

    tool = WebFetchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"url": "https://example.com"}, ctx)
    assert result.error is None
    assert result.output["url"] == "https://example.com"
    assert result.output["status_code"] == 200
    assert "Hello" in result.output["content"]
    assert "World" in result.output["content"]
    assert "<html>" not in result.output["content"]


@pytest.mark.asyncio
async def test_web_fetch_invalid_url():
    """web_fetch rejects non-http URLs."""
    from kali_core.claws.web import WebFetchTool

    tool = WebFetchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"url": "ftp://example.com"}, ctx)
    assert result.error is not None
    assert "http" in result.error.lower()


@pytest.mark.asyncio
async def test_web_fetch_missing_url():
    """web_fetch returns error when url is missing."""
    from kali_core.claws.web import WebFetchTool

    tool = WebFetchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "url" in result.error.lower()


@pytest.mark.asyncio
async def test_web_fetch_http_error(monkeypatch):
    """web_fetch handles HTTP errors gracefully."""
    import httpx

    from kali_core.claws.web import WebFetchTool

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            raise httpx.ConnectError("connection refused")

    monkeypatch.setattr("kali_core.claws.web.httpx.AsyncClient", lambda **kw: FakeClient())

    tool = WebFetchTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"url": "https://example.com"}, ctx)
    assert result.error is not None
    assert "fetch failed" in result.error.lower()