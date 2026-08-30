"""Tests for working_dirs enforcement (S2 hardening)."""

import json
import tempfile
from pathlib import Path

import pytest

from kali_core.claws.base import ToolContext
from kali_core.claws.fs import FsListTool, FsReadTool


@pytest.fixture()
def sandbox(tmp_path: Path) -> Path:
    """Synthetic profile dir pointing at tmp sandbox; returns sandbox root."""
    profile_dir = tmp_path / "profiles"
    profile_dir.mkdir()
    root = tmp_path / "sandbox"
    root.mkdir()
    (root / "allowed.txt").write_text("hola\n")
    (root / "sub").mkdir()
    (root / "sub" / "inner.txt").write_text("inner\n")
    outside = tmp_path / "outside.txt"
    outside.write_text("secreto\n")

    cfg = {
        "id": "testprof",
        "name": "Test",
        "allowed_tools": ["fs_read", "fs_list"],
        "working_dirs": [f"{root}/**"],
        "command_whitelist": [],
    }
    (profile_dir / "testprof.json").write_text(json.dumps(cfg))
    paths_mod.PROFILES_DIR_OVERRIDE = profile_dir  # type: ignore[attr-defined]
    yield root
    paths_mod.PROFILES_DIR_OVERRIDE = None  # type: ignore[attr-defined]


def make_ctx(profile: str = "testprof", working_dir: str = "/tmp") -> ToolContext:
    return ToolContext(session_id="t", working_dir=working_dir, profile=profile)


@pytest.mark.asyncio()
async def test_read_inside_allowed_root(sandbox: Path):
    ctx = make_ctx()
    result = await FsReadTool().run({"path": str(sandbox / "allowed.txt")}, ctx)
    assert "hola" in str(result.output.get("content"))


@pytest.mark.asyncio()
async def test_read_outside_denied(sandbox: Path, tmp_path: Path):
    ctx = make_ctx()
    result = await FsReadTool().run({"path": str(tmp_path / "outside.txt")}, ctx)
    assert result.error is not None
    assert "working_dirs" in result.error


@pytest.mark.asyncio()
async def test_list_inside_ok(sandbox: Path):
    ctx = make_ctx()
    result = await FsListTool().run({"path": str(sandbox)}, ctx)
    assert result.output is not None


@pytest.mark.asyncio()
async def test_list_outside_denied(sandbox: Path, tmp_path: Path):
    ctx = make_ctx()
    result = await FsListTool().run({"path": str(tmp_path)}, ctx)
    assert result.error is not None


@pytest.mark.asyncio()
async def test_traversal_rejected(sandbox: Path):
    ctx = make_ctx()
    sneaky = str(sandbox / "sub" / ".." / ".." / "outside.txt")
    result = await FsReadTool().run({"path": sneaky}, ctx)
    assert result.error is not None


@pytest.mark.asyncio()
async def test_empty_working_dirs_denies_all(sandbox: Path, monkeypatch):
    monkeypatch.setattr(paths_mod, "_profile_working_dirs", lambda p: [])
    ctx = make_ctx()
    result = await FsReadTool().run({"path": str(sandbox / "allowed.txt")}, ctx)
    assert result.error is not None


@pytest.mark.asyncio()
async def test_prefix_dir_allowed(sandbox: Path):
    """'root/**' pattern should also allow listing root itself."""
    ctx = make_ctx()
    result = await FsListTool().run({"path": str(sandbox)}, ctx)
    assert result.output is not None


import kali_core.claws.paths as paths_mod  # noqa: E402