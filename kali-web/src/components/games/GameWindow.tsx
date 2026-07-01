import type { BaseGame } from "../../games/core/base-game";
import { GameType } from "../../games/core/constants/game-types";
import { SnakeView } from "./SnakeView";
import { TwentyFortyEightView } from "./TwentyFortyEightView";
import type { SnakeGame } from "../../games/snake/snake-game";
import type { TwentyFortyEightGame } from "../../games/twenty-forty-eight/twenty-forty-eight-game";

interface Props {
  game: BaseGame;
}

export function GameWindow({ game }: Props) {
  switch (game.type) {
    case GameType.SNAKE:
      return <SnakeView game={game as SnakeGame} />;
    case GameType.TWENTY_FORTY_EIGHT:
      return <TwentyFortyEightView game={game as TwentyFortyEightGame} />;
    default:
      return (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 flex items-center justify-center text-muted">
            Game: {game.type} — Score: {game.getState().score}
          </div>
        </div>
      );
  }
}
