"""App launcher tool — launch_app.

Launches an application by its desktop entry name on Linux (XDG .desktop
files). Searches common application directories and runs the Exec line
from the .desktop file.
"""

from __future__ import annotations

import asyncio
import os
import shlex
from pathlib import Path

from .base import ToolContext, ToolResult

def _desktop_dirs() -> list[Path]:
    """XDG application directories, including Flatpak and Snap exports."""
    dirs = [Path.home() / ".local" / "share" / "applications"]
    for base in os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":"):
        if base:
            dirs.append(Path(base) / "applications")
    dirs += [
        Path.home() / ".local" / "share" / "flatpak" / "exports" / "share" / "applications",
        Path("/var/lib/flatpak/exports/share/applications"),
        Path("/var/lib/snapd/desktop/applications"),
    ]
    seen: list[Path] = []
    for d in dirs:
        if d not in seen:
            seen.append(d)
    return seen


_DESKTOP_DIRS = _desktop_dirs()


def _parse_desktop_file(path: Path) -> dict | None:
    """Parse a .desktop file and return key fields, or None if invalid."""
    import configparser

    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read(path, encoding="utf-8")
    except (configparser.Error, OSError):
        return None

    if "Desktop Entry" not in parser:
        return None

    entry = parser["Desktop Entry"]
    # Skip non-application entries.
    entry_type = entry.get("Type", "")
    if entry_type and entry_type != "Application":
        return None

    return {
        "name": entry.get("Name", path.stem),
        "exec": entry.get("Exec", ""),
        "icon": entry.get("Icon", ""),
        "terminal": entry.get("Terminal", "false").lower() == "true",
        "categories": entry.get("Categories", ""),
        "generic": entry.get("GenericName", ""),
        "keywords": entry.get("Keywords", ""),
        "hidden": entry.get("NoDisplay", "false").lower() == "true" or entry.get("Hidden", "false").lower() == "true",
    }


def _find_desktop_file(name: str) -> Path | None:
    """Find a .desktop file by app name (with or without .desktop suffix)."""
    if not name.endswith(".desktop"):
        name = f"{name}.desktop"

    for d in _DESKTOP_DIRS:
        if not d.exists():
            continue
        candidate = d / name
        if candidate.is_file():
            return candidate
    return None


def _installed_apps() -> list[dict]:
    """Visible applications found in the desktop directories (fallback without a desktop agent)."""
    apps: dict[str, dict] = {}
    for d in _DESKTOP_DIRS:
        if not d.exists():
            continue
        for path in sorted(d.glob("*.desktop")):
            if path.stem in apps:
                continue
            entry = _parse_desktop_file(path)
            if entry is None or not entry["exec"] or entry["hidden"]:
                continue
            apps[path.stem] = {**entry, "id": path.stem}
    return list(apps.values())


def rank_apps(apps: list[dict], query: str, limit: int = 5) -> list[dict]:
    """Rank apps for a free-text query; every word must match something."""
    words = query.lower().split()
    if not words:
        return []
    scored: list[tuple[int, dict]] = []
    for app in apps:
        total = 0
        for w in words:
            ident, name = app["id"].lower(), app["name"].lower()
            if ident == w or name == w:
                score = 100
            elif ident.rsplit(".", 1)[-1] == w:
                score = 90
            elif name.startswith(w):
                score = 80
            elif w in name:
                score = 60
            elif w in app["generic"].lower() or w in app["keywords"].lower():
                score = 50
            elif w in ident:
                score = 45
            elif w in app["categories"].lower():
                score = 20
            else:
                score = 0
            if score == 0:
                total = 0
                break
            total += score
        if total:
            scored.append((total // len(words), app))
    scored.sort(key=lambda item: (-item[0], item[1]["name"]))
    return [
        {"id": a["id"], "name": a["name"], "description": a["generic"], "score": s}
        for s, a in scored[:limit]
    ]


class FindAppsTool:
    name = "find_apps"
    description = (
        "Search the installed applications by name, purpose or keyword (e.g. 'browser', "
        "'file manager', 'photo editor'). Returns up to 5 candidates with the exact id to pass "
        "to launch_app. Use it when you do not know the exact desktop entry name."
    )
    schema = {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What the user wants to open."}},
        "required": ["query"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        query = str(params.get("query", "")).strip()
        if not query or len(query) > 100:
            return ToolResult(error="Missing or too long 'query' parameter.")
        return ToolResult(output={"apps": rank_apps(_installed_apps(), query)})


class LaunchAppTool:
    name = "launch_app"
    description = (
        "Launch an application by its exact desktop entry id (e.g. 'org.mozilla.firefox', "
        "'steam'). If you are not sure of the id, call find_apps first. The user is always "
        "asked before an application is opened."
    )
    schema = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Desktop entry name (e.g. 'firefox', 'org.gnome.Calculator').",
            },
        },
        "required": ["name"],
        "additionalProperties": False,
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        name = params.get("name", "")
        if not name:
            return ToolResult(error="Missing 'name' parameter.")

        desktop_path = _find_desktop_file(name)
        if desktop_path is None:
            return ToolResult(error=f"Application '{name}' not found in desktop entries.")

        entry = _parse_desktop_file(desktop_path)
        if entry is None:
            return ToolResult(error=f"Failed to parse .desktop file: {desktop_path}")

        exec_str = entry["exec"]
        if not exec_str:
            return ToolResult(error=f"No Exec line in {desktop_path}")

        # Remove field codes like %f, %u, %F, %U from the Exec line.
        import re
        exec_clean = re.sub(r"%[a-zA-Z]", "", exec_str).strip()

        # Launch detached from the current process.
        try:
            # Use nohup + & to detach the process so it survives the agent.
            parts = shlex.split(exec_clean)
            env = os.environ.copy()
            proc = await asyncio.create_subprocess_exec(
                *parts,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
                start_new_session=True,
            )
        except (OSError, ValueError) as e:
            return ToolResult(error=f"Failed to launch '{name}': {e}")

        return ToolResult(
            output={
                "name": entry["name"],
                "exec": exec_clean,
                "pid": proc.pid,
                "desktop_file": str(desktop_path),
                "message": f"Launched '{entry['name']}' (PID {proc.pid})",
            }
        )