import type { BaseGame } from "./base-game";
import type { MoveProvider } from "../ai/ai-slot-filler";
import type { SlotIdValue } from "./constants/player-types";
import type { KaliStatusValue } from "./constants/game-ai";
import type { KaliError } from "../ai/kali-error";
import type { GameAction } from "./types/game-action";
import { GAME_PARADIGM } from "./game-session-constants";
import { TurnBasedSessionManager } from "./turn-based-session-manager";
import { RealtimeSessionManager } from "./realtime-session-manager";

/** Callbacks the GameSessionManager emits to notify the UI. */
export interface GameSessionManagerCallbacks {
  onStateChange: () => void;
  onAIStatusChange: (status: KaliStatusValue, error?: KaliError) => void;
}

import type { GameCommandValue } from "./constants/action-types";

/** Public contract for any game session manager, regardless of paradigm. */
export interface GameSessionManager {
  // ── Common lifecycle ──
  start(): void;
  destroy(): void;
  pause(): void;
  resume(): void;
  giveUp(): void;
  sendCommand(command: GameCommandValue): void;

  // ── Observable state ──
  readonly kaliStatus: KaliStatusValue;
  readonly kaliError: KaliError | null;
  readonly retryCount: number;

  // ── Turn-based API ──
  submitPlayerAction(action: GameAction): void;
  retryAI(): void;
  fallbackToCPU(provider: MoveProvider): void;

  // ── Subscription ──
  subscribe(fn: () => void): () => void;
}

/** Factory: picks the right manager implementation based on the game's paradigm. */
export function createGameSessionManager(
  game: BaseGame,
  providers: ReadonlyMap<SlotIdValue, MoveProvider>,
  callbacks: GameSessionManagerCallbacks,
): GameSessionManager {
  switch (game.paradigm) {
    case GAME_PARADIGM.TURN_BASED:
      return new TurnBasedSessionManager(game, providers, callbacks);
    case GAME_PARADIGM.REALTIME:
      return new RealtimeSessionManager(game, providers, callbacks);
    default:
      throw new Error(`Unsupported game paradigm: ${game.paradigm}`);
  }
}
