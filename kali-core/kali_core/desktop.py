"""Task-scoped desktop capabilities over an authenticated frontend WebSocket."""

from __future__ import annotations

import asyncio
import base64
import contextvars
import uuid
from typing import Any


# Actions every desktop agent is assumed to support when it registers without
# an explicit capability list (clients that predate capability negotiation).
LEGACY_CAPABILITIES = frozenset({"launch_app", "list_monitors", "screenshot"})


class DesktopBroker:
    def __init__(self) -> None:
        self._current: contextvars.ContextVar[Any] = contextvars.ContextVar("desktop_connection", default=None)
        self._pending: dict[str, tuple[Any, asyncio.Future[dict[str, Any]]]] = {}
        # Registered desktop agents, independent of which connection runs a turn.
        self._agents: list[Any] = []

    def register(self, connection: Any) -> None:
        if connection not in self._agents:
            self._agents.append(connection)

    def unregister(self, connection: Any) -> None:
        if connection in self._agents:
            self._agents.remove(connection)

    def activate(self, connection: Any) -> contextvars.Token:
        return self._current.set(connection)

    def reset(self, token: contextvars.Token) -> None:
        self._current.reset(token)

    def current(self) -> Any:
        return self._current.get()

    @staticmethod
    def _supports(conn: Any, action: str | None) -> bool:
        if action is None:
            return True
        caps = getattr(conn, "desktop_capabilities", None)
        return action in (caps if caps is not None else LEGACY_CAPABILITIES)

    def find(self, session_id: str, action: str | None = None) -> Any:
        """Pick the desktop agent that should serve ``action`` for a session.

        The connection that started the turn wins; otherwise any registered
        agent bound to that session, or one that follows every session (a
        presence-mode agent that never attached to a specific one).
        """
        conn = self.current()
        if conn and conn.is_desktop and conn.session_id == session_id and self._supports(conn, action):
            return conn
        for agent in self._agents:
            if agent.is_desktop and agent.session_id in (None, "", session_id) and self._supports(agent, action):
                return agent
        return None

    def has_desktop(self, session_id: str, action: str | None = None) -> bool:
        return self.find(session_id, action) is not None

    async def request(self, session_id: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
        conn = self.find(session_id, action)
        if conn is None:
            raise RuntimeError("desktop client unavailable")
        request_id = f"desktop_{uuid.uuid4().hex[:12]}"
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (conn, future)
        try:
            await conn.send({"event": "desktop_action", "id": request_id, "action": action, "params": params})
            result = await asyncio.wait_for(future, timeout=30)
            if not result.get("ok"):
                raise RuntimeError(str(result.get("error", "desktop action failed")))
            return result.get("result") or {}
        finally:
            self._pending.pop(request_id, None)

    def respond(self, conn: Any, event: dict[str, Any]) -> None:
        entry = self._pending.get(str(event.get("id", "")))
        if entry and entry[0] is conn and not entry[1].done():
            entry[1].set_result(event)

    def disconnect(self, conn: Any) -> None:
        self.unregister(conn)
        for owner, future in self._pending.values():
            if owner is conn and not future.done():
                future.set_exception(RuntimeError("desktop client disconnected"))


class RemoteGazeClient:
    def __init__(self, broker: DesktopBroker, session_id: str) -> None:
        self.broker = broker
        self.session_id = session_id

    async def list_monitors(self) -> list[dict[str, Any]]:
        result = await self.broker.request(self.session_id, "list_monitors", {})
        return result.get("monitors", [])

    async def capture_full(self, output: str | None = None) -> bytes:
        result = await self.broker.request(self.session_id, "screenshot", {"output": output})
        return base64.b64decode(result["png_base64"], validate=True)
