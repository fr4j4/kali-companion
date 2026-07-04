import { describe, it, expect } from "vitest";
import { TicTacToeGame } from "../../tic-tac-toe/tic-tac-toe-game";
import { SnakeGame } from "../../snake/snake-game";
import { TwentyFortyEightGame } from "../../twenty-forty-eight/twenty-forty-eight-game";
import { GameStatus } from "../constants/game-status";
import { ActionType, GameCommand } from "../constants/action-types";
import { SlotId } from "../constants/player-types";
import type { GameConfig } from "../types/game-config";

function config(game: { slots: readonly { id: string; type: string; name: string }[] }, rules?: Record<string, unknown>): GameConfig {
  return { slots: game.slots as any, rules };
}

describe("BaseGame.isFinished() default implementation", () => {
  describe("TicTacToeGame", () => {
    it("returns false while playing", () => {
      const game = new TicTacToeGame();
      game.start(config(game, { mode: "cpu" }));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      expect(game.getStatus()).toBe(GameStatus.PLAYING);
      expect(game.isFinished()).toBe(false);
    });

    it("returns true after a win", () => {
      const game = new TicTacToeGame();
      game.start(config(game, { mode: "cpu" }));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      // Player X wins top row
      game.handleAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } }, SlotId.PLAYER);
      game.handleAction({ type: ActionType.MOVE, data: { row: 1, col: 0 } }, SlotId.OPPONENT);
      game.handleAction({ type: ActionType.MOVE, data: { row: 0, col: 1 } }, SlotId.PLAYER);
      game.handleAction({ type: ActionType.MOVE, data: { row: 1, col: 1 } }, SlotId.OPPONENT);
      game.handleAction({ type: ActionType.MOVE, data: { row: 0, col: 2 } }, SlotId.PLAYER);
      expect(game.getStatus()).toBe(GameStatus.WON);
      expect(game.isFinished()).toBe(true);
    });

    it("returns true after a draw", () => {
      const game = new TicTacToeGame();
      game.start(config(game, { mode: "cpu" }));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      // Fill board with no winner: X O X / X O O / O X X
      const moves: [string, number, number][] = [
        [SlotId.PLAYER, 0, 0],
        [SlotId.OPPONENT, 0, 1],
        [SlotId.PLAYER, 0, 2],
        [SlotId.OPPONENT, 1, 1],
        [SlotId.PLAYER, 1, 0],
        [SlotId.OPPONENT, 1, 2],
        [SlotId.PLAYER, 2, 1],
        [SlotId.OPPONENT, 2, 0],
        [SlotId.PLAYER, 2, 2],
      ];
      for (const [slot, r, c] of moves) {
        game.handleAction({ type: ActionType.MOVE, data: { row: r, col: c } }, slot);
      }
      expect(game.getStatus()).toBe(GameStatus.DRAW);
      expect(game.isFinished()).toBe(true);
    });

    it("returns true after give up", () => {
      const game = new TicTacToeGame();
      game.start(config(game, { mode: "cpu" }));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.GIVE_UP }, SlotId.PLAYER);
      expect(game.getStatus()).toBe(GameStatus.ABANDONED);
      expect(game.isFinished()).toBe(true);
    });
  });

  describe("SnakeGame", () => {
    it("returns false while playing", () => {
      const game = new SnakeGame();
      game.start(config(game));
      game.begin();
      expect(game.getStatus()).toBe(GameStatus.PLAYING);
      expect(game.isFinished()).toBe(false);
    });

    it("returns true after losing (collision)", () => {
      const game = new SnakeGame();
      game.start(config(game));
      game.begin();
      // Force the snake to collide with the wall by moving right until it hits the edge.
      // The board is 20 wide, snake starts at x=10 moving right.
      // We can't easily force a collision via actions (direction only),
      // so simulate via tick() until the game ends.
      for (let i = 0; i < 100 && game.getStatus() === GameStatus.PLAYING; i++) {
        game.tick();
      }
      // Snake should have hit the wall by now.
      expect(game.getStatus()).toBe(GameStatus.LOST);
      expect(game.isFinished()).toBe(true);
    });
  });

  describe("TwentyFortyEightGame", () => {
    it("returns false while playing", () => {
      const game = new TwentyFortyEightGame();
      game.start(config(game));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      expect(game.getStatus()).toBe(GameStatus.PLAYING);
      expect(game.isFinished()).toBe(false);
    });

    it("returns true after give up", () => {
      const game = new TwentyFortyEightGame();
      game.start(config(game));
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.START }, SlotId.PLAYER);
      game.handleAction({ type: ActionType.COMMAND, data: GameCommand.GIVE_UP }, SlotId.PLAYER);
      expect(game.getStatus()).toBe(GameStatus.ABANDONED);
      expect(game.isFinished()).toBe(true);
    });
  });
});