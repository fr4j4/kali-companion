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

# Common XDG application directories.
_DESKTOP_DIRS = [
    Path.home() / ".local" / "share" / "applications",
    Path("/usr/share/applications"),
    Path("/usr/local/share/applications"),
]


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


class LaunchAppTool:
    name = "launch_app"
    description = (
        "Launch an application by its desktop entry name (e.g. 'firefox', "
        "'code', 'steam'). Uses XDG .desktop files on Linux."
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