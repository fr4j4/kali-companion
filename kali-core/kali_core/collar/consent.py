"""ConsentManager — emits consent_request events, awaits responses.

When a tool needs consent, the ConsentManager issues a request with a
unique ID, sends a consent_request event to the frontend, and waits for
a consent_response with allow/deny. Auto-denies after a timeout.

Session-scoped grants:
- `allow` executes the tool once.
- `allow_session` executes the tool and remembers the grant for the
  current chat session, so future matching tool calls skip the modal.
- `deny` cancels the execution.

Grants live only in memory and are scoped to a chat session; a new
session starts with an empty grant set.
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
        session_id: str,
        tool: str,
        reason_key: str,
        reason_params: dict,
        summary_key: str,
    ) -> None:
        self.id = request_id
        self.session_id = session_id
        self.tool = tool
        self.reason_key = reason_key
        self.reason_params = reason_params
        self.summary_key = summary_key
        self.future: asyncio.Future[str] = asyncio.get_running_loop().create_future()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "tool": self.tool,
            "reason_key": self.reason_key,
            "reason_params": self.reason_params,
            "summary_key": self.summary_key,
        }


class ConsentManager:
    """Issues consent requests and waits for the user's decision.

    Keeps per-session grants in memory. A grant is keyed by a normalized
    permission key produced by the caller (typically PermissionGateway).
    """

    def __init__(self, send_callback=None, timeout: float = 60.0) -> None:
        self._pending: dict[str, ConsentRequest] = {}
        self._session_grants: dict[str, set[str]] = {}
        self._send_callback = send_callback
        self._timeout = timeout

    def set_send_callback(self, callback) -> None:
        self._send_callback = callback

    def grant(self, session_id: str, permission_key: str) -> None:
        """Record a session-scoped grant."""
        self._session_grants.setdefault(session_id, set()).add(permission_key)

    def revoke(self, session_id: str, permission_key: str) -> None:
        """Remove a session-scoped grant."""
        self._session_grants.get(session_id, set()).discard(permission_key)

    def is_granted(self, session_id: str, permission_key: str) -> bool:
        """Return True if the given permission has been granted this session."""
        return permission_key in self._session_grants.get(session_id, set())

    def clear_session(self, session_id: str) -> None:
        """Drop all grants for a chat session (e.g. on session end)."""
        self._session_grants.pop(session_id, None)

    async def request(
        self,
        session_id: str,
        tool: str,
        reason_key: str,
        reason_params: dict,
        summary_key: str = "",
        risk: str = "dangerous",
    ) -> str:
        """Request consent from the user. Returns allow/allow_session/deny."""
        request_id = f"consent_{uuid.uuid4().hex[:8]}"
        summary = summary_key or f"consent.summary.{tool}"
        req = ConsentRequest(request_id, session_id, tool, reason_key, reason_params, summary)
        self._pending[request_id] = req

        # Emit consent_request event to the frontend.
        if self._send_callback:
            payload = {
                "event": "consent_request",
                "id": request_id,
                "session_id": session_id,
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
            return "deny"
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

    def session_grant_count(self, session_id: str) -> int:
        """Diagnostic helper: number of active grants for a session."""
        return len(self._session_grants.get(session_id, set()))
