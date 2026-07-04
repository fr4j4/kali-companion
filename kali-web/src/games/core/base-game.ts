import type { GameTypeValue } from "./constants/game-types";
import type { PlayerSlot } from "./types/player";
import type { GameConfig } from "./types/game-config";
import type { GameAction } from "./types/game-action";
import type { GameState } from "./types/game-state";
import type { GameStatusValue } from "./constants/game-status";
import { gameSessionStore } from "./game-session-store";
import { GameStatus } from "./constants/game-status";

export abstract class BaseGame {
  abstract readonly type: GameTypeValue;
  abstract readonly slots: readonly PlayerSlot[];
  abstract readonly paradigm: "turn-based" | "realtime";

  /** Intrinsic width of the game's content area in logical px. */
  abstract readonly naturalWidth: number;
  /** Intrinsic height of the game's content area in logical px. */
  abstract readonly naturalHeight: number;

  abstract start(config?: GameConfig): GameState;
  abstract handleAction(action: GameAction, fromSlotId: string): GameState;

  /** Aspect ratio of the game's content area (width / height). */
  get aspectRatio(): number {
    return this.naturalWidth / this.naturalHeight;
  }

  pause(): void {}
  resume(): void {}
  tick(): void {}

  /** Reset the game and immediately set it to PLAYING. */
  restart(config?: GameConfig): void {
    this.start(config);
    this.state = { ...this.state, status: GameStatus.PLAYING };
  }

  private _state: GameState = {
    status: "waiting",
    score: 0,
    data: null,
    winner: null,
  };

  private _prevData: unknown = null;
  private _version = 0;
  private _sessionId = "";

  protected get state(): GameState {
    return this._state;
  }

  protected set state(s: GameState) {
    this._prevData = this._cloneData(this._state.data);
    this._state = s;
    this._version++;
  }

  private _cloneData(data: unknown): unknown {
    if (data === null || typeof data !== "object") return data;
    if (typeof structuredClone === "function") return structuredClone(data);
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return data;
    }
  }

  getState(): GameState {
    return this._state;
  }

  getStatus(): GameStatusValue {
    return this._state.status;
  }

  /**
   * Whether the game has ended and accepts no more moves.
   *
   * Default implementation returns `true` for any status that is not
   * `playing`, `paused`, or `waiting`. Games may override this for
   * more precise logic (e.g. checking an internal flag before the
   * status field is updated).
   */
  isFinished(): boolean {
    const s = this.state.status;
    return s !== "playing" && s !== "paused" && s !== "waiting";
  }

  get version(): number {
    return this._version;
  }

  get prevData(): unknown {
    return this._prevData;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  newGame(): string {
    this._sessionId = crypto.randomUUID();
    gameSessionStore.startSession(this._sessionId, this.type, this.paradigm);
    return this._sessionId;
  }

  stop(): void {
    if (this._sessionId) {
      const status = this.getStatus();
      if (status !== "playing" && status !== "paused" && status !== "waiting") {
        gameSessionStore.endSession(this._sessionId, status);
      }
      gameSessionStore.clearSession(this._sessionId);
    }
  }
}
