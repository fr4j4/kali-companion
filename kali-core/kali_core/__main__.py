"""kali-core CLI entrypoint.

Parses config, starts the WebSocket server, and waits for the frontend to
connect. Called by kali-home as a sidecar (`python -m kali_core`) or
standalone during development.

When running under Tauri, kali-home passes the WS port via `KALI_WS_PORT`.
When running standalone (e.g. for dev against a plain browser), the port
falls back to the one in config (default 8900).
"""

from __future__ import annotations

import asyncio
import logging
import os

from .config import settings
from .server import Server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("kali_core")


def main() -> None:
    port = int(os.environ.get("KALI_WS_PORT", settings.port))
    host = os.environ.get("KALI_HOST", settings.host)
    logger.info("kali-core starting on %s:%d", host, port)
    server = Server(host=host, port=port)
    asyncio.run(server.run())


if __name__ == "__main__":
    main()