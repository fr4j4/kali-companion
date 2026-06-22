"""kali-gaze client — asks kali-home to capture the screen.

Connects to kali-home's IPC WebSocket server to send system_command
messages and receive system_result responses.

The IPC port is read from the environment variable KALI_HOME_IPC_PORT
(default 8901).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os

import websockets

logger = logging.getLogger("kali_core.gaze")


class GazeClient:
    """Thin WS client that forwards capture requests to kali-home."""

    def __init__(self, port: int | None = None, timeout: float = 10.0) -> None:
        self._port = port or int(os.getenv("KALI_HOME_IPC_PORT", "8901"))
        self._timeout = timeout
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Connect to kali-home's IPC WS server."""
        async with self._lock:
            if self._ws is not None:
                return
            uri = f"ws://127.0.0.1:{self._port}"
            try:
                self._ws = await asyncio.wait_for(
                    websockets.connect(uri, ping_interval=None, max_size=10 * 1024 * 1024),
                    timeout=self._timeout,
                )
                logger.info("GazeClient connected to %s", uri)
            except (TimeoutError, OSError, websockets.WebSocketException) as e:
                self._ws = None
                logger.warning("GazeClient could not connect to %s: %s", uri, e)

    async def disconnect(self) -> None:
        async with self._lock:
            if self._ws is not None:
                await self._ws.close()
                self._ws = None

    @property
    def connected(self) -> bool:
        return self._ws is not None

    async def list_monitors(self) -> list[dict]:
        """Enumerate available monitors (Hyprland). Returns a list of
        dicts with keys: id, name, description, width, height, x, y,
        active, focused, refresh_rate, transform."""
        result = await self._send_command("list_monitors")
        if "error" in result:
            raise RuntimeError(result["error"])
        monitors = result.get("monitors")
        if isinstance(monitors, str):
            monitors = json.loads(monitors)
        return monitors or []

    async def capture_full(self, output: str | None = None) -> bytes:
        """Capture the screen. Returns PNG bytes.

        If `output` is given, captures that specific monitor (by name
        or alias like "primary"/"secondary"); otherwise captures the
        whole composition.
        """
        payload: dict = {"command": "capture_full"}
        if output is not None:
            payload["output"] = output
        result = await self._send_command_raw(payload)
        if "error" in result:
            raise RuntimeError(result["error"])
        data = result["data"]
        import base64
        return base64.b64decode(data)

    async def _send_command(self, command: str) -> dict:
        """Send a system_command and await the result."""
        return await self._send_command_raw({"command": command})

    async def _send_command_raw(self, payload: dict) -> dict:
        """Send a raw command payload and await the result.

        Handles half-open sockets: if the send/recv fails, resets the
        connection and retries once.
        """
        for attempt in (0, 1):
            await self.connect()
            if self._ws is None:
                raise ConnectionError(
                    "GazeClient not connected to kali-home IPC. "
                    "Is kali-home running?"
                )
            try:
                async with self._lock:
                    await self._ws.send(json.dumps(payload))
                    response = await asyncio.wait_for(
                        self._ws.recv(), timeout=self._timeout
                    )
                if isinstance(response, bytes):
                    response = response.decode()
                data: dict = json.loads(response)
                return data.get("result", data)
            except (
                TimeoutError,
                OSError,
                websockets.WebSocketException,
                websockets.ConnectionClosed,
            ) as e:
                # Half-open / dropped socket: reset and retry once.
                async with self._lock:
                    if self._ws is not None:
                        with contextlib.suppress(Exception):
                            await self._ws.close()
                    self._ws = None
                logger.warning(
                    "GazeClient IPC error (attempt %d): %s", attempt + 1, e
                )
                if attempt == 1:
                    raise ConnectionError(
                        f"GazeClient IPC lost connection to kali-home: {e}"
                    ) from e
        # Unreachable, but keeps the type checker happy.
        raise ConnectionError("GazeClient failed to send command")