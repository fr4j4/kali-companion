"""OrganizeFolderTool — organizes files in a directory by type.

Moves files into subfolders (Images/, Documents/, Code/, Archives/,
Audio/, Video/, Other/) based on their extension. Supports a dry_run
mode that reports what would be moved without actually moving anything.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from .base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.organize")

# Extension → folder name mapping.
EXT_MAP: dict[str, str] = {
    # Images
    ".jpg": "Images", ".jpeg": "Images", ".png": "Images",
    ".gif": "Images", ".bmp": "Images", ".svg": "Images",
    ".webp": "Images", ".ico": "Images", ".tiff": "Images",
    # Documents
    ".pdf": "Documents", ".doc": "Documents", ".docx": "Documents",
    ".xls": "Documents", ".xlsx": "Documents", ".ppt": "Documents",
    ".pptx": "Documents", ".txt": "Documents", ".md": "Documents",
    ".csv": "Documents", ".json": "Documents", ".xml": "Documents",
    ".yaml": "Documents", ".yml": "Documents",
    # Code
    ".py": "Code", ".js": "Code", ".ts": "Code", ".tsx": "Code",
    ".jsx": "Code", ".rs": "Code", ".go": "Code", ".java": "Code",
    ".c": "Code", ".cpp": "Code", ".h": "Code", ".hpp": "Code",
    ".css": "Code", ".scss": "Code", ".html": "Code", ".toml": "Code",
    # Archives
    ".zip": "Archives", ".tar": "Archives", ".gz": "Archives",
    ".bz2": "Archives", ".xz": "Archives", ".7z": "Archives",
    ".rar": "Archives",
    # Audio
    ".mp3": "Audio", ".wav": "Audio", ".flac": "Audio", ".ogg": "Audio",
    ".m4a": "Audio", ".aac": "Audio",
    # Video
    ".mp4": "Video", ".mkv": "Video", ".avi": "Video", ".mov": "Video",
    ".webm": "Video",
}


class OrganizeFolderTool:
    name = "organize_folder"
    description = "Organize files in a folder into subfolders by type."
    schema = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the folder to organize",
            },
            "action": {
                "type": "string",
                "enum": ["organize", "dry_run"],
                "description": "organize (moves files) or dry_run (just reports)",
            },
        },
        "required": ["path"],
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        folder = Path(params["path"])
        if not folder.exists():
            return ToolResult(error=f"Folder does not exist: {folder}")
        if not folder.is_dir():
            return ToolResult(error=f"Not a directory: {folder}")

        dry_run = params.get("action", "organize") == "dry_run"
        files = [f for f in folder.iterdir() if f.is_file() and not f.name.startswith(".")]
        summary: dict[str, list[str]] = {
            "Images": [], "Documents": [], "Code": [],
            "Archives": [], "Audio": [], "Video": [], "Other": [],
        }

        for f in sorted(files):
            target_dir = EXT_MAP.get(f.suffix.lower(), "Other")
            summary.setdefault(target_dir, []).append(f.name)

        if dry_run:
            return ToolResult(
                output={
                    "action": "dry_run",
                    "path": str(folder),
                    "summary": {k: v for k, v in summary.items() if v},
                    "total_files": len(files),
                }
            )

        moved = 0
        errors: list[str] = []
        for f in files:
            target_dir = EXT_MAP.get(f.suffix.lower(), "Other")
            dest = folder / target_dir / f.name
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dest))
                moved += 1
            except OSError as e:
                errors.append(f"{f.name}: {e}")

        return ToolResult(
            output={
                "action": "organize",
                "path": str(folder),
                "summary": {k: v for k, v in summary.items() if v},
                "total_files": len(files),
                "moved": moved,
                "errors": errors or None,
            }
        )
