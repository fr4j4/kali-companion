"""Bearer-token middleware + WS auth challenge for Kali Core.

When KALI_API_TOKEN is set (non-empty), every HTTP request must carry
``Authorization: Bearer <token>`` (or ``X-API-Token`` header), and every
WebSocket connection must send ``{"event": "auth", "token": "<token>"}``
as its FIRST message or receive an ``auth_required`` error and be closed.
The health endpoint stays open (liveness probes). An empty/unset token
means no auth (local dev default).
"""

from __future__ import annotations

import hmac
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from fastapi import FastAPI

WS_AUTH_EVENT = "auth"


def _constant_time_equal(token: str, expected: str) -> bool:
    return hmac.compare_digest(token.encode(), expected.encode())


def extract_bearer_token(headers: Any) -> str:
    auth = headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (headers.get("x-api-token") or "").strip()


def install_auth(app: "FastAPI", token: str, open_paths: set[str]) -> None:
    """Attach HTTP middleware. No-op when token is empty."""
    if not token:
        return

    @app.middleware("http")
    async def _auth_middleware(request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path in open_paths:
            return await call_next(request)
        supplied = extract_bearer_token(request.headers)
        if not supplied or not _constant_time_equal(supplied, token):
            from fastapi.responses import JSONResponse

            return JSONResponse(
                {"error": "authentication required"},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
        return await call_next(request)


def ws_token_ok(supplied: object, expected: str) -> bool:
    if expected == "":
        return True
    return isinstance(supplied, str) and _constant_time_equal(supplied.strip(), expected)