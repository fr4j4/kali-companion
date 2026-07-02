// ── Kali AI Status ──────────────────────────────────────────────────────────
export const KaliStatus = {
  IDLE: "idle",
  THINKING: "thinking",
  ERROR: "error",
} as const;
export type KaliStatusValue = (typeof KaliStatus)[keyof typeof KaliStatus];

// ── Kali Error Codes ───────────────────────────────────────────────────────
export const KaliErrorCode = {
  WS_NULL: "WS_NULL",
  WS_TIMEOUT: "WS_TIMEOUT",
  WS_ERROR: "WS_ERROR",
  PARSE_ERROR: "PARSE_ERROR",
  INVALID_MOVE: "INVALID_MOVE",
  MODEL_ERROR: "MODEL_ERROR",
  NO_LEGAL_MOVES: "NO_LEGAL_MOVES",
} as const;
export type KaliErrorCodeValue = (typeof KaliErrorCode)[keyof typeof KaliErrorCode];

// ── Game AI Config ──────────────────────────────────────────────────────────
export const GAME_AI_TIMEOUT_MS = 12_000;
export const GAME_AI_TIMEOUT_2_MS = 3_000;
export const GAME_AI_TIMEOUT_3_MS = 2_000;
export const GAME_AI_GLOBAL_TIMEOUT_MS = 20_000; // tope global, configurable desde settings
export const KALI_MAX_RETRIES = 2;
export const GAME_AI_MIN_GLOBAL_TIMEOUT_MS = 5_000;

// ── Game Mode ──────────────────────────────────────────────────────────────
export const GameMode = {
  CPU: "cpu",
  KALI: "kali",
} as const;
export type GameModeValue = (typeof GameMode)[keyof typeof GameMode];

// ── Tic-Tac-Toe state fields ──────────────────────────────────────────────
export const TttField = {
  BOARD: "board",
  CURRENT_SLOT: "currentSlot",
  DIFFICULTY: "difficulty",
  STARTER: "starter",
  PLAYER_MARK: "playerMark",
  OPPONENT_MARK: "opponentMark",
  MODE: "mode",
  WINNER: "winner",
  WINNING_LINE: "winningLine",
} as const;
