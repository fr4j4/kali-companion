import type { SlotIdValue } from "../core/constants/player-types";
import type { GameState } from "../core/types/game-state";
import type { GameAction } from "../core/types/game-action";
import { ActionType } from "../core/constants/action-types";

export class AISlot {
  constructor(
    private _slotId: SlotIdValue,
    private _llmProvider?: { complete: (prompt: string) => Promise<string> },
  ) {}

  get slotId(): SlotIdValue {
    return this._slotId;
  }

  async decide(context: GameState): Promise<GameAction> {
    if (!this._llmProvider) {
      return { type: ActionType.CUSTOM, data: null };
    }
    const prompt = this._buildPrompt(context);
    const response = await this._llmProvider.complete(prompt);
    return this._parseAction(response);
  }

  private _buildPrompt(state: GameState): string {
    return (
      `Eres Kali y ocupas el slot "${this._slotId}" en un juego.\n` +
      `Estado actual del juego:\n${JSON.stringify(state, null, 2)}\n\n` +
      "Decide tu siguiente accion. Responde solo con JSON valido."
    );
  }

  private _parseAction(response: string): GameAction {
    try {
      return JSON.parse(response) as GameAction;
    } catch {
      return { type: ActionType.CUSTOM, data: response };
    }
  }
}
