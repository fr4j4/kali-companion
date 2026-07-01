import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import { ActionType } from "../core/constants/action-types";

export class AIGenerator {
  constructor(
    private _llmProvider?: { complete: (prompt: string) => Promise<string> },
  ) {}

  async generateContent(context: GameState): Promise<GameAction> {
    if (!this._llmProvider) {
      return { type: ActionType.CUSTOM, data: null };
    }
    const prompt = this._buildPrompt(context);
    const response = await this._llmProvider.complete(prompt);
    return this._parseAction(response);
  }

  private _buildPrompt(state: GameState): string {
    return (
      "Eres Kali y debes generar contenido para este juego.\n" +
      `Contexto:\n${JSON.stringify(state, null, 2)}\n\n` +
      "Genera contenido interesante y variado. Responde con JSON."
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
