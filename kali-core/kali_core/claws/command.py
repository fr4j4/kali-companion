"""Command execution tool — run_command.

Executes shell commands via asyncio.subprocess. Risk level is dangerous
so it always requires consent. The active profile's command_whitelist
allows specific commands to run without consent.
"""

from __future__ import annotations

import asyncio

from .base import ToolContext, ToolResult


class RunCommandTool:
    name = "run_command"
    description = "Run a shell command (subject to whitelist + consent)."
    schema = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The command to run."},
            "cwd": {"type": "string", "description": "Working directory (optional)."},
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds (default 30).",
            },
        },
        "required": ["command"],
        "additionalProperties": False,
    }
    risk_level = "dangerous"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        command = params.get("command", "")
        cwd = params.get("cwd", ctx.working_dir)
        timeout = int(params.get("timeout", 30))

        if not command:
            return ToolResult(error="Missing 'command' parameter.")

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as e:
            return ToolResult(error=f"Failed to start: {e}")

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            return ToolResult(error=f"Command timed out after {timeout}s.")

        return ToolResult(
            output={
                "exit_code": proc.returncode,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
                "command": command,
                "cwd": cwd,
            }
        )