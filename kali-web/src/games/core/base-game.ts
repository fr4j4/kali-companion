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

  protected get state(): GameState {
    return this._state;
  }

  protected set state(s: GameState) {
    this._state = s;
  }

  getState(): GameState {
    return this._state;
  }

  getStatus(): GameStatusValue {
    return this._state.status;
  }

  protected emitState(): void {
    this.onStateChange?.(this.type, this._state);
  }

  onStateChange?: (type: GameTypeValue, state: GameState) => void;
}
