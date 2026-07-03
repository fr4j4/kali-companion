export const GAME_PARADIGM = {
  TURN_BASED: "turn-based",
  REALTIME: "realtime",
} as const;

export const GAME_SESSION_STATUS = {
  ACTIVE: "active",
  WON: "won",
  LOST: "lost",
  DRAW: "draw",
  ABANDONED: "abandoned",
} as const;

export const GAME_ACTOR = {
  PLAYER: "player",
  AI: "ai",
} as const;

export const GAME_EVENT_TYPE = {
  DIRECTION_CHANGE: "direction_change",
  FOOD_EATEN: "food_eaten",
  COLLISION: "collision",
  GAME_OVER: "game_over",
  SCORE_MILESTONE: "score_milestone",
} as const;

export const GAME_SESSION_WS_EVENT = {
  START: "game_session_start",
  TURN: "game_turn",
  EVENT: "game_event",
  END: "game_session_end",
  LIST: "list_game_sessions",
  LOADED: "game_session_loaded",
  LOAD: "load_game_session",
  DELETE: "delete_game_session",
  DELETED: "game_session_deleted",
  PERSISTED: "game_session_persisted",
} as const;

export const PLACEHOLDER_AI_ACTION = Object.freeze({ type: "move", data: {} });

export const DEFAULT_GAME_SESSION_PATH = "~/.kali/game-sessions";
