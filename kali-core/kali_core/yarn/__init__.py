"""kali-yarn — the IO protocol (the cat's yarn ball).

Defines the WebSocket event contract between kali-web and kali-core. Both
sides develop against this contract; the full event catalogue lives in
docs/PROTOCOL.md.

The `protocol` module holds `Literal` type definitions for all event
names. The `server.py` dispatch method is the actual router.
"""

from .protocol import EventType, EventTypeOut

__all__ = ["EventType", "EventTypeOut"]