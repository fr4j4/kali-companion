"""Window tools — list and focus the user's open windows.

Both run on the user's desktop agent, which asks the user before doing anything: window
titles are private and changing focus moves the user's attention. Without an agent there is
nothing to ask, so they fail instead of guessing.
"""

from __future__ import annotations

from .base import ToolContext, ToolResult

_NO_AGENT = "No desktop agent is connected; window tools need kali-avatar running on the user's machine."


class ListWindowsTool:
    name = "list_windows"
    description = (
        "List the user's open windows (id, title, application, focused). Titles can be private, so "
        "the user is asked first. Use it to find a window before focus_window."
    )
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        return ToolResult(error=_NO_AGENT)


class FocusWindowTool:
    name = "focus_window"
    description = (
        "Bring one of the user's open windows to the front. Pass an id from list_windows. The user "
        "is asked first. Not available on every desktop (for example GNOME on Wayland)."
    )
    schema = {
        "type": "object",
        "properties": {"id": {"type": "string", "description": "Window id from list_windows."}},
        "required": ["id"],
        "additionalProperties": False,
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        return ToolResult(error=_NO_AGENT)
