import type { GameTypeValue } from "../../games/core/constants/game-types";
import type { GameState } from "../../games/core/types/game-state";

interface Props {
  type: GameTypeValue;
  state: GameState;
}

export function GameWindow({ type, state }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 flex items-center justify-center text-muted">
        Game: {type} — Score: {state.score}
      </div>
    </div>
  );
}
