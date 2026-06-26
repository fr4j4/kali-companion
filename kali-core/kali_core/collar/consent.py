"""ConsentManager — emits consent_request events, awaits responses.

When a tool needs consent, the ConsentManager issues a request with a
unique ID, sends a consent_request event to the frontend, and waits for
a consent_response with allow/deny. Auto-denies after a timeout.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

logger = logging.getLogger("kali_core.collar.consent")


class ConsentRequest:
    """A pending consent request."""

    def __init__(
        self,
        request_id: str,
        tool: str,
        reason_key: str,
        reason_params: dict,
        summary_key: str,
    ) -> None:
        self.id = request_id
        self.tool = tool
        self.reason_key = reason_key
        self.reason_params = reason_params
        self.summary_key = summary_key
        self.future: asyncio.Future[str] = asyncio.get_running_loop().create_future()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tool": self.tool,
            "reason_key": self.reason_key,
            "reason_params": self.reason_params,
            "summary_key": self.summary_key,
        }


class ConsentManager:
    """Issues consent requests and waits for the user's decision."""

    def __init__(self, send_callback=None, timeout: float = 60.0) -> None:
        self._pending: dict[str, ConsentRequest] = {}
        self._send_callback = send_callback
        self._timeout = timeout

    def set_send_callback(self, callback) -> None:
        self._send_callback = callback

    async def request(
        self,
        tool: str,
        reason_key: str,
        reason_params: dict,
        summary_key: str = "",
        risk: str = "dangerous",
    ) -> str:
        """Request consent from the user. Returns allow/no_capture/cancel."""
        request_id = f"consent_{uuid.uuid4().hex[:8]}"
        summary = summary_key or f"consent.summary.{tool}"
        req = ConsentRequest(request_id, tool, reason_key, reason_params, summary)
        self._pending[request_id] = req

        # Emit consent_request event to the frontend.
        if self._send_callback:
            payload = {
                "event": "consent_request",
                "id": request_id,
                "tool": tool,
                "risk": risk,
                "reason_key": reason_key,
                "reason_params": reason_params,
                "summary_key": summary_key or f"consent.summary.{tool}",
            }
            try:
                await self._send_callback(payload)
            except Exception:
                logger.exception("Failed to send consent_request event")

        # Wait for response with timeout.
        try:
            decision = await asyncio.wait_for(req.future, timeout=self._timeout)
            return decision
        except TimeoutError:
            logger.warning("Consent request %s timed out", request_id)
            return "cancel"
        finally:
            self._pending.pop(request_id, None)

    def respond(self, request_id: str, decision: str) -> bool:
        """Resolve a pending consent request. Returns True if found."""
        req = self._pending.get(request_id)
        if req is None:
            return False
        if not req.future.done():
            req.future.set_result(decision)
        return True

    @property
    def has_pending(self) -> bool:
        return len(self._pending) > 0