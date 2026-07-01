import type { SlotIdValue } from "../constants/player-types";
import type { ActionTypeValue, GameCommandValue } from "../constants/action-types";

export interface GameAction {
  readonly type?: ActionTypeValue;
  readonly command?: GameCommandValue;
  readonly data: unknown;
  readonly fromSlotId?: SlotIdValue;
}
