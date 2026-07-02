"""Tests para GameSessionService — persistencia de sesiones de juego."""

import json
import os
import tempfile

import pytest

from kali_core.mind.game_session_service import (
    GameSessionRecord,
    GameSessionService,
)
from kali_core.mind.game_session_constants import (
    GameParadigm,
    GameSessionStatus,
)


@pytest.fixture
def service(tmp_path):
    return GameSessionService(base_path=str(tmp_path))


class TestSave:
    def test_save_creates_file(self, service):
        record = GameSessionRecord(
            session_id="s1",
            game_id="tictactoe",
            paradigm=GameParadigm.TURN_BASED,
            status=GameSessionStatus.WON,
            started_at=1000.0,
            ended_at=2000.0,
            turns=[{"turnId": "t1", "turnNumber": 1}],
        )
        path = service.save(record)
        assert os.path.isfile(path)
        assert "tictactoe" in path
        assert "s1.json" in path

    def test_save_creates_directory(self, service):
        record = GameSessionRecord(
            session_id="s2", game_id="snake",
            paradigm=GameParadigm.REALTIME,
            status=GameSessionStatus.LOST,
            started_at=1000.0, ended_at=2000.0,
        )
        path = service.save(record)
        assert os.path.isfile(path)


class TestList:
    def test_list_returns_metadata(self, service):
        record = GameSessionRecord(
            session_id="s1", game_id="tictactoe",
            paradigm=GameParadigm.TURN_BASED,
            status=GameSessionStatus.WON,
            started_at=1000.0, ended_at=2000.0,
            turns=[{"turnId": "t1"}],
        )
        service.save(record)
        sessions = service.list_sessions()
        assert len(sessions) == 1
        assert sessions[0]["sessionId"] == "s1"
        assert sessions[0]["gameId"] == "tictactoe"
        assert sessions[0]["turnCount"] == 1

    def test_list_filtered_by_game_id(self, service):
        service.save(GameSessionRecord(
            session_id="s1", game_id="tictactoe",
            paradigm=GameParadigm.TURN_BASED,
            status=GameSessionStatus.WON,
            started_at=1000.0, ended_at=2000.0,
        ))
        service.save(GameSessionRecord(
            session_id="s2", game_id="snake",
            paradigm=GameParadigm.REALTIME,
            status=GameSessionStatus.LOST,
            started_at=1000.0, ended_at=2000.0,
        ))
        result = service.list_sessions("tictactoe")
        assert len(result) == 1
        assert result[0]["gameId"] == "tictactoe"


class TestLoad:
    def test_load_returns_full_data(self, service):
        record = GameSessionRecord(
            session_id="s1", game_id="tictactoe",
            paradigm=GameParadigm.TURN_BASED,
            status=GameSessionStatus.WON,
            started_at=1000.0, ended_at=2000.0,
            turns=[{"turnId": "t1", "actor": "player"}],
        )
        service.save(record)
        data = service.load("s1")
        assert data is not None
        assert data["session_id"] == "s1"
        assert len(data["turns"]) == 1

    def test_load_returns_none_if_not_found(self, service):
        assert service.load("nonexistent") is None


class TestDelete:
    def test_delete_removes_file(self, service):
        service.save(GameSessionRecord(
            session_id="s1", game_id="tictactoe",
            paradigm=GameParadigm.TURN_BASED,
            status=GameSessionStatus.WON,
            started_at=1000.0, ended_at=2000.0,
        ))
        assert service.delete("s1") is True
        assert service.load("s1") is None

    def test_delete_returns_false_if_not_found(self, service):
        assert service.delete("nonexistent") is False
