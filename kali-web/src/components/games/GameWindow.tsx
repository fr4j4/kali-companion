import type { BaseGame } from "../../games/core/base-game";
import type { GameSessionManager } from "../../games/core/game-session-manager";
import { GameType } from "../../games/core/constants/game-types";
import { SnakeView } from "./SnakeView";
import { TwentyFortyEightView } from "./TwentyFortyEightView";
import { TicTacToeView } from "./TicTacToeView";
import type { SnakeGame } from "../../games/snake/snake-game";
import type { TwentyFortyEightGame } from "../../games/twenty-forty-eight/twenty-forty-eight-game";
import type { TicTacToeGame } from "../../games/tic-tac-toe/tic-tac-toe-game";

interface Props {
  game: BaseGame;
  manager?: GameSessionManager;
  hasKali?: boolean;
}

export function GameWindow({ game, manager, hasKali }: Props) {
  switch (game.type) {
    case GameType.SNAKE:
      return <SnakeView game={game as SnakeGame} />;
    case GameType.TWENTY_FORTY_EIGHT:
      return <TwentyFortyEightView game={game as TwentyFortyEightGame} />;
    case GameType.TIC_TAC_TOE:
      if (!manager) {
        return (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 flex items-center justify-center text-muted">
              Game session manager not available
            </div>
          </div>
        );
      }
      return <TicTacToeView game={game as TicTacToeGame} manager={manager} hasKali={hasKali ?? false} />;
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
