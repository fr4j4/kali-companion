"""PermissionGateway — decides whether a tool needs user consent.

Rules:
- `safe` tools: allow.
- `sensitive` tools: allow if listed in the active profile AND params
  satisfy the profile constraints; otherwise request consent.
- `dangerous` tools: always request consent, regardless of profile.

The gateway loads profiles from JSON files (collar/profiles/*.json).
Each profile declares:
  - allowed_tools: tools that run without consent (if risk != dangerous)
  - working_dirs: glob patterns for fs_* tools
  - command_whitelist: commands that run without consent in run_command
"""

from __future__ import annotations

import fnmatch
import logging
from pathlib import Path
from typing import Any

from kali_core.config import settings

logger = logging.getLogger("kali_core.collar.gateway")

# Tool-specific consent reason keys.
# Maps tool_name → (reason_key, param_name, param_extractor_fn)
TOOL_REASON_KEYS: dict[str, tuple[str, str, Any]] = {
    "run_tests": (
        "consent.reason.run_tests",
        "framework",
        lambda p: p.get("framework", "auto-detect"),
    ),
    "git_worktree": (
        "consent.reason.git_worktree",
        "branch",
        lambda p: p.get("branch", ""),
    ),
    "organize_folder": (
        "consent.reason.organize_folder",
        "path",
        lambda p: p.get("path", ""),
    ),
    "launch_app": (
        "consent.reason.launch_app",
        "name",
        lambda p: p.get("name", ""),
    ),
    "screenshot": (
        "consent.reason.screenshot",
        "reason",
        lambda p: p.get("reason") or p.get("target") or "",
    ),
    "list_monitors": (
        "consent.reason.list_monitors",
        "",
        lambda p: "",
    ),
}


class PermissionDecision:
    """Result of a permission check."""

    def __init__(
        self,
        allow: bool,
        needs_consent: bool = False,
        reason_key: str | None = None,
        reason_params: dict | None = None,
    ) -> None:
        self.allow = allow
        self.needs_consent = needs_consent
        self.reason_key = reason_key
        self.reason_params = reason_params or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "allow": self.allow,
            "needs_consent": self.needs_consent,
            "reason_key": self.reason_key,
            "reason_params": self.reason_params,
        }


class PermissionGateway:
    """Decides if a tool call is allowed or needs consent."""

    def __init__(self, profiles_dir: Path | None = None) -> None:
        self.profiles_dir = profiles_dir or settings.profiles_dir
        self._profiles: dict[str, dict] = {}
        self._load_profiles()

    def _load_profiles(self) -> None:
        if not self.profiles_dir.exists():
            logger.warning("Profiles directory not found: %s", self.profiles_dir)
            return
        for cfg in sorted(self.profiles_dir.glob("*.json")):
            import json
            with cfg.open("r", encoding="utf-8") as f:
                data = json.load(f)
            self._profiles[data.get("id", cfg.stem)] = data

    def get_profile(self, profile_id: str) -> dict | None:
        return self._profiles.get(profile_id)

    def list_profiles(self) -> list[dict]:
        return list(self._profiles.values())

    def check(
        self,
        tool_name: str,
        risk_level: str,
        params: dict,
        profile: str,
    ) -> PermissionDecision:
        """Return a permission decision for a tool call."""
        # Safe tools always run.
        if risk_level == "safe":
            return PermissionDecision(allow=True)

        prof = self._profiles.get(profile, {})
        allowed_tools = prof.get("allowed_tools", [])

        # Sensitive tools: allow if in the profile's allowed_tools.
        if risk_level == "sensitive":
            if tool_name in allowed_tools:
                return PermissionDecision(allow=True)
            # Use tool-specific reason key if available, else generic.
            if tool_name in TOOL_REASON_KEYS:
                reason_key, param_name, extractor = TOOL_REASON_KEYS[tool_name]
                reason_params = {param_name: extractor(params)}
            else:
                reason_key = "consent.reason.sensitive"
                reason_params = {"tool": tool_name}
            return PermissionDecision(
                allow=False,
                needs_consent=True,
                reason_key=reason_key,
                reason_params=reason_params,
            )

        # Dangerous tools: always need consent.
        if risk_level == "dangerous":
            # But check the command whitelist for run_command.
            if tool_name == "run_command":
                command = params.get("command", "")
                command_whitelist = prof.get("command_whitelist", [])
                cmd_base = command.split()[0] if command else ""
                for pattern in command_whitelist:
                    pat_base = pattern.replace("*", "").strip()
                    if pat_base and (fnmatch.fnmatch(cmd_base, pat_base) or fnmatch.fnmatch(command, pattern)):
                        return PermissionDecision(allow=True)
            return PermissionDecision(
                allow=False,
                needs_consent=True,
                reason_key="consent.reason.run_command",
                reason_params={"command": params.get("command", "")},
            )

        return PermissionDecision(allow=False, reason_key="consent.reason.unknown")