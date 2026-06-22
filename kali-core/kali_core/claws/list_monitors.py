"""List monitors tool — enumerate available screens via kali-gaze.

Goes through kali-collar for consent (sensitive: reading the monitor
layout is a privacy-relevant action). Returns a compact description of
each output so the agent can ask the user which one is
primary/secondary before capturing.
"""

from __future__ import annotations

import logging

from .base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.list_monitors")


class ListMonitorsTool:
    name = "list_monitors"
    description = (
        "List the available monitors (outputs) on the user's machine. "
        "Use this before screenshot when the user has multiple monitors "
        "so you can ask which one is primary/secondary and capture the "
        "right one. Returns each monitor's index, name, resolution and "
        "active/focused state."
    )
    schema: dict = {
        "type": "object",
        "properties": {},
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        gaze = getattr(ctx, "gaze_client", None)
        if gaze is None:
            return ToolResult(error="GazeClient not available in context")
        try:
            monitors = await gaze.list_monitors()
        except (ConnectionError, RuntimeError) as e:
            return ToolResult(error=str(e))

        if not monitors:
            return ToolResult(
                output={
                    "monitors": [],
                    "note": (
                        "No monitors reported. Either the capture backend "
                        "is unavailable (needs Hyprland + WAYLAND_DISPLAY + "
                        "HYPRLAND_INSTANCE_SIGNATURE) or no outputs are "
                        "connected."
                    ),
                }
            )

        summary = []
        for i, m in enumerate(monitors):
            name = m.get("name", f"monitor-{i}")
            # Hyprland returns `focused`, `disabled`, and optionally
            # `dpmsStatus`. `active` is NOT a real field — derive it.
            disabled = bool(m.get("disabled", False))
            dpms_on = bool(m.get("dpmsStatus", True))
            focused = bool(m.get("focused", False))
            active = dpms_on and not disabled
            summary.append(
                {
                    "index": i,
                    "name": name,
                    "description": m.get("description", ""),
                    "resolution": f"{m.get('width', '?')}x{m.get('height', '?')}",
                    "offset": f"{m.get('x', 0)},{m.get('y', 0)}",
                    "active": active,
                    "focused": focused,
                }
            )

        # Identify the likely primary (focused, else first active).
        primary = next(
            (m["name"] for m in summary if m["focused"]),
            next(
                (m["name"] for m in summary if m["active"]),
                summary[0]["name"] if summary else "",
            ),
        )

        return ToolResult(
            output={
                "monitors": summary,
                "primary_guess": primary,
                "count": len(summary),
            }
        )