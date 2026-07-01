import type { PlayerSlot } from "./player";

export interface GameConfig {
  readonly slots: readonly PlayerSlot[];
  readonly rules?: Readonly<Record<string, unknown>>;
}
