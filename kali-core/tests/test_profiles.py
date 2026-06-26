"""Tests for profile JSON files in kali-collar.

Verifies that all profiles load correctly and have the expected
allowed_tools for their phase.
"""

from __future__ import annotations

from kali_core.collar.gateway import PermissionGateway


def test_all_profiles_loaded():
    """All 4 profiles are loaded by the gateway."""
    gw = PermissionGateway()
    ids = [p["id"] for p in gw.list_profiles()]
    assert "dev" in ids
    assert "general" in ids
    assert "gaming" in ids
    assert "files" in ids


def test_dev_profile_allowed_tools():
    """dev profile whitelists the Phase 2 dev tools."""
    gw = PermissionGateway()
    prof = gw.get_profile("dev")
    assert prof is not None
    tools = prof["allowed_tools"]
    assert "fs_read" in tools
    assert "fs_list" in tools
    assert "run_tests" in tools
    assert "git_worktree" in tools
    assert "git_diff" in tools
    assert "launch_app" in tools


def test_general_profile_allowed_tools():
    """general profile whitelists web tools."""
    gw = PermissionGateway()
    prof = gw.get_profile("general")
    assert prof is not None
    tools = prof["allowed_tools"]
    assert "fs_read" in tools
    assert "fs_list" in tools
    assert "web_search" in tools
    assert "web_fetch" in tools


def test_gaming_profile_allowed_tools():
    """gaming profile whitelists web + game tools (forward-declared)."""
    gw = PermissionGateway()
    prof = gw.get_profile("gaming")
    assert prof is not None
    tools = prof["allowed_tools"]
    assert "web_search" in tools
    assert "web_fetch" in tools
    assert "fetch_game_resource" in tools


def test_files_profile_allowed_tools():
    """files profile whitelists fs + organize_folder (forward-declared)."""
    gw = PermissionGateway()
    prof = gw.get_profile("files")
    assert prof is not None
    tools = prof["allowed_tools"]
    assert "fs_read" in tools
    assert "fs_list" in tools
    assert "organize_folder" in tools


def test_dev_profile_has_command_whitelist():
    """dev profile has a command whitelist for run_command."""
    gw = PermissionGateway()
    prof = gw.get_profile("dev")
    assert prof is not None
    assert len(prof["command_whitelist"]) > 0
    assert "pytest" in prof["command_whitelist"]


def test_profiles_have_working_dirs():
    """All profiles declare working_dirs."""
    gw = PermissionGateway()
    for pid in ("dev", "general", "files", "gaming"):
        prof = gw.get_profile(pid)
        assert prof is not None
        assert "working_dirs" in prof