import type { GameTypeValue } from "../../games/core/constants/game-types";
import type { GameState } from "../../games/core/types/game-state";
import { GameWindow } from "./GameWindow";

interface Props {
  type: GameTypeValue;
  state: GameState;
}

export function GameRenderer({ type, state }: Props) {
  return <GameWindow type={type} state={state} />;
}
