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

  private _state: GameState = {
    status: "waiting",
    score: 0,
    data: null,
    winner: null,
  };

  private _version = 0;

  protected get state(): GameState {
    return this._state;
  }

  protected set state(s: GameState) {
    this._state = s;
    this._version++;
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
}
