"""Where each tool runs: the server (this process) or the user's desktop (kali-avatar).

The classification is fixed here, in the core, so the model never has to guess when only one
side makes sense:

- ``server``  — Kali's own state and network: web, artifacts, games, terminal sessions, repos and
  tests the project keeps on the server. No ``target`` parameter is offered.
- ``desktop`` — things only the user's machine has: screen, windows, apps. Served by the agent.
- ``either``  — acts on "a machine": shell, files, system info. Takes ``target`` and defaults to
  the user's desktop; the server is only used when asked for explicitly.

Every result of a tool in this table carries an ``origin`` so nobody mistakes the server's RAM
for the user's PC.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from typing import Any, Literal

Where = Literal["server", "desktop", "either"]

SERVER: Where = "server"
DESKTOP: Where = "desktop"
EITHER: Where = "either"

# Tools that can run on either machine, with the desktop-agent action that serves them.
EITHER_ACTIONS: dict[str, str] = {
    "system_info": "system_info",
    "run_command": "run_command",
    "fs_read": "fs_read",
    "fs_list": "fs_list",
}

# Anything not listed here is a server tool.
TOOL_WHERE: dict[str, Where] = {
    **{name: EITHER for name in EITHER_ACTIONS},
    # Only the user's desktop has these.
    "launch_app": DESKTOP,
    "find_apps": DESKTOP,
    "list_windows": DESKTOP,
    "focus_window": DESKTOP,
    "screenshot": DESKTOP,
    "look_at_screen": DESKTOP,
    "list_monitors": DESKTOP,
    # Kali's own state, network and project repos: always the server.
    "create_terminal_session": SERVER,
    "web_search": SERVER,
    "web_fetch": SERVER,
    "run_tests": SERVER,
    "git_worktree": SERVER,
    "git_diff": SERVER,
    "organize_folder": SERVER,
    "create_artifact": SERVER,
    "list_artifacts": SERVER,
    "get_artifact": SERVER,
    "update_artifact": SERVER,
    "get_artifact_console": SERVER,
    "fetch_game_resource": SERVER,
    "dota_live_state": SERVER,
    "suggest_capture": SERVER,
    "game_start": SERVER,
    "game_action": SERVER,
    "game_end": SERVER,
    "stt_correct": SERVER,
}

TARGET_VALUES = ("desktop", "server")

# Schema fragment added to every ``either`` tool.
TARGET_SCHEMA: dict[str, Any] = {
    "type": "string",
    "enum": list(TARGET_VALUES),
    "description": (
        "Which machine runs this. OMIT IT for anything about the user's own computer (their "
        "RAM, files, programs, commands): the default is the user's desktop. Use 'server' only "
        "when the user asks about the machine that hosts Kali itself (the Kali server, its "
        "container, its logs or its data)."
    ),
}


def where_for(tool_name: str) -> Where:
    return TOOL_WHERE.get(tool_name, SERVER)


def server_host() -> str:
    """Name of the machine this core runs on (``KALI_SERVER_NAME`` overrides it)."""
    return os.environ.get("KALI_SERVER_NAME", "").strip() or socket.gethostname() or "server"


def is_loopback(host: str) -> bool:
    return host in ("127.0.0.1", "localhost", "::1")


def local_mode(bind_host: str = "127.0.0.1") -> bool:
    """True when core and desktop are the same machine (everything on one PC).

    ``KALI_DEPLOYMENT=local|remote`` decides; otherwise a core bound to loopback is local.
    """
    value = os.environ.get("KALI_DEPLOYMENT", "").strip().lower()
    if value in ("local", "remote"):
        return value == "local"
    return is_loopback(bind_host)


@dataclass(frozen=True)
class Route:
    """Where one call will run, and how to name that machine in the answer."""

    where: Literal["server", "desktop"]
    host: str
    via_agent: bool = False
    # Core and desktop are the same machine (no agent involved).
    local: bool = False
    error: str | None = None

    @property
    def label(self) -> str:
        if self.where == "server":
            return "[server]"
        return f"[{self.host}]" if not self.local else f"[{self.host} · local]"

    def origin(self) -> dict[str, Any]:
        return {"where": self.where, "host": self.host, "label": self.label}


def explicit_target(params: dict) -> str | None:
    value = params.get("target")
    if isinstance(value, str) and value.strip().lower() in TARGET_VALUES:
        return value.strip().lower()
    return None


def resolve(
    tool_name: str,
    params: dict,
    broker: Any,
    session_id: str,
    *,
    is_local: bool,
) -> Route | None:
    """Pick the machine for an ``either`` tool. ``None`` for tools outside the table's ``either`` set."""
    if where_for(tool_name) != EITHER:
        return None
    raw = params.get("target")
    if raw not in (None, "") and explicit_target(params) is None:
        return Route(
            "desktop", "", error=f"Invalid target {raw!r}: use 'desktop' (default, the user's PC) or 'server'."
        )
    target = explicit_target(params) or "desktop"
    host = server_host()
    if target == "server":
        return Route("server", host)

    action = EITHER_ACTIONS[tool_name]
    agent = broker.find(session_id, action) if broker is not None else None
    if agent is not None:
        return Route("desktop", broker.host_of(agent), via_agent=True)
    if is_local:
        # One machine: this process is the user's desktop. The label still says so.
        return Route("desktop", host, local=True)
    connected = broker.find(session_id) if broker is not None else None
    if connected is not None:
        why = (
            f"The connected desktop agent ({broker.host_of(connected)}) does not support '{action}'. "
            "Update kali-avatar on the user's PC."
        )
    else:
        why = "No desktop agent (kali-avatar) is connected, so I cannot reach the user's PC."
    return Route(
        "desktop",
        "",
        error=(
            f"{why} Tell the user. Do NOT retry with target='server' unless they asked about the "
            "Kali server itself: that would answer about a different machine."
        ),
    )


def stamp(output: Any, route: Route) -> Any:
    """Add the origin to a result so every answer says which machine it came from."""
    origin = route.origin()
    if isinstance(output, dict):
        return {"origin": origin["label"], "machine": origin, **{k: v for k, v in output.items() if k not in ("origin", "machine")}}
    return {"origin": origin["label"], "machine": origin, "result": output}



def intent_of(tool_name: str | None, args: dict | None) -> str:
    """``"tool:where"`` for a proposed call (``"none"`` without one): what the eval compares."""
    if not tool_name:
        return "none"
    where = where_for(tool_name)
    if where == EITHER:
        where = explicit_target(args or {}) or "desktop"
    return f"{tool_name}:{where}"
