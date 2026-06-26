"""Screenshot tool — capture the screen via kali-gaze.

Goes through kali-collar for consent before asking kali-home to
capture. The captured image is processed through VisionProcessor to
extract a text description for the agent, and is persisted to
`~/.local/share/kali/snapshots/` so the user can review it later.

The `monitor` parameter lets the agent target a specific output (by
name or alias "primary"/"secondary"). Use `list_monitors` first to
discover available outputs when the user has more than one monitor.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

from ..canvas.registry import widget_artifact
from ..config import settings
from .base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.screenshot")


def _safe_name(name: str) -> str:
    """Sanitize a monitor name for use in a filename."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "unknown"


def _save_snapshot(png_bytes: bytes, monitor: str | None) -> str:
    """Persist the PNG to the snapshots dir. Returns the file path."""
    snapshots_dir = Path(settings.snapshots_dir)
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = f"_{_safe_name(monitor)}" if monitor else ""
    path = snapshots_dir / f"snapshot_{stamp}{suffix}.png"
    path.write_bytes(png_bytes)
    logger.info("snapshot saved to %s", path)
    return str(path)


class ScreenshotTool:
    name = "screenshot"
    description = (
        "Take a screenshot of the screen and describe it via vision. "
        "Requires explicit user consent. The `monitor` parameter can "
        "target a specific output by name (from list_monitors) or by "
        "alias: 'primary' (default) or 'secondary'. Set `description` "
        "to false to skip the vision description. Use `sample`=true for "
        "a confirmation capture the agent takes proactively (e.g. to "
        "verify which monitor is which); the snapshot is still saved."
    )
    schema = {
        "type": "object",
        "properties": {
            "description": {
                "type": "boolean",
                "description": "Whether to describe the image via vision (default true)",
            },
            "monitor": {
                "type": "string",
                "description": (
                    "Monitor to capture: an output name (from "
                    "list_monitors), or the alias 'primary' (default) "
                    "/ 'secondary'. Omit for the whole composition."
                ),
            },
            "reason": {
                "type": "string",
                "description": (
                    "Why the capture is needed (shown to the user in "
                    "the consent modal). e.g. 'verify the game is running'."
                ),
            },
            "sample": {
                "type": "boolean",
                "description": (
                    "True if this is a sample/confirmation capture the "
                    "agent takes to verify monitor identity (default false)."
                ),
            },
        },
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        gaze = getattr(ctx, "gaze_client", None)
        if gaze is None:
            return ToolResult(error="GazeClient not available in context")

        monitor = params.get("monitor")
        # Default to primary when a monitor isn't specified and the
        # caller is doing a real (non-sample) capture; for samples the
        # caller explicitly passes the monitor name it wants to verify.
        output = monitor or None

        try:
            png_bytes = await gaze.capture_full(output=output)
        except (ConnectionError, RuntimeError) as e:
            return ToolResult(error=str(e))

        if not png_bytes:
            return ToolResult(error="capture returned empty image")

        describe = params.get("description", True)
        description = ""

        if describe:
            try:
                from kali_core.mind.vision import VisionProcessor
                vp = VisionProcessor(llm_provider=getattr(ctx, "llm_provider", None))
                description = await vp.process(png_bytes, "image/png")
            except Exception as e:
                logger.warning("Vision processor failed: %s", e)
                description = "[vision unavailable]"

        # Persist to disk so the user can review captures.
        save_path = ""
        rel_path = ""
        try:
            save_path = _save_snapshot(png_bytes, monitor)
            # Relative path under the /snapshots static mount so the
            # frontend can render it via <img src="/snapshots/...">.
            rel_path = Path(save_path).name
        except Exception as e:
            logger.warning("Failed to save snapshot: %s", e)

        # Build an image artifact so the screenshot appears inline as a
        # floating window on the canvas (not just a file path in text).
        artifact = None
        if rel_path:
            monitor_label = monitor or "primary"
            artifact = widget_artifact(
                title=f"Screenshot — {monitor_label}",
                widget_type="img",
                data={
                    "type": "img",
                    "path": f"snapshots/{rel_path}",
                    "name": f"Capture of {monitor_label}",
                    "title": f"Screenshot — {monitor_label}",
                },
                window_type="image",
            ).to_payload()

        return ToolResult(
            output={
                "captured": True,
                "size": len(png_bytes),
                "mime": "image/png",
                "monitor": monitor or "primary",
                "description": description,
                "path": save_path,
            },
            artifact=artifact,
        )