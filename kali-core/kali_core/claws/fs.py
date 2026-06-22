"""Filesystem tools — fs_read.

fs_read reads a file within the working directory (safe risk level).
The working_dir is provided by the ToolContext and must match a
working_dirs entry in the active profile.
"""

from __future__ import annotations

from pathlib import Path

from .base import ToolContext, ToolResult


class FsReadTool:
    name = "fs_read"
    description = "Read a file within the working directory."
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file to read."},
            "max_lines": {
                "type": "integer",
                "description": "Maximum number of lines to read (default 200).",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        path_str = params.get("path", "")
        max_lines = int(params.get("max_lines", 200))

        if not path_str:
            return ToolResult(error="Missing 'path' parameter.")

        path = Path(path_str).expanduser()
        if not path.is_absolute():
            path = Path(ctx.working_dir) / path

        try:
            path = path.resolve()
        except (OSError, ValueError) as e:
            return ToolResult(error=f"Invalid path: {e}")

        if not path.exists():
            return ToolResult(error=f"File not found: {path}")
        if not path.is_file():
            return ToolResult(error=f"Not a file: {path}")

        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                lines = []
                for i, line in enumerate(f):
                    if i >= max_lines:
                        lines.append(f"\n… ({max_lines} lines, truncated)")
                        break
                    lines.append(line.rstrip("\n"))
            content = "\n".join(lines)
            return ToolResult(output={"content": content, "path": str(path), "lines": len(lines)})
        except OSError as e:
            return ToolResult(error=f"Read error: {e}")


class FsListTool:
    """List files in a directory (safe risk level)."""

    name = "fs_list"
    description = "List files in a directory."
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory to list."},
        },
        "required": ["path"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        path_str = params.get("path", "")
        if not path_str:
            return ToolResult(error="Missing 'path' parameter.")

        path = Path(path_str).expanduser()
        if not path.is_absolute():
            path = Path(ctx.working_dir) / path

        try:
            path = path.resolve()
        except (OSError, ValueError) as e:
            return ToolResult(error=f"Invalid path: {e}")

        if not path.exists():
            return ToolResult(error=f"Directory not found: {path}")
        if not path.is_dir():
            return ToolResult(error=f"Not a directory: {path}")

        try:
            entries = []
            for entry in sorted(path.iterdir()):
                entries.append({
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else None,
                })
            return ToolResult(output={"entries": entries, "path": str(path)})
        except OSError as e:
            return ToolResult(error=f"List error: {e}")