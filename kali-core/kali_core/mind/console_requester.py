"""Console log requester — correlated request/response over WS.

The agent calls ``get_artifact_console``, which emits a ``console_request``
WS event to the frontend and awaits a ``console_response``. The frontend
reads the current console logs from the open HtmlWidget (if any) and sends
them back. No logs are buffered or persisted on the backend side — the
frontend is the single source of truth for runtime console output.

This is the same correlation pattern as ``ConsentManager``
(``collar/consent.py``): a dict of ``asyncio.Future`` keyed by request id,
with a timeout to prevent hanging.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

logger = logging.getLogger("kali_core.mind.console_requester")

_CONSOLE_TIMEOUT = 5.0


class ConsoleRequester:
    """Manages one-shot requests for artifact console logs.

    Usage::

        requester = ConsoleRequester()
        logs = await requester.request(emit, session_id, artifact_id, limit=200)
        # logs is a list of {level, message, timestamp} or None on timeout/closed
    """

    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Future[Any]] = {}

    async def request(
        self,
        emit: Any,
        session_id: str,
        artifact_id: str,
        limit: int = 200,
    ) -> list[dict[str, Any]] | None:
        """Emit a ``console_request`` event and wait for the frontend response.

        Returns the logs list, or ``None`` if the frontend didn't respond
        (timeout, artifact closed, or no matching widget open).
        """
        request_id = f"console_{uuid.uuid4().hex[:8]}"
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future

        try:
            await emit({
                "event": "console_request",
                "id": request_id,
                "artifact_id": artifact_id,
                "limit": limit,
            })
            logs = await asyncio.wait_for(future, timeout=_CONSOLE_TIMEOUT)
            return logs
        except TimeoutError:
            logger.warning(
                "console_request timeout: id=%s artifact=%s session=%s",
                request_id, artifact_id, session_id[:8],
            )
            return None
        finally:
            self._pending.pop(request_id, None)

    def respond(self, request_id: str, logs: Any) -> None:
        """Resolve a pending request with the frontend's response."""
        future = self._pending.get(request_id)
        if future is None or future.done():
            return
        future.set_result(logs)

    def cleanup_session(self, _session_id: str) -> None:
        """Cancel all pending futures (called on session change)."""
        for _request_id, future in list(self._pending.items()):
            if not future.done():
                future.set_result(None)
        self._pending.clear()
