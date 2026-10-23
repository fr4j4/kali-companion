"""Command execution tool — run_command.

Executes shell commands via asyncio.subprocess with line-by-line streaming
of stdout/stderr. Emits command_start, command_output, and command_end
events via ctx.emit so the frontend terminal widget can display output in
real time. Persists command + output to the session store when available.

Risk level is dangerous so it always requires consent (unless the command
matches the active profile's whitelist).
"""

from __future__ import annotations

import asyncio
import logging

from .base import ToolContext, ToolResult
from ..targets import TARGET_SCHEMA

logger = logging.getLogger("kali_core.claws.command")

_MAX_PERSIST_LINES = 1000
_HEAD_LINES = 200
_TAIL_LINES = 200


class RunCommandTool:
    name = "run_command"
    description = (
        "Run a shell command. By default it runs on the USER'S PC and they approve every command "
        "on a card; pass target='server' only for the machine that hosts Kali (the server "
        "keeps its whitelist + consent rules). The result says which machine ran it in `origin`. "
        "Optionally pass terminal_session_id to group this command under "
        "a named terminal session created with create_terminal_session."
    )
    schema = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The command to run."},
            "cwd": {"type": "string", "description": "Working directory (optional)."},
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds (default 30).",
            },
            "target": TARGET_SCHEMA,
            "terminal_session_id": {
                "type": "string",
                "description": (
                    "ID from create_terminal_session to group this command. "
                    "If omitted, commands are grouped in a shared 'Session' "
                    "session. Always pass this when running 2+ commands."
                ),
            },
        },
        "required": ["command"],
        "additionalProperties": False,
    }
    risk_level = "dangerous"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        command = params.get("command", "")
        on_desktop = ctx.route is not None and ctx.route.via_agent and ctx.desktop_exec is not None
        # The server's working directory means nothing on the user's PC: the agent picks their home.
        cwd = params.get("cwd") or (None if on_desktop else ctx.working_dir)
        timeout = int(params.get("timeout", 30))
        terminal_session_id = params.get("terminal_session_id")

        if not command:
            return ToolResult(error="Missing 'command' parameter.")

        store = ctx.session_store
        if store is not None and not terminal_session_id:
            try:
                ts = await store.get_or_create_active_untitled_session(ctx.session_id)
                terminal_session_id = ts["id"]
            except Exception:
                logger.warning("Failed to get/create terminal session", exc_info=True)

        call_id = ctx.call_id or f"cmd_{id(self)}"

        if on_desktop:
            return await self._run_on_desktop(ctx, store, terminal_session_id, call_id, command, cwd, timeout)

        if ctx.emit:
            await ctx.emit({
                "event": "command_start",
                "session_id": ctx.session_id,
                "terminal_session_id": terminal_session_id,
                "call_id": call_id,
                "command": command,
                "cwd": cwd,
            })

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as e:
            if ctx.emit:
                await ctx.emit({
                    "event": "command_end",
                    "session_id": ctx.session_id,
                    "call_id": call_id,
                    "exit_code": -1,
                    "status": "error",
                })
            return ToolResult(error=f"Failed to start: {e}")

        stdout_lines: list[tuple[str, str]] = []
        stderr_lines: list[tuple[str, str]] = []

        async def read_stream(
            stream: asyncio.StreamReader,
            stream_name: str,
            buffer: list[tuple[str, str]],
        ) -> None:
            while True:
                raw = await stream.readline()
                if not raw:
                    break
                text = raw.decode("utf-8", errors="replace").rstrip("\n\r")
                buffer.append((stream_name, text))
                if ctx.emit:
                    await ctx.emit({
                        "event": "command_output",
                        "session_id": ctx.session_id,
                        "call_id": call_id,
                        "stream": stream_name,
                        "line": text,
                    })

        try:
            await asyncio.wait_for(
                asyncio.gather(
                    read_stream(proc.stdout, "stdout", stdout_lines),
                    read_stream(proc.stderr, "stderr", stderr_lines),
                ),
                timeout=timeout,
            )
        except TimeoutError:
            proc.kill()
            await proc.wait()
            if ctx.emit:
                await ctx.emit({
                    "event": "command_end",
                    "session_id": ctx.session_id,
                    "call_id": call_id,
                    "exit_code": -1,
                    "status": "timeout",
                })
            await self._persist(store, terminal_session_id, call_id, command, cwd,
                                stdout_lines, stderr_lines, -1, "timeout")
            return ToolResult(error=f"Command timed out after {timeout}s.")
        except asyncio.CancelledError:
            proc.kill()
            await proc.wait()
            if ctx.emit:
                await ctx.emit({
                    "event": "command_end",
                    "session_id": ctx.session_id,
                    "call_id": call_id,
                    "exit_code": -1,
                    "status": "cancelled",
                })
            await self._persist(store, terminal_session_id, call_id, command, cwd,
                                stdout_lines, stderr_lines, -1, "cancelled")
            raise

        exit_code = await proc.wait()
        status = "done" if exit_code == 0 else "error"

        if ctx.emit:
            await ctx.emit({
                "event": "command_end",
                "session_id": ctx.session_id,
                "call_id": call_id,
                "exit_code": exit_code,
                "status": status,
            })

        await self._persist(
            store, terminal_session_id, call_id, command, cwd,
            stdout_lines, stderr_lines, exit_code, status,
        )

        return ToolResult(
            output={
                "exit_code": exit_code,
                "stdout": "\n".join(text for _, text in stdout_lines),
                "stderr": "\n".join(text for _, text in stderr_lines),
                "command": command,
                "cwd": cwd,
                "terminal_session_id": terminal_session_id,
            }
        )

    async def _run_on_desktop(
        self, ctx: ToolContext, store, terminal_session_id: str | None, call_id: str,
        command: str, cwd: str | None, timeout: int,
    ) -> ToolResult:
        """Run on the user's PC through the desktop agent, which asks the user first."""
        host = ctx.route.label
        if ctx.emit:
            await ctx.emit({
                "event": "command_start", "session_id": ctx.session_id,
                "terminal_session_id": terminal_session_id, "call_id": call_id,
                "command": command, "cwd": cwd or "~", "host": host,
            })

        async def end(status: str, exit_code: int = -1) -> None:
            if ctx.emit:
                await ctx.emit({
                    "event": "command_end", "session_id": ctx.session_id, "call_id": call_id,
                    "exit_code": exit_code, "status": status, "host": host,
                })

        params: dict = {"command": command, "timeout": timeout}
        if cwd:
            params["cwd"] = cwd
        try:
            result = await ctx.desktop_exec("run_command", params, timeout=timeout + 100)
        except asyncio.CancelledError:
            await end("cancelled")
            raise
        except TimeoutError:
            await end("timeout")
            return ToolResult(error=f"No answer from the desktop agent for the command (waited {timeout + 100}s).")
        except RuntimeError as e:
            await end("error")
            return ToolResult(error=str(e))

        stdout = str(result.get("stdout", ""))
        stderr = str(result.get("stderr", ""))
        exit_code = int(result.get("exit_code", -1))
        stdout_lines = [("stdout", t) for t in stdout.splitlines()]
        stderr_lines = [("stderr", t) for t in stderr.splitlines()]
        if ctx.emit:
            for stream, text in stdout_lines + stderr_lines:
                await ctx.emit({
                    "event": "command_output", "session_id": ctx.session_id,
                    "call_id": call_id, "stream": stream, "line": text,
                })
        status = "done" if exit_code == 0 else "error"
        await end(status, exit_code)
        resolved_cwd = str(result.get("cwd") or cwd or "~")
        await self._persist(store, terminal_session_id, call_id, command, resolved_cwd,
                            stdout_lines, stderr_lines, exit_code, status)
        return ToolResult(output={
            "exit_code": exit_code, "stdout": stdout, "stderr": stderr, "command": command,
            "cwd": resolved_cwd, "terminal_session_id": terminal_session_id,
            **({"truncated": True} if result.get("truncated") else {}),
        })

    async def _persist(
        self,
        store,
        terminal_session_id: str | None,
        call_id: str,
        command: str,
        cwd: str,
        stdout_lines: list[tuple[str, str]],
        stderr_lines: list[tuple[str, str]],
        exit_code: int,
        status: str,
    ) -> None:
        """Persist command + output to SQLite. Truncates if too many lines."""
        if store is None or terminal_session_id is None:
            return
        try:
            await store.add_terminal_command(terminal_session_id, call_id, command, cwd)
            all_lines: list[tuple[str, str]] = stdout_lines + stderr_lines
            seq = 0
            batch: list[tuple[str, str, int]] = []
            if len(all_lines) <= _MAX_PERSIST_LINES:
                for stream, text in all_lines:
                    batch.append((stream, text, seq))
                    seq += 1
            else:
                for stream, text in all_lines[:_HEAD_LINES]:
                    batch.append((stream, text, seq))
                    seq += 1
                skipped = len(all_lines) - _HEAD_LINES - _TAIL_LINES
                batch.append(("stdout", f"[... truncated {skipped} lines ...]", seq))
                seq += 1
                for stream, text in all_lines[-_TAIL_LINES:]:
                    batch.append((stream, text, seq))
                    seq += 1
            await store.batch_add_terminal_output(call_id, batch)
            await store.update_terminal_command(call_id, exit_code, status)
        except Exception:
            logger.warning("Failed to persist terminal command", exc_info=True)