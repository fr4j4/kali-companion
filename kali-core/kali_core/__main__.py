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
import sys

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
    reload = os.environ.get("KALI_DEV_RELOAD") == "1"

    logger.info("kali-core starting on %s:%d (reload=%s)", host, port, reload)

    if reload:
        import uvicorn
        # When passing the string "module:factory", uvicorn enables reload mode.
        # We also pass reload_dirs to ensure it watches the core package.
        uvicorn.run(
            "kali_core.server:create_app",
            host=host,
            port=port,
            factory=True,
            reload=True,
            reload_dirs=[os.path.dirname(__file__)],
            log_level="info",
            ws_max_size=50 * 1024 * 1024,
        )
    else:
        try:
            server = Server(host=host, port=port)
        except Exception as e:
            logger.error("kali-core failed to start: %s", e)
            sys.exit(1)
        asyncio.run(server.run())


if __name__ == "__main__":
    main()