"""Path validation against the active profile's working_dirs (S2 hardening).

The fs_* tools resolve paths, but until now nothing validated the result
against the profile's ``working_dirs`` glob patterns — meaning any readable
file on the host was reachable. This module centralizes enforcement:

- Patterns live in the profile JSON (``kali_core/collar/profiles/*.json``)
  and use ``fnmatch``-style globs against the *resolved* path string, e.g.
  ``/mnt/data2/projects/**`` or ``~/projects/**``.
- Empty list = deny-all (safest default); profile "gaming" uses this.
- ``~`` in patterns is expanded against the HOME effective for the matching.
"""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path

_VALIDATOR_UNSET = object()
_validate_impl = None  # injected override for tests


def set_working_dirs_validator(fn) -> None:  # type: ignore[no-untyped-def]
    """Install a custom validator (used by tests)."""
    global _validate_impl
    _validate_impl = fn


def _profile_working_dirs(profile: str) -> list[str]:
    """Load working_dirs for a profile id (missing profile => deny-all)."""
    from ..collar.gateway import PermissionGateway

    override = getattr(paths_mod_module(), "PROFILES_DIR_OVERRIDE", None)
    if override is not None:
        profiles_dir = Path(override)
    else:
        profiles_dir = Path(__file__).resolve().parent.parent / "collar" / "profiles"
    mgr = PermissionGateway(profiles_dir=profiles_dir)
    prof = mgr.get_profile(profile)
    if not prof:
        return []
    raw = prof.get("working_dirs", [])
    return list(raw) if isinstance(raw, list) else []


def paths_mod_module():
    import sys

    return sys.modules[__name__]


PROFILES_DIR_OVERRIDE: Path | None = None


def _pattern_matches(pattern: str, resolved: str) -> bool:
    """fnmatch-style match with ~ expansion and ** cross-directory support."""
    expanded = os.path.expanduser(pattern)
    norm = resolved.replace(os.sep, "/")
    pat = expanded.replace(os.sep, "/")
    if fnmatch.fnmatch(norm, pat):
        return True
    # '~/x/**' should also match ~/x itself (prefix dir access).
    if pat.endswith("/**") and fnmatch.fnmatch(norm, pat[:-3]):
        return True
    return False


def path_allowed(path: Path, ctx) -> bool:  # type: ignore[no-untyped-def]
    """True when path is inside one of the profile's working_dirs."""
    if _validate_impl is not None:
        return bool(_validate_impl(path, ctx))
    patterns = _profile_working_dirs(getattr(ctx, "profile", ""))
    if not patterns:
        return False
    resolved = str(path)
    return any(_pattern_matches(p, resolved) for p in patterns)


def denial_result(path: Path):  # type: ignore[no-untyped-def]
    from .base import ToolResult

    return ToolResult(
        error=f"Path '{path}' is outside the profile's working_dirs. "
        "Ask the user to update the profile or provide a path inside the allowed roots."
    )