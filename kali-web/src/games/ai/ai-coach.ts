import type { GameState } from "../core/types/game-state";

export interface CoachingAdvice {
  readonly hint: string;
  readonly visual?: string;
}

export class AICoach {
  constructor(
    private _llmProvider?: { complete: (prompt: string) => Promise<string> },
  ) {}

  async advise(context: GameState): Promise<CoachingAdvice> {
    if (!this._llmProvider) {
      return { hint: "" };
    }
    const prompt = this._buildPrompt(context);
    const response = await this._llmProvider.complete(prompt);
    return { hint: response };
  }

  private _buildPrompt(state: GameState): string {
    return (
      "Eres Kali y estas observando un juego.\n" +
      `Estado actual:\n${JSON.stringify(state, null, 2)}\n\n` +
      "Da un consejo util y corto al jugador."
    );
  }
}
