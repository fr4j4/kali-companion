import type { BaseGame } from "../../games/core/base-game";
import type { GameSessionManager } from "../../games/core/game-session-manager";
import { GameWindow } from "./GameWindow";

interface Props {
  game: BaseGame;
  manager?: GameSessionManager;
  hasKali?: boolean;
  isMaximized?: boolean;
}

export function GameRenderer({ game, manager, hasKali, isMaximized }: Props) {
  return <GameWindow game={game} manager={manager} hasKali={hasKali} isMaximized={isMaximized} />;
}
