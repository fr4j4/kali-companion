import { useTranslation } from "react-i18next";
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
  isMaximized?: boolean;
  focused?: boolean;
}

export function GameWindow({ game, manager, hasKali, isMaximized, focused }: Props) {
  const { t } = useTranslation();
  switch (game.type) {
    case GameType.SNAKE:
      return <SnakeView game={game as SnakeGame} isMaximized={isMaximized} focused={focused} />;
    case GameType.TWENTY_FORTY_EIGHT:
      return <TwentyFortyEightView game={game as TwentyFortyEightGame} isMaximized={isMaximized} focused={focused} />;
    case GameType.TIC_TAC_TOE:
      if (!manager) {
        return (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 flex items-center justify-center text-muted">
              {t("game_window.no_manager")}
            </div>
          </div>
        );
      }
      return <TicTacToeView game={game as TicTacToeGame} manager={manager} hasKali={hasKali ?? false} isMaximized={isMaximized} focused={focused} />;
    default:
      return (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 flex items-center justify-center text-muted">
            {t("game_window.fallback_score", { type: game.type, score: game.getState().score })}
          </div>
        </div>
      );
  }
}
