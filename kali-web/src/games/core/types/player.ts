import type { SlotIdValue, PlayerTypeValue } from "../constants/player-types";

export interface PlayerSlot {
  readonly id: SlotIdValue;
  readonly type: PlayerTypeValue;
  readonly name: string;
}
