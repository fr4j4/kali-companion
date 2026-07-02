import type { BaseGame } from "./base-game";
import type { MoveProvider } from "../ai/ai-slot-filler";
import type { SlotIdValue } from "./constants/player-types";
import type { KaliStatusValue } from "./constants/game-ai";
import type { GameAction } from "./types/game-action";
import type { GameSessionManager, GameSessionManagerCallbacks } from "./game-session-manager";
import { KaliStatus } from "./constants/game-ai";
import { GameCommand } from "./constants/action-types";
import type { GameCommandValue } from "./constants/action-types";

/**
 * RealtimeSessionManager — placeholder for realtime games.
 *
 * The common lifecycle methods work, but turn-based operations are unsupported
 * and throw a clear error. Full realtime event emission will be implemented
 * when Snake or other realtime games are wired up.
 */
export class RealtimeSessionManager implements GameSessionManager {
  private readonly _game: BaseGame;
  private readonly _callbacks: GameSessionManagerCallbacks;
  private readonly _subscribers = new Set<() => void>();

  constructor(
    game: BaseGame,
    _providers: ReadonlyMap<SlotIdValue, MoveProvider>,
    callbacks: GameSessionManagerCallbacks,
  ) {
    this._game = game;
    this._callbacks = callbacks;
  }

  get kaliStatus(): KaliStatusValue {
    return KaliStatus.IDLE;
  }

  get kaliError(): null {
    return null;
  }

  get retryCount(): 0 {
    return 0;
  }

  start(): void {
    // no-op for realtime stub
  }

  destroy(): void {
    // nothing to abort yet
  }

  pause(): void {
    this._game.pause();
    this._callbacks.onStateChange();
  }

  resume(): void {
    this._game.resume();
    this._callbacks.onStateChange();
  }

  giveUp(): void {
    this.sendCommand(GameCommand.GIVE_UP);
  }

  sendCommand(_command: GameCommandValue): void {
    // no-op for realtime stub
    this._callbacks.onStateChange();
  }

  submitPlayerAction(_action: GameAction): void {
    throw new Error("submitPlayerAction is not implemented for realtime games");
  }

  retryAI(): void {
    throw new Error("retryAI is not implemented for realtime games");
  }

  fallbackToCPU(_provider: MoveProvider): void {
    throw new Error("fallbackToCPU is not implemented for realtime games");
  }

  subscribe(fn: () => void): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }
}
