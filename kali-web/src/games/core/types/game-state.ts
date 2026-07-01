import type { GameStatusValue } from "../constants/game-status";

export interface GameState {
  readonly status: GameStatusValue;
  readonly score: number;
  readonly data: unknown;
  readonly winner: string | null;
}
