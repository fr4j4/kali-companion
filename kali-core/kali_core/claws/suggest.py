"""suggest_capture — Kali offers to look at the screen, it never looks by itself.

The tool is safe because it only emits a ``suggestion`` event; the chips the user sees are drawn by
the frontend (and the desktop agent), and clicking one starts the normal flow, including the
agent's own consent card. The limits live here, in the server, so the model cannot talk past them:
at most one suggestion per few user turns, a cap per conversation, silence after declines.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from .base import ToolContext, ToolResult

MIN_TURNS_BETWEEN = 5
MAX_PER_SESSION = 3
SILENCE_AFTER_DECLINE = 10
MAX_DECLINES = 2
MAX_REASON = 120
KINDS = ("region", "screen")


@dataclass
class _State:
    turns: int = 0
    last_suggested_turn: int | None = None
    shown: int = 0
    declines: int = 0
    silent_until_turn: int = 0
    pending: dict[str, str] = field(default_factory=dict)


class SuggestionLimiter:
    """Per-session book-keeping for suggestions. ``enabled`` is the user's switch."""

    def __init__(self) -> None:
        self.enabled = True
        self._sessions: dict[str, _State] = {}

    def _state(self, session_id: str) -> _State:
        return self._sessions.setdefault(session_id, _State())

    def note_user_turn(self, session_id: str) -> None:
        self._state(session_id).turns += 1

    def note_capture(self, session_id: str) -> None:
        """The user looked at the screen with Kali: there is nothing left to suggest for a while."""
        st = self._state(session_id)
        st.last_suggested_turn = st.turns

    def check(self, session_id: str) -> str | None:
        """Return why a suggestion is not allowed now, or None."""
        if not self.enabled:
            return "suggestions are turned off by the user"
        st = self._state(session_id)
        if st.declines >= MAX_DECLINES:
            return "the user declined suggestions twice; do not suggest again"
        if st.shown >= MAX_PER_SESSION:
            return "suggestion limit for this conversation reached"
        if st.turns < st.silent_until_turn:
            return "the user declined recently; stay quiet for now"
        if st.last_suggested_turn is not None and st.turns - st.last_suggested_turn < MIN_TURNS_BETWEEN:
            return "a suggestion was made very recently"
        return None

    def register(self, session_id: str, kind: str) -> str:
        st = self._state(session_id)
        st.shown += 1
        st.last_suggested_turn = st.turns
        sid = f"sug_{uuid.uuid4().hex[:8]}"
        st.pending[sid] = kind
        return sid

    def respond(self, session_id: str, suggestion_id: str, choice: str) -> bool:
        """Record the user's answer. Returns False for an unknown or already answered id."""
        st = self._state(session_id)
        if st.pending.pop(suggestion_id, None) is None:
            return False
        if choice == "dismiss":
            st.declines += 1
            st.silent_until_turn = st.turns + SILENCE_AFTER_DECLINE
        elif choice in KINDS:
            st.last_suggested_turn = st.turns
        return True

    def forget(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


limiter = SuggestionLimiter()


class SuggestCaptureTool:
    name = "suggest_capture"
    description = (
        "Offer the user to show you their screen. It never captures anything: the user sees two "
        "buttons (a region, or the whole screen) and decides. Use it only when seeing the screen "
        "would clearly help and the user did not ask you to look: they describe an error, a "
        "layout, a game state or something visible that you cannot know ('me sale un error', "
        "'it looks weird', 'no sé qué hacer en esta pantalla'). Do not use it for general "
        "questions, when the user just declined, or twice in a row. `kind` is 'region' when a "
        "specific part is enough, 'screen' when the whole picture matters. `reason` is one short "
        "sentence in the user's language shown next to the buttons."
    )
    schema = {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": list(KINDS), "description": "What to suggest looking at."},
            "reason": {"type": "string", "description": f"Why, in one short sentence (max {MAX_REASON} characters)."},
        },
        "required": ["kind", "reason"],
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        kind = params.get("kind")
        if kind not in KINDS:
            return ToolResult(error="kind must be 'region' or 'screen'")
        reason = " ".join(str(params.get("reason") or "").split())[:MAX_REASON]
        if not reason:
            return ToolResult(error="reason is required")
        blocked = limiter.check(ctx.session_id)
        if blocked:
            return ToolResult(output={"suggested": False, "reason": blocked})
        if ctx.emit is None:
            return ToolResult(output={"suggested": False, "reason": "no interface to show the suggestion"})
        sid = limiter.register(ctx.session_id, kind)
        await ctx.emit({
            "event": "suggestion",
            "session_id": ctx.session_id,
            "id": sid,
            "kind": kind,
            "reason": reason,
        })
        return ToolResult(output={
            "suggested": True,
            "note": "The user sees the offer. End your answer now; do not call screenshot tools until they accept.",
        })
