"""kali-gaze — screen capture (now local via mss, no IPC).

GazeClient is the public interface used by claws/screenshot.py and
claws/list_monitors.py. It now delegates to LocalCapture (mss-based)
instead of connecting to kali-home's IPC WebSocket on :8901. This removes
the inter-process hop and makes capture work without a Rust/JS shell.

The public methods (list_monitors, capture_full) and the `connected`
property are preserved so callers don't change.
"""

from __future__ import annotations

import logging

from .local import LocalCapture

logger = logging.getLogger("kali_core.gaze")


class GazeClient:
    """Screen capture client backed by LocalCapture (mss).

    The `connected` property is kept for backward compatibility with
    server.py's status reporting — it now reports whether mss is
    available, not whether an IPC socket is open.
    """

    def __init__(self, **_kwargs: object) -> None:
        # Ignore legacy kwargs (port, timeout) — no IPC anymore.
        self._capture = LocalCapture()

    @property
    def connected(self) -> bool:
        """True if the local capture backend (mss) is available."""
        return self._capture.available

    async def connect(self) -> None:
        """No-op: local capture needs no connection."""
        return

    async def disconnect(self) -> None:
        """No-op: local capture needs no disconnection."""
        return

    async def list_monitors(self) -> list[dict]:
        """Enumerate available monitors.

        Returns a list of dicts with keys: id, name, description, width,
        height, x, y, primary, active, focused, refresh_rate, transform.
        """
        return await self._capture.list_monitors()

    async def capture_full(self, output: str | None = None) -> bytes:
        """Capture the screen. Returns PNG bytes.

        If `output` is given, captures that specific monitor (by name
        or alias like "primary"/"secondary"); otherwise captures the
        whole composition.
        """
        return await self._capture.capture_full(output)