"""kali-nest — session persistence and memory (the cat's nest).

Stores sessions and messages in SQLite so conversations survive restarts.
The `SessionStore` handles CRUD; `Memory` provides working + long-term
memory for the agent loop.
"""

from .store import SessionStore

__all__ = ["SessionStore"]