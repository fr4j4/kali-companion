"""Constants para el sistema de sesiones de juego."""

GAME_SESSION_FILE_EXTENSION = ".json"
DEFAULT_GAME_SESSION_PATH = "~/.kali/game-sessions"


class GameParadigm:
    TURN_BASED = "turn-based"
    REALTIME = "realtime"


class GameSessionStatus:
    ACTIVE = "active"
    WON = "won"
    LOST = "lost"
    DRAW = "draw"
    ABANDONED = "abandoned"


class GameSessionWSEvent:
    START = "game_session_start"
    TURN = "game_turn"
    EVENT = "game_event"
    END = "game_session_end"
    LIST = "list_game_sessions"
    LOAD = "load_game_session"
    LOADED = "game_session_loaded"
    DELETE = "delete_game_session"
    DELETED = "game_session_deleted"
    PERSISTED = "game_session_persisted"
