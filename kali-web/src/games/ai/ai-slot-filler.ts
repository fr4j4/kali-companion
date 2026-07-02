import type { GameTypeValue } from "../core/constants/game-types";
import type { SlotIdValue } from "../core/constants/player-types";
import type { GameState } from "../core/types/game-state";
import type { GameAction } from "../core/types/game-action";

export interface MoveProvider {
  /** Decide the next action for the occupied slot. */
  decide(
    state: GameState,
    onReasoning?: (chunk: string) => void,
  ): Promise<GameAction>;
}

/**
 * AISlotFiller — central registry that connects AI providers to game slots.
 *
 * Games declare AI slots but never know which implementation fills them.
 * The view (or future Kali Toys orchestrator) registers a MoveProvider for a
 * given game type + slot id. When it is the slot's turn, the view asks the
 * filler for the next action and forwards it to the game engine.
 */
export class AISlotFiller {
  private _providers = new Map<string, MoveProvider>();

  private _key(gameType: GameTypeValue, slotId: SlotIdValue): string {
    return `${gameType}:${slotId}`;
  }

  fill(gameType: GameTypeValue, slotId: SlotIdValue, provider: MoveProvider): void {
    this._providers.set(this._key(gameType, slotId), provider);
  }

  clear(gameType: GameTypeValue, slotId: SlotIdValue): void {
    this._providers.delete(this._key(gameType, slotId));
  }

  get(gameType: GameTypeValue, slotId: SlotIdValue): MoveProvider | null {
    return this._providers.get(this._key(gameType, slotId)) ?? null;
  }

  isFilled(gameType: GameTypeValue, slotId: SlotIdValue): boolean {
    return this._providers.has(this._key(gameType, slotId));
  }
}

export const aiSlotFiller = new AISlotFiller();
