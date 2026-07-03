"""Tests for Connection game-session WebSocket handlers."""

from __future__ import annotations

import pytest

from kali_core.mind.game_session_service import (
    GameSessionRecord,
    GameSessionService,
)
from kali_core.mind.game_session_constants import (
    GameParadigm,
    GameSessionStatus,
    GameSessionWSEvent,
)
from kali_core.server import Connection


@pytest.fixture
def helper(tmp_path):
    class SessionConnectionTestHelper(Connection):
        def __init__(self, base_path: str) -> None:
            self.server = type("Srv", (), {
                "llm_provider": None,
                "game_session_service": GameSessionService(base_path=base_path),
            })()
            self.session_id = None
            self._sent: list[dict] = []

        async def send(self, payload: dict) -> None:
            self._sent.append(payload)

    return SessionConnectionTestHelper(str(tmp_path))


@pytest.mark.asyncio
async def test_game_session_start_no_op_full_fields(helper):
    await helper._handle_game_session_start({
        "event": GameSessionWSEvent.START,
        "sessionId": "sess-1",
        "gameId": "tictactoe",
        "paradigm": GameParadigm.TURN_BASED,
    })
    assert helper._sent == []


@pytest.mark.asyncio
async def test_game_session_start_no_op_missing_fields(helper):
    await helper._handle_game_session_start({"event": GameSessionWSEvent.START})
    assert helper._sent == []


@pytest.mark.asyncio
async def test_game_session_end_persists_and_responds(helper):
    await helper._handle_game_session_end({
        "event": GameSessionWSEvent.END,
        "sessionId": "sess-end",
        "gameId": "tictactoe",
        "paradigm": GameParadigm.TURN_BASED,
        "status": GameSessionStatus.WON,
        "startedAt": 1000.0,
        "endedAt": 2000.0,
        "turns": [{"turnNumber": 1}],
        "events": [],
    })
    assert len(helper._sent) == 1
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.PERSISTED
    assert payload["sessionId"] == "sess-end"
    assert "path" in payload
    assert "tictactoe" in payload["path"]


@pytest.mark.asyncio
async def test_game_session_end_realtime_with_events(helper):
    await helper._handle_game_session_end({
        "event": GameSessionWSEvent.END,
        "sessionId": "sess-rt",
        "gameId": "snake",
        "paradigm": GameParadigm.REALTIME,
        "status": GameSessionStatus.LOST,
        "startedAt": 1.0,
        "endedAt": 2.0,
        "turns": [],
        "events": [{"type": "score", "value": 10}],
    })
    assert len(helper._sent) == 1
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.PERSISTED
    data = helper.server.game_session_service.load("sess-rt")
    assert data is not None
    assert data["paradigm"] == GameParadigm.REALTIME
    assert data["events"] == [{"type": "score", "value": 10}]


@pytest.mark.asyncio
async def test_game_session_end_empty_turns(helper):
    await helper._handle_game_session_end({
        "event": GameSessionWSEvent.END,
        "sessionId": "sess-empty",
        "gameId": "tictactoe",
        "status": GameSessionStatus.DRAW,
        "startedAt": 1.0,
        "endedAt": 2.0,
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.PERSISTED
    data = helper.server.game_session_service.load("sess-empty")
    assert data["turns"] == []


@pytest.mark.asyncio
async def test_game_session_end_default_status_abandoned(helper):
    await helper._handle_game_session_end({
        "event": GameSessionWSEvent.END,
        "sessionId": "sess-abandon",
        "gameId": "chess",
        "startedAt": 1.0,
        "endedAt": 2.0,
    })
    data = helper.server.game_session_service.load("sess-abandon")
    assert data["status"] == GameSessionStatus.ABANDONED


@pytest.mark.asyncio
async def test_list_game_sessions_filtered_by_game_id(helper):
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s1", game_id="tictactoe",
        paradigm=GameParadigm.TURN_BASED,
        status=GameSessionStatus.WON,
        started_at=1.0, ended_at=2.0,
    ))
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s2", game_id="snake",
        paradigm=GameParadigm.REALTIME,
        status=GameSessionStatus.LOST,
        started_at=1.0, ended_at=2.0,
    ))
    await helper._handle_list_game_sessions({
        "event": GameSessionWSEvent.LIST,
        "gameId": "tictactoe",
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LIST
    assert len(payload["sessions"]) == 1
    assert payload["sessions"][0]["gameId"] == "tictactoe"


@pytest.mark.asyncio
async def test_list_game_sessions_all_games(helper):
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s1", game_id="tictactoe",
        paradigm=GameParadigm.TURN_BASED,
        status=GameSessionStatus.WON,
        started_at=1.0, ended_at=2.0,
    ))
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s2", game_id="snake",
        paradigm=GameParadigm.REALTIME,
        status=GameSessionStatus.LOST,
        started_at=1.0, ended_at=2.0,
    ))
    await helper._handle_list_game_sessions({"event": GameSessionWSEvent.LIST})
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LIST
    assert len(payload["sessions"]) == 2


@pytest.mark.asyncio
async def test_list_game_sessions_empty(helper):
    await helper._handle_list_game_sessions({"event": GameSessionWSEvent.LIST})
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LIST
    assert payload["sessions"] == []


@pytest.mark.asyncio
async def test_load_game_session_returns_full_data(helper):
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s1", game_id="tictactoe",
        paradigm=GameParadigm.TURN_BASED,
        status=GameSessionStatus.WON,
        started_at=1.0, ended_at=2.0,
        turns=[{"turnNumber": 1}],
    ))
    await helper._handle_load_game_session({
        "event": GameSessionWSEvent.LOAD,
        "sessionId": "s1",
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LOADED
    assert payload["session"]["session_id"] == "s1"
    assert payload["session"]["turns"] == [{"turnNumber": 1}]


@pytest.mark.asyncio
async def test_load_game_session_returns_null_when_missing(helper):
    await helper._handle_load_game_session({
        "event": GameSessionWSEvent.LOAD,
        "sessionId": "missing",
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LOADED
    assert payload["session"] is None


@pytest.mark.asyncio
async def test_load_game_session_empty_id_returns_null(helper):
    await helper._handle_load_game_session({"event": GameSessionWSEvent.LOAD})
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.LOADED
    assert payload["session"] is None


@pytest.mark.asyncio
async def test_delete_game_session_deletes_existing(helper):
    helper.server.game_session_service.save(GameSessionRecord(
        session_id="s1", game_id="tictactoe",
        paradigm=GameParadigm.TURN_BASED,
        status=GameSessionStatus.WON,
        started_at=1.0, ended_at=2.0,
    ))
    await helper._handle_delete_game_session({
        "event": GameSessionWSEvent.DELETE,
        "sessionId": "s1",
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.DELETED
    assert payload["sessionId"] == "s1"
    assert payload["deleted"] is True
    assert helper.server.game_session_service.load("s1") is None


@pytest.mark.asyncio
async def test_delete_game_session_false_when_missing(helper):
    await helper._handle_delete_game_session({
        "event": GameSessionWSEvent.DELETE,
        "sessionId": "missing",
    })
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.DELETED
    assert payload["deleted"] is False


@pytest.mark.asyncio
async def test_delete_game_session_false_with_empty_id(helper):
    await helper._handle_delete_game_session({"event": GameSessionWSEvent.DELETE})
    payload = helper._sent[0]
    assert payload["event"] == GameSessionWSEvent.DELETED
    assert payload["deleted"] is False
