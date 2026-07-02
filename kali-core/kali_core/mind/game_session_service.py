"""Persistencia de sesiones de juego en disco."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from kali_core.config import settings
from .game_session_constants import (
    DEFAULT_GAME_SESSION_PATH,
    GAME_SESSION_FILE_EXTENSION,
)

logger = logging.getLogger("kali_core.mind.game_session_service")


@dataclass
class GameSessionRecord:
    session_id: str
    game_id: str
    paradigm: str
    status: str
    started_at: float
    ended_at: float | None = None
    turns: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)


class GameSessionService:
    """Lee y escribe sesiones de juego como archivos JSON en disco."""

    def __init__(self, base_path: str | None = None) -> None:
        self._base_path = base_path or self._resolve_base_path()

    def _resolve_base_path(self) -> str:
        configured = settings.game_session_path
        raw = configured if configured else DEFAULT_GAME_SESSION_PATH
        return os.path.expanduser(raw)

    def _path_for(self, game_id: str, session_id: str) -> str:
        return os.path.join(
            self._base_path, game_id, f"{session_id}{GAME_SESSION_FILE_EXTENSION}"
        )

    def save(self, record: GameSessionRecord) -> str:
        path = self._path_for(record.game_id, record.session_id)
        Path(os.path.dirname(path)).mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(record), f, indent=2, ensure_ascii=False)
        logger.info("[game_session] saved | id=%s game=%s path=%s",
                     record.session_id, record.game_id, path)
        return path

    def list_sessions(self, game_id: str | None = None) -> list[dict]:
        base = self._base_path
        if not os.path.isdir(base):
            return []
        dirs = (
            [os.path.join(base, game_id)]
            if game_id
            else [os.path.join(base, d) for d in os.listdir(base)
                  if os.path.isdir(os.path.join(base, d))]
        )
        results: list[dict] = []
        for d in dirs:
            if not os.path.isdir(d):
                continue
            for fname in os.listdir(d):
                if not fname.endswith(GAME_SESSION_FILE_EXTENSION):
                    continue
                fpath = os.path.join(d, fname)
                try:
                    with open(fpath, encoding="utf-8") as fh:
                        data = json.load(fh)
                    results.append({
                        "sessionId": data["session_id"],
                        "gameId": data["game_id"],
                        "status": data["status"],
                        "startedAt": data["started_at"],
                        "endedAt": data.get("ended_at"),
                        "turnCount": len(data.get("turns") or []),
                        "eventCount": len(data.get("events") or []),
                    })
                except (json.JSONDecodeError, KeyError, OSError):
                    logger.warning("[game_session] corrupt file skipped: %s", fpath)
        return results

    def load(self, session_id: str) -> dict | None:
        base = self._base_path
        if not os.path.isdir(base):
            return None
        for game_id in os.listdir(base):
            path = self._path_for(game_id, session_id)
            if os.path.isfile(path):
                try:
                    with open(path, encoding="utf-8") as f:
                        return json.load(f)
                except (json.JSONDecodeError, OSError):
                    return None
        return None

    def delete(self, session_id: str) -> bool:
        base = self._base_path
        if not os.path.isdir(base):
            return False
        for game_id in os.listdir(base):
            path = self._path_for(game_id, session_id)
            if os.path.isfile(path):
                os.remove(path)
                logger.info("[game_session] deleted | id=%s", session_id)
                return True
        return False
