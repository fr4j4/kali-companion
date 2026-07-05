"""create_terminal_session tool — groups related shell commands under a named session.

The agent calls this before executing a sequence of related commands (e.g.
deploy, debug, build). The returned terminal_session_id is passed to
subsequent run_command calls so the terminal widget can display them
grouped.
"""

from __future__ import annotations

from .base import ToolContext, ToolResult


class CreateTerminalSessionTool:
    name = "create_terminal_session"
    description = (
        "Create a named terminal session to group related shell commands. "
        "Call this before executing multiple commands that belong to a "
        "single task (e.g. 'Deploy backend', 'Debug compile error'). "
        "Pass the returned terminal_session_id to subsequent run_command "
        "calls. For a single isolated command, skip this and call "
        "run_command directly."
    )
    schema = {
        "type": "object",
        "properties": {
            "display_name": {
                "type": "string",
                "description": (
                    "Concise descriptive name (e.g. 'Deploy backend', "
                    "'Install deps', 'Debug compile error')."
                ),
            },
        },
        "required": ["display_name"],
        "additionalProperties": False,
    }
    risk_level = "safe"  # type: ignore[assignment]

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        display_name = params.get("display_name", "").strip()
        if not display_name:
            return ToolResult(error="Missing or empty 'display_name' parameter.")
        if ctx.session_store is None:
            return ToolResult(error="Session store not configured.")
        try:
            ts = await ctx.session_store.create_terminal_session(ctx.session_id, display_name)
        except Exception as e:
            return ToolResult(error=f"Failed to create terminal session: {e}")
        return ToolResult(
            output={
                "terminal_session_id": ts["id"],
                "display_name": ts["display_name"],
                "status": ts["status"],
            }
        )