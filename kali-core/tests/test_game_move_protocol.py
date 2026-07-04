"""Tests for the game_move WebSocket event protocol.

Verifies:
1. game_move → game_move_response round-trip via WebSocket
2. _build_game_messages builds correct prompt
3. _parse_game_action handles valid JSON, parse errors, invalid moves
4. _get_fallback_move returns a random legal move
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import tempfile

import pytest

from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import PermissionGateway
from kali_core.config import settings
from kali_core.mind.executor import Executor
from kali_core.mind.llm.provider import StreamEvent, ToolDef
from kali_core.mind.console_requester import ConsoleRequester
from kali_core.mind.connections_store import ConnectionsStore
from kali_core.mind.runtime import AgentRuntime
from kali_core.nest.store import SessionStore
from kali_core.server import Connection, Server
from kali_core.voice.pipeline import TTSPipeline
from kali_core.voice.providers.inproc import InProcTTSProvider
from kali_core.voice.voice_config import VoiceConfigManager


class FakeLLMProvider:
    """LLM that returns a canned response for game_move tests.

    Set ``responses`` to a list to cycle through different responses across
    multiple ``stream()`` calls (used for retry tests).
    """

    provider_name = "fake"

    def __init__(
        self,
        response: dict | None = None,
        responses: list[dict] | None = None,
    ) -> None:
        self._model = "fake-model"
        self._responses: list[dict] = responses or [response or {"text": '{"row": 1, "col": 2}'}]
        self._call_count = 0

    def _next_response(self) -> dict:
        idx = self._call_count % len(self._responses)
        self._call_count += 1
        return self._responses[idx]

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict | None = None,
        reasoning_effort: str | None = None,
    ):
        resp = self._next_response()
        text = resp.get("text", "")
        reasoning = resp.get("reasoning", "")
        if reasoning:
            yield StreamEvent(kind="reasoning", text=reasoning)
        if text:
            yield StreamEvent(kind="delta", text=text)
        yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict | None = None,
        reasoning_effort: str | None = None,
    ) -> dict:
        return self._next_response()


class ConnectionTestHelper(Connection):
    """Connection subclass that exposes _parse_game_action etc. for unit testing."""

    def __init__(
        self,
        llm_response: dict | None = None,
        *,
        responses: list[dict] | None = None,
    ) -> None:
        # Don't call super().__init__ — just set llm_provider directly
        self.server = type("Srv", (), {"llm_provider": FakeLLMProvider(llm_response, responses)})()
        self.session_id = None
        self._sent: list[dict] = []

    async def send(self, payload: dict) -> None:
        self._sent.append(payload)


@pytest.fixture
def conn() -> ConnectionTestHelper:
    return ConnectionTestHelper()


class TestBuildGameMessages:
    def test_includes_system_prompt_and_game_state(self, conn):
        rules = {"system_prompt": "You are a Tic-Tac-Toe AI."}
        game_state = {"board": [["X", None, None], [None, None, None], [None, None, None]]}
        messages = conn._build_game_messages(rules, game_state)
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert "SYSTEM INSTRUCTIONS:" in messages[0]["content"]
        assert "You are a Tic-Tac-Toe AI." in messages[0]["content"]
        assert "X" in messages[0]["content"]

    def test_defaults_system_prompt(self, conn):
        rules = {}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        messages = conn._build_game_messages(rules, game_state)
        assert len(messages) == 1
        assert "game AI" in messages[0]["content"]


class TestParseGameAction:
    def test_valid_move(self, conn):
        response = {"text": '{"row": 0, "col": 1}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action == {"type": "move", "data": {"row": 0, "col": 1}}
        assert error is None

    def test_parse_error_non_json(self, conn):
        response = {"text": "I think I'll play at position 0,1."}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is None
        assert error is not None
        assert error["code"] == "PARSE_ERROR"
        assert error["fallback_action"] is None

    def test_missing_col_is_invalid_move(self, conn):
        response = {"text": '{"row": 0}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is None
        assert error["code"] == "INVALID_MOVE"
        assert error["fallback_action"] is None

    def test_invalid_move_out_of_range(self, conn):
        response = {"text": '{"row": 5, "col": 5}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is None
        assert error["code"] == "INVALID_MOVE"
        assert error["fallback_action"] is None

    def test_invalid_move_occupied_cell(self, conn):
        board = [["X", None, None], [None, None, None], [None, None, None]]
        response = {"text": '{"row": 0, "col": 0}'}
        action, error = conn._parse_game_action(response, {"board": board}, {})
        assert action is None
        assert error["code"] == "INVALID_MOVE"

    def test_invalid_move_negative(self, conn):
        response = {"text": '{"row": -1, "col": 0}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is None
        assert error["code"] == "INVALID_MOVE"


class TestGetFallbackMove:
    def test_returns_random_empty_cell(self, conn):
        board = [[None, None, None], [None, None, None], [None, None, None]]
        fallback = conn._get_fallback_move({"board": board})
        assert fallback is not None
        assert fallback["type"] == "move"
        assert 0 <= fallback["data"]["row"] <= 2
        assert 0 <= fallback["data"]["col"] <= 2

    def test_returns_none_when_full(self, conn):
        board = [["X", "O", "X"], ["O", "X", "O"], ["O", "X", "O"]]
        fallback = conn._get_fallback_move({"board": board})
        assert fallback is None

    def test_returns_none_for_empty_board_list(self, conn):
        assert conn._get_fallback_move({"board": []}) is None


class TestIsLegalMove:
    def test_legal_empty_cell(self, conn):
        board = [[None, None, None], [None, None, None], [None, None, None]]
        assert conn._is_legal_move({"board": board}, 0, 0) is True
        assert conn._is_legal_move({"board": board}, 2, 2) is True

    def test_illegal_occupied_cell(self, conn):
        board = [["X", None, None], [None, None, None], [None, None, None]]
        assert conn._is_legal_move({"board": board}, 0, 0) is False

    def test_illegal_out_of_range(self, conn):
        board = [[None] * 3 for _ in range(3)]
        assert conn._is_legal_move({"board": board}, 3, 0) is False
        assert conn._is_legal_move({"board": board}, 0, 3) is False
        assert conn._is_legal_move({"board": board}, -1, 0) is False

    def test_illegal_none_values(self, conn):
        board = [[None] * 3 for _ in range(3)]
        assert conn._is_legal_move({"board": board}, None, 0) is False
        assert conn._is_legal_move({"board": board}, 0, None) is False


@pytest.mark.asyncio
class TestHandleGameMove:
    async def test_full_roundtrip_valid_response(self):
        """Send game_move event, get back a valid action."""
        llm_response = {"text": '{"row": 1, "col": 1}'}
        conn = ConnectionTestHelper(llm_response)
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "test-session",
            "game_session_id": "game-rt",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        assert len(conn._sent) == 1
        resp = conn._sent[0]
        assert resp["event"] == "game_move_response"
        assert resp["game_type"] == "tictactoe"
        assert resp["game_session_id"] == "game-rt"
        assert resp["action"] is not None
        assert resp["action"]["data"]["row"] == 1
        assert resp["action"]["data"]["col"] == 1
        assert resp["error"] is None
        assert resp.get("reasoning") == ""

    async def test_returns_model_error_after_retry_exhausted(self):
        """On parse error the handler retries 3 times before returning MODEL_ERROR."""
        conn = ConnectionTestHelper({"text": "not json at all"})
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "game_session_id": "game-retry",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        resp = conn._sent[0]
        assert resp["game_session_id"] == "game-retry"
        assert resp["action"] is None
        assert resp["error"]["code"] == "MODEL_ERROR"
        assert resp["error"]["fallback_action"] is None

    async def test_returns_model_error_after_invalid_move_retry_exhausted(self):
        """On invalid move the handler retries 3 times before returning MODEL_ERROR."""
        conn = ConnectionTestHelper({"text": '{"row": 9, "col": 9}'})
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "game_session_id": "game-invalid",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        resp = conn._sent[0]
        assert resp["game_session_id"] == "game-invalid"
        assert resp["action"] is None
        assert resp["error"]["code"] == "MODEL_ERROR"
        assert resp["error"]["fallback_action"] is None

    async def test_streams_reasoning_before_response(self):
        """Reasoning chunks are emitted before the final response."""
        llm_response = {
            "text": '{"row": 0, "col": 0, "reasoning": "I see the center is open. Taking it."}',
            "reasoning": "I see the center is open. Taking it.",
        }
        conn = ConnectionTestHelper(llm_response)
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "reasoning-test-session",
            "game_session_id": "game-123",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)

        # Should have sent: reasoning chunk + game_move_response
        assert len(conn._sent) == 2
        reasoning_ev = conn._sent[0]
        assert reasoning_ev["event"] == "game_move_reasoning:game-123"
        assert reasoning_ev["chunk"] == "I see the center is open. Taking it."

        resp = conn._sent[1]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "game-123"
        assert resp["action"]["data"]["row"] == 0
        assert resp["action"]["data"]["col"] == 0
        assert resp["reasoning"] == "I see the center is open. Taking it."

    async def test_reasoning_from_json_fallback(self):
        """Non-CoT model: reasoning embedded in JSON, not streamed natively."""
        llm_response = {
            "text": '{"row": 0, "col": 0, "reasoning": "Taking center."}',
        }
        conn = ConnectionTestHelper(llm_response)
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "test-session",
            "game_session_id": "g-789",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)

        # Should have: game_move_reasoning (1 event, done=true) + game_move_response
        assert len(conn._sent) == 2
        reason_ev = conn._sent[0]
        assert reason_ev["event"] == "game_move_reasoning:g-789"
        assert reason_ev["chunk"] == "Taking center."
        assert reason_ev.get("done") is True

        resp = conn._sent[1]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "g-789"
        assert resp["action"]["data"]["row"] == 0
        assert resp["action"]["data"]["col"] == 0
        assert resp["reasoning"] == "Taking center."

    async def test_reasoning_from_move_marker(self):
        """Model outputs reasoning text then ---MOVE--- then JSON."""
        llm_response = {
            "text": "Center is open.\n---MOVE---\n{\"row\": 1, \"col\": 1}",
        }
        conn = ConnectionTestHelper(llm_response)
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "test-session",
            "game_session_id": "g-101",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)

        # Should have: game_move_reasoning (1 event) + game_move_response
        assert len(conn._sent) == 2
        reason_ev = conn._sent[0]
        assert reason_ev["event"] == "game_move_reasoning:g-101"
        assert "Center is open." in reason_ev["chunk"]

        resp = conn._sent[1]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "g-101"
        assert resp["action"]["data"]["row"] == 1
        assert resp["action"]["data"]["col"] == 1
        assert resp["reasoning"] == "Center is open."

    async def test_returns_model_error_on_llm_failure(self):
        class FailingLLM:
            provider_name = "failing"
            _model = "fail"

            async def stream(
                self,
                messages,
                tools=None,
                *,
                temperature=None,
                max_tokens=None,
                response_format=None,
                reasoning_effort=None,
            ):
                raise RuntimeError("Connection refused")
                yield  # pragma: no cover — makes this an async generator

            async def complete(
                self,
                messages,
                tools=None,
                *,
                temperature=None,
                max_tokens=None,
                response_format=None,
                reasoning_effort=None,
            ):
                raise RuntimeError("Connection refused")

        conn = ConnectionTestHelper()
        conn.server.llm_provider = FailingLLM()
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "game_session_id": "game-fail",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        resp = conn._sent[0]
        assert resp["game_session_id"] == "game-fail"
        assert resp["action"] is None
        assert resp["error"]["code"] == "MODEL_ERROR"
        assert "Connection refused" in resp["error"]["message"]

    async def test_retry_progressive_then_success(self):
        """First attempt returns non-JSON; second attempt returns valid JSON."""
        conn = ConnectionTestHelper(
            responses=[
                {"text": "I am thinking..."},
                {"text": '{"row": 0, "col": 2}'},
            ]
        )
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "retry-test",
            "game_session_id": "game-retry-prog",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None, None, None], [None, None, None], [None, None, None]]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        resp = conn._sent[-1]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "game-retry-prog"
        assert resp["action"] is not None
        assert resp["action"]["data"]["row"] == 0
        assert resp["action"]["data"]["col"] == 2

    async def test_retry_3_attempts_all_fail_model_error(self):
        """All 3 attempts fail -> MODEL_ERROR with no fallback."""
        conn = ConnectionTestHelper(
            responses=[
                {"text": "thinking..."},
                {"text": "still thinking..."},
                {"text": "..."},
            ]
        )
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "fail-test",
            "game_session_id": "game-3fail",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        resp = conn._sent[-1]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "game-3fail"
        assert resp["action"] is None
        assert resp["error"]["code"] == "MODEL_ERROR"
        assert resp["error"]["fallback_action"] is None

    async def test_missing_game_session_id_returns_error(self):
        """Missing game_session_id is rejected with MODEL_ERROR."""
        conn = ConnectionTestHelper({"text": '{"row": 0, "col": 0}'})
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "session_id": "test-session",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": [[None] * 3 for _ in range(3)]},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        assert len(conn._sent) == 1
        resp = conn._sent[0]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] is None
        assert resp["action"] is None
        assert resp["error"]["code"] == "MODEL_ERROR"
        assert "game_session_id" in resp["error"]["message"]

    async def test_full_board_returns_no_legal_moves(self):
        """A full board triggers NO_LEGAL_MOVES without calling the LLM."""
        conn = ConnectionTestHelper({"text": '{"row": 0, "col": 0}'})
        full_board = [["X", "O", "X"], ["X", "O", "O"], ["O", "X", "X"]]
        event = {
            "event": "game_move",
            "game_type": "tictactoe",
            "game_session_id": "game-full",
            "rules": {"system_prompt": "You are Tic-Tac-Toe."},
            "game_state": {"board": full_board},
            "player_role": "opponent",
        }
        await conn._handle_game_move(event)
        assert len(conn._sent) == 1
        resp = conn._sent[0]
        assert resp["event"] == "game_move_response"
        assert resp["game_session_id"] == "game-full"
        assert resp["action"] is None
        assert resp["error"]["code"] == "NO_LEGAL_MOVES"
        # The FakeLLMProvider should not have been called at all.
        assert conn.server.llm_provider._call_count == 0


class TestParseGameActionResilient:
    """Tests for the resilient JSON parser in _parse_game_action."""

    def test_parse_markdown_fenced_json(self, conn):
        response = {"text": '```json\n{"row": 1, "col": 2}\n```'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["data"]["row"] == 1
        assert action["data"]["col"] == 2
        assert error is None

    def test_parse_json_surrounded_by_text(self, conn):
        response = {"text": "I'll play here:\n{\"row\": 2, \"col\": 0}\nDone."}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["data"]["row"] == 2
        assert action["data"]["col"] == 0
        assert error is None

    def test_parse_string_coords_coerced_to_int(self, conn):
        response = {"text": '{"row": "1", "col": "2"}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["data"]["row"] == 1
        assert action["data"]["col"] == 2
        assert error is None

    def test_parse_truncated_json_repaired(self, conn):
        response = {"text": '{"row": 1, "col": 2'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["data"]["row"] == 1
        assert error is None

    def test_parse_move_marker_then_json(self, conn):
        response = {"text": "Center is taken.\n---MOVE---\n{\"row\": 0, \"col\": 0}"}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["data"]["row"] == 0
        assert action["data"]["col"] == 0
        assert error is None

    def test_parse_reasoning_in_json(self, conn):
        response = {"text": '{"reasoning": "Best move.", "row": 1, "col": 1}'}
        game_state = {"board": [[None] * 3 for _ in range(3)]}
        action, error = conn._parse_game_action(response, game_state, {})
        assert action is not None
        assert action["reasoning"] == "Best move."
        assert action["data"]["row"] == 1
        assert action["data"]["col"] == 1
        assert error is None


class TestBuildMinimalGameMessages:
    def test_lists_empty_cells(self, conn):
        game_state = {
            "board": [["A", "B", "C"], [None, None, None], [None, None, None]]
        }
        messages = conn._build_minimal_game_messages(game_state)
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        content = messages[0]["content"]
        assert "(1,0)" in content
        assert "(1,1)" in content
        assert "(1,2)" in content
        assert "(2,0)" in content
        assert "(2,1)" in content
        assert "(2,2)" in content
        assert "A" not in content
        assert "B" not in content
        assert "Output ONLY valid JSON" in content

    def test_says_none_when_full(self, conn):
        game_state = {"board": [["X", "O", "X"], ["O", "X", "O"], ["O", "X", "O"]]}
        messages = conn._build_minimal_game_messages(game_state)
        assert "Empty cells: none." in messages[0]["content"]
