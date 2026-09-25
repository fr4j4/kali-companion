"""Task-scoped desktop capabilities over an authenticated frontend WebSocket."""

from __future__ import annotations

import asyncio
import base64
import contextvars
import uuid
from typing import Any


class DesktopBroker:
    def __init__(self) -> None:
        self._current: contextvars.ContextVar[Any] = contextvars.ContextVar("desktop_connection", default=None)
        self._pending: dict[str, tuple[Any, asyncio.Future[dict[str, Any]]]] = {}

    def activate(self, connection: Any) -> contextvars.Token:
        return self._current.set(connection)

    def reset(self, token: contextvars.Token) -> None:
        self._current.reset(token)

    def current(self) -> Any:
        return self._current.get()

    def has_desktop(self, session_id: str) -> bool:
        conn = self.current()
        return bool(conn and conn.is_desktop and conn.session_id == session_id)

    async def request(self, session_id: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
        conn = self.current()
        if not conn or not conn.is_desktop or conn.session_id != session_id:
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
