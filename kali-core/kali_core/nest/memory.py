"""Working and long-term memory for the agent.

Phase 2 implementation: persists recent messages to the SessionStore
(SQLite) and maintains a compact summary of past conversations so the
agent has context across sessions.

Two layers:
  - `recent`: a sliding window of recent messages (in-memory).
  - `summaries`: compact one-line summaries of past conversation chunks,
    persisted to the sessions table via the SessionStore.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("kali_core.nest.memory")


class Memory:
    """Holds recent messages + long-term summaries."""

    def __init__(self, max_recent: int = 50) -> None:
        self.max_recent = max_recent
        self.recent: list[dict] = []
        self.summaries: list[str] = []

    def add(self, message: dict) -> None:
        """Add a message to the recent window."""
        self.recent.append(message)
        if len(self.recent) > self.max_recent:
            # When the window overflows, summarize the oldest messages
            # and move them to long-term memory.
            overflow = self.recent[: self.max_recent // 2]
            self.recent = self.recent[self.max_recent // 2 :]
            summary = self._summarize_chunk(overflow)
            if summary:
                self.summaries.append(summary)

    def add_summary(self, summary: str) -> None:
        """Add a pre-computed summary to long-term memory."""
        if summary:
            self.summaries.append(summary)

    def context_messages(self) -> list[dict]:
        """Return messages to inject into the LLM context.

        Includes past summaries (as a system message) + recent messages.
        """
        msgs: list[dict] = []
        if self.summaries:
            summary_text = "Previous conversation summaries:\n" + "\n".join(
                f"- {s}" for s in self.summaries[-10:]
            )
            msgs.append({"role": "system", "content": summary_text})
        msgs.extend(self.recent)
        return msgs

    def _summarize_chunk(self, messages: list[dict]) -> str:
        """Create a compact summary of a chunk of messages.

        Simple extraction: take the first user message + last assistant
        message as a one-liner. A full LLM-based summary can be added later.
        """
        first_user = None
        last_assistant = None
        for msg in messages:
            if msg.get("role") == "user" and first_user is None:
                first_user = msg.get("content", "")[:80]
            if msg.get("role") == "assistant":
                last_assistant = msg.get("content", "")[:80]
        parts = []
        if first_user:
            parts.append(f"User asked: {first_user}")
        if last_assistant:
            parts.append(f"Assistant replied: {last_assistant}")
        return " | ".join(parts) if parts else ""

    def to_dict(self) -> dict:
        """Serialize for persistence."""
        return {
            "recent": self.recent,
            "summaries": self.summaries,
        }

    @classmethod
    def from_dict(cls, data: dict, max_recent: int = 50) -> Memory:
        """Restore from serialized data."""
        m = cls(max_recent=max_recent)
        m.recent = data.get("recent", [])
        m.summaries = data.get("summaries", [])
        return m