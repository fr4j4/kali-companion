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
            "region": {
                "type": "boolean",
                "description": (
                    "True to let the user drag a rectangle and capture only that "
                    "region (best when they say 'look at this'). Needs the desktop "
                    "agent; ignores `monitor`."
                ),
            },
            "question": {
                "type": "string",
                "description": "What you want to know from the image (the user's question).",
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
    # Kept so old conversations and profiles keep working; the model is offered look_at_screen.
    hidden = True

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
            extra = {"region": True} if params.get("region") is True else {}
            png_bytes = await gaze.capture_full(output=output, reason=str(params.get("reason") or ""), **extra)
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
                description = await vp.process(png_bytes, "image/png", str(params.get("question") or ""))
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
                # The capture is for Kali to look at; it goes to the library without popping up.
                silent=True,
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


_UNSUPPORTED = (
    "I cannot do that capture: the desktop agent on the user's computer is not connected "
    "(or does not support it). Tell the user to start kali-avatar, or ask what they see."
)


class LookAtScreenTool(ScreenshotTool):
    """What the model is offered for 'look at my screen': by intent, not by mechanism."""

    name = "look_at_screen"
    hidden = False
    description = (
        "Look at the user's screen to answer something about what is on it. The user always "
        "approves each capture on their own computer, so call it whenever seeing the screen is "
        "the way to help; do not ask permission in chat first. Call it when they say things like "
        "'mira esto', 'qué dice este error', 'qué ves', 'ayúdame con lo que tengo abierto', "
        "'is this right?', 'look at my screen', 'check this', 'qué hay en el otro monitor'. "
        "`target`: 'region' (default) lets them drag a rectangle around what matters, best for "
        "'this', an error, a dialog or a part of a window; 'screen' captures a whole monitor, best "
        "for 'my desktop', 'everything', games and layouts. `question` is what you want to know, "
        "in their words. `monitor` only when they name one. Never call list_monitors first."
    )
    schema = {
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "What you want to know about the image."},
            "target": {
                "type": "string",
                "enum": ["region", "screen"],
                "description": "region = the user selects an area (default); screen = a whole monitor.",
            },
            "monitor": {
                "type": "string",
                "description": "Only with target=screen: output name, 'primary' (default) or 'secondary'.",
            },
            "reason": {"type": "string", "description": "Short reason shown on the approval card."},
        },
    }

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        target = params.get("target") or "region"
        if target not in ("region", "screen"):
            return ToolResult(error="target must be 'region' or 'screen'")
        mapped = {
            "question": params.get("question") or "",
            "reason": params.get("reason") or params.get("question") or "",
        }
        if target == "region":
            mapped["region"] = True
        elif params.get("monitor"):
            mapped["monitor"] = params["monitor"]
        result = await super().run(mapped, ctx)
        if result.error:
            result.error = _actionable(result.error)
        else:
            from .suggest import limiter
            limiter.note_capture(ctx.session_id)
        return result


def _actionable(error: str) -> str:
    low = error.lower()
    if "desktop agent" in low or "desktop client" in low or "not available" in low or "gazeclient" in low:
        return _UNSUPPORTED
    if "region" in low and ("support" in low or "wayland" in low or "locally" in low):
        return (
            "Selecting a region is not supported on this desktop. Offer target='screen' instead "
            "(the user still approves it)."
        )
    if "cancel" in low or "denied" in low or "deneg" in low:
        return f"The user did not approve or cancelled the capture ({error}). Do not insist; ask what they see."
    return error
