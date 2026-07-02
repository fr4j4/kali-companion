import type { GameAction } from "./types/game-action";

export interface GameTurnReasoningData {
  text: string;
  done: boolean;
  model?: string;
}

export interface GameTurnData {
  turnId: string;
  turnNumber: number;
  slotId: string;
  actor: "player" | "ai";
  action: GameAction;
  stateAfter: unknown;
  timestamp: number;
  reasoning?: GameTurnReasoningData;
}

export interface GameEventData {
  eventId: string;
  type: string;
  timestamp: number;
  stateAfter: unknown;
  payload?: unknown;
}

export interface GameSessionData {
  sessionId: string;
  gameId: string;
  paradigm: "turn-based" | "realtime";
  status: "active" | "won" | "lost" | "draw" | "abandoned";
  startedAt: number;
  endedAt?: number;
  turns?: GameTurnData[];
  events?: GameEventData[];
}

export interface GameSessionMeta {
  sessionId: string;
  gameId: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  turnCount: number;
  eventCount: number;
}
