import type { BaseGame } from "../../games/core/base-game";
import { GameWindow } from "./GameWindow";

interface Props {
  game: BaseGame;
}

export function GameRenderer({ game }: Props) {
  return <GameWindow game={game} />;
}
