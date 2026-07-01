import type { BaseGame } from "../../games/core/base-game";
import { GameRenderer } from "./GameRenderer";

interface Props {
  game: BaseGame;
}

export function GameLauncher({ game }: Props) {
  return <GameRenderer game={game} />;
}
