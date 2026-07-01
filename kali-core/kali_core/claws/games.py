"""kali-toys — tools for game lifecycle management.

These tools allow kali-mind to start games, send actions, and manage
game sessions through the existing tool execution pipeline.
"""

from __future__ import annotations

from .base import ToolContext, ToolResult


class GameStartTool:
    """Start a new game session on the canvas."""

    name = "game_start"
    description = "Start a new game on the NeuralCanvas"
    schema = {
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "description": "Game type identifier (snake, tictactoe, trivia, ...)",
            },
            "title": {
                "type": "string",
                "description": "Display title for the game window",
            },
        },
        "required": ["type"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        game_type = params["type"]
        title = params.get("title", game_type)

        return ToolResult(
            output=f"Game started: {title} ({game_type})",
        )


class GameActionTool:
    """Forward an action to the active game."""

    name = "game_action"
    description = "Send an action to the active game (move, select, text, ...)"
    schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "object",
                "description": "Action payload to forward to the game engine",
            },
        },
        "required": ["action"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        action = params["action"]
        return ToolResult(output=f"Action forwarded: {action}")


class GameEndTool:
    """End the currently active game."""

    name = "game_end"
    description = "End the currently active game"
    schema = {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Optional reason for ending the game",
            },
        },
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        reason = params.get("reason", "user requested")
        return ToolResult(output=f"Game ended: {reason}")
