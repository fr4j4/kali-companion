import type { BaseGame } from "../../games/core/base-game";
import type { GameSessionManager } from "../../games/core/game-session-manager";
import { GameRenderer } from "./GameRenderer";

interface Props {
  game: BaseGame;
  manager?: GameSessionManager;
  hasKali?: boolean;
}

export function GameLauncher({ game, manager, hasKali }: Props) {
  return <GameRenderer game={game} manager={manager} hasKali={hasKali} />;
}
