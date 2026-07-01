import type { GameTypeValue } from "./constants/game-types";
import type { PlayerSlot } from "./types/player";
import type { GameConfig } from "./types/game-config";
import type { GameAction } from "./types/game-action";
import type { GameState } from "./types/game-state";
import type { GameStatusValue } from "./constants/game-status";

export abstract class BaseGame {
  abstract readonly type: GameTypeValue;
  abstract readonly slots: readonly PlayerSlot[];

  abstract start(config?: GameConfig): GameState;
  abstract handleAction(action: GameAction, fromSlotId: string): GameState;

  pause(): void {}
  resume(): void {}
  tick(): void {}

  private _state: GameState = {
    status: "waiting",
    score: 0,
    data: null,
    winner: null,
  };

  private _prevData: unknown = null;
  private _version = 0;

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

  get version(): number {
    return this._version;
  }

  get prevData(): unknown {
    return this._prevData;
  }
}
