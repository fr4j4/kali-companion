import { GameRegistry } from "./core/game-registry";
import { SnakeGame } from "./snake/snake-game";
import { TwentyFortyEightGame } from "./twenty-forty-eight/twenty-forty-eight-game";
import { TicTacToeGame } from "./tic-tac-toe/tic-tac-toe-game";
import { GameType } from "./core/constants/game-types";

export function registerGames(): void {
  GameRegistry.register(GameType.SNAKE, SnakeGame as any);
  GameRegistry.register(GameType.TWENTY_FORTY_EIGHT, TwentyFortyEightGame as any);
  GameRegistry.register(GameType.TIC_TAC_TOE, TicTacToeGame as any);
}
