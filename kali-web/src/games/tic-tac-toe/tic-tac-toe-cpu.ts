import { ActionType } from "../core/constants/action-types";
import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import type { MoveProvider } from "../ai/ai-slot-filler";
import type { TicTacToeData } from "./tic-tac-toe-game";

export type Difficulty = "easy" | "medium" | "hard";

export class TicTacToeCPUPlayer implements MoveProvider {
  constructor(private _difficulty: Difficulty = "medium") {}

  async decide(state: GameState): Promise<GameAction> {
    const data = state.data as TicTacToeData;
    const board = data.board;
    const opponentMark = data.opponentMark;
    const playerMark = data.playerMark;

    const result = this._pickMove(board, opponentMark, playerMark);
    return {
      type: ActionType.MOVE,
      data: { row: result.move.row, col: result.move.col },
      reasoning: result.reasoning,
    };
  }

  private _pickMove(
    board: (string | null)[][],
    cpuMark: string,
    playerMark: string,
  ): { move: { row: number; col: number }; reasoning: string } {
    const empties = this._empties(board);
    const totalMoves = empties.length;

    switch (this._difficulty) {
      case "hard": {
        const mm = this._minimax(board, cpuMark, playerMark, cpuMark);
        const move = mm.move ?? empties[0];
        return {
          move,
          reasoning: `Evaluated ${totalMoves} moves via minimax. Best score: ${mm.score}. Chose (${move.row},${move.col}).`,
        };
      }
      case "medium": {
        const mm = this._minimax(board, cpuMark, playerMark, cpuMark);
        if (mm.move && Math.random() < 0.6) {
          return {
            move: mm.move,
            reasoning: `Evaluated ${totalMoves} moves. Best score: ${mm.score}. Chose optimal (${mm.move.row},${mm.move.col}) with 60% probability.`,
          };
        }
        const random = empties[Math.floor(Math.random() * empties.length)];
        return {
          move: random,
          reasoning: `Evaluated ${totalMoves} moves. Best score: ${mm.score}. Random roll failed 40% — chose (${random.row},${random.col}) randomly.`,
        };
      }
      case "easy":
      default: {
        const random = empties[Math.floor(Math.random() * empties.length)];
        return {
          move: random,
          reasoning: `Selected random move from ${totalMoves} available: (${random.row},${random.col}).`,
        };
      }
    }
  }

  private _empties(board: (string | null)[][]): { row: number; col: number }[] {
    const list: { row: number; col: number }[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (board[row][col] === null) list.push({ row, col });
      }
    }
    return list;
  }

  private _minimax(
    board: (string | null)[][],
    cpuMark: string,
    playerMark: string,
    currentMark: string,
  ): { score: number; move?: { row: number; col: number } } {
    const empties = this._empties(board);

    const win = this._checkWin(board, cpuMark);
    if (win) return { score: 10 };
    const loss = this._checkWin(board, playerMark);
    if (loss) return { score: -10 };
    if (empties.length === 0) return { score: 0 };

    const isMax = currentMark === cpuMark;
    let bestScore = isMax ? -Infinity : Infinity;
    let bestMove: { row: number; col: number } | undefined;

    for (const { row, col } of empties) {
      board[row][col] = currentMark;
      const { score } = this._minimax(board, cpuMark, playerMark, currentMark === cpuMark ? playerMark : cpuMark);
      board[row][col] = null;

      if (isMax) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = { row, col };
        }
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = { row, col };
        }
      }
    }

    return { score: bestScore, move: bestMove };
  }

  private _checkWin(board: (string | null)[][], mark: string): boolean {
    const lines = [
      [[0, 0], [0, 1], [0, 2]],
      [[1, 0], [1, 1], [1, 2]],
      [[2, 0], [2, 1], [2, 2]],
      [[0, 0], [1, 0], [2, 0]],
      [[0, 1], [1, 1], [2, 1]],
      [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[0, 2], [1, 1], [2, 0]],
    ];
    return lines.some((line) => line.every(([r, c]) => board[r][c] === mark));
  }
}
