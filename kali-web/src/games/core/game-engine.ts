import type { GameTypeValue } from "./constants/game-types";
import type { GameState } from "./types/game-state";
import type { GameConfig } from "./types/game-config";
import type { GameAction } from "./types/game-action";
import { BaseGame } from "./base-game";
import { GameRegistry } from "./game-registry";
import { GameEvents } from "./constants/events";

type EmitFn = (event: string, payload: unknown) => void;

export class GameEngine {
  private _activeGame: BaseGame | null = null;

  constructor(private _emit: EmitFn) {}

  get activeGame(): BaseGame | null {
    return this._activeGame;
  }

  get isPlaying(): boolean {
    return this._activeGame !== null;
  }

  startGame(type: GameTypeValue, config: GameConfig): GameState {
    const game = GameRegistry.create(type, config);
    game.onStateChange = (gameType, state) => {
      this._emit(GameEvents.STATE, { type: gameType, state });
    };
    this._activeGame = game;
    const state = game.start(config);
    this._emit(GameEvents.START, { type, config, state });
    return state;
  }

  handleAction(action: GameAction, fromSlotId: string): GameState {
    if (!this._activeGame) {
      throw new Error("No active game");
    }
    const state = this._activeGame.handleAction(action, fromSlotId);
    this._emit(GameEvents.STATE, {
      type: this._activeGame.type,
      state,
    });
    return state;
  }

  endGame(reason?: string): void {
    if (this._activeGame) {
      this._emit(GameEvents.END, {
        type: this._activeGame.type,
        state: this._activeGame.getState(),
        reason,
      });
    }
    this._activeGame = null;
  }
}
