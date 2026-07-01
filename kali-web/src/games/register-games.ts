import { GameRegistry } from "./core/game-registry";
import { SnakeGame } from "./snake/snake-game";
import { GameType } from "./core/constants/game-types";

export function registerGames(): void {
  GameRegistry.register(GameType.SNAKE, SnakeGame as any);
}
