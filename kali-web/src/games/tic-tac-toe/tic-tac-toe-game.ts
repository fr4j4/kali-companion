import type { GameConfig } from "../core/types/game-config";
import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import { BaseGame } from "../core/base-game";
import { GameType } from "../core/constants/game-types";
import { PlayerType, SlotId } from "../core/constants/player-types";
import { ActionType, GameCommand } from "../core/constants/action-types";
import { GameStatus } from "../core/constants/game-status";

export type Mark = "X" | "O";
export type Difficulty = "easy" | "medium" | "hard";

export interface TicTacToeData {
  board: (Mark | null)[][];
  currentSlot: string;
  winner: string | null;
  winningLine: [number, number][] | null;
  starter: string;
  playerMark: Mark;
  opponentMark: Mark;
  difficulty: Difficulty;
  mode: "cpu" | "kali";
}

function createEmptyBoard(): (Mark | null)[][] {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null));
}

const WIN_LINES: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];

export class TicTacToeGame extends BaseGame {
  readonly type = GameType.TIC_TAC_TOE;
  readonly paradigm = "turn-based" as const;
  readonly slots = [
    { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
    { id: SlotId.OPPONENT, type: PlayerType.AI, name: "Oponente" },
  ] as const;

  private _board: (Mark | null)[][] = createEmptyBoard();
  private _currentSlot: string = SlotId.PLAYER;
  private _winner: string | null = null;
  private _winningLine: [number, number][] | null = null;
  private _starter: string = SlotId.PLAYER;
  private _mode: "cpu" | "kali" = "cpu";
  private _difficulty: Difficulty = "medium";

  start(config?: GameConfig): GameState {
    this.newGame();
    this._board = createEmptyBoard();
    this._winner = null;
    this._winningLine = null;

    const rules = config?.rules ?? {};
    this._starter = rules.starter === SlotId.OPPONENT ? SlotId.OPPONENT : SlotId.PLAYER;
    this._currentSlot = this._starter;
    this._mode = rules.mode === "kali" ? "kali" : "cpu";
    this._difficulty = this._isDifficulty(rules.difficulty) ? rules.difficulty : "medium";

    this.state = {
      status: GameStatus.WAITING,
      score: 0,
      data: this._serializeBoard(),
      winner: null,
    };

    return this.state;
  }

  begin(): void {
    if (this.state.status !== GameStatus.WAITING) return;
    this.state = {
      ...this.state,
      status: GameStatus.PLAYING,
    };
  }

  pause(): void {
    if (this.state.status !== GameStatus.PLAYING) return;
    this.state = {
      ...this.state,
      status: GameStatus.PAUSED,
    };
  }

  resume(): void {
    if (this.state.status !== GameStatus.PAUSED) return;
    this.state = {
      ...this.state,
      status: GameStatus.PLAYING,
    };
  }

  restart(config?: GameConfig): void {
    this.start(config);
    this.begin();
  }

  giveUp(): void {
    this.state = {
      status: GameStatus.LOST,
      score: 0,
      data: this._serializeBoard(),
      winner: SlotId.OPPONENT,
    };
  }

  handleAction(action: GameAction, fromSlotId: string): GameState {
    if (action.type === ActionType.COMMAND) {
      switch (action.data) {
        case GameCommand.START:
          this.begin();
          return this.state;
        case GameCommand.PLAY_AGAIN:
        case GameCommand.RESTART:
          this.restart();
          return this.state;
        case GameCommand.PAUSE:
          this.pause();
          return this.state;
        case GameCommand.RESUME:
          this.resume();
          return this.state;
        case GameCommand.GIVE_UP:
          this.giveUp();
          return this.state;
        default:
          return this.state;
      }
    }

    if (
      this.state.status !== GameStatus.PLAYING ||
      action.type !== ActionType.MOVE ||
      typeof action.data !== "object" ||
      action.data === null ||
      fromSlotId !== this._currentSlot
    ) {
      return this.state;
    }

    const { row, col } = action.data as { row: unknown; col: unknown };
    if (!this._isValidMove(row, col)) return this.state;

    const mark = fromSlotId === SlotId.PLAYER ? "X" : "O";
    this._board[row as number][col as number] = mark;

    const win = this._checkWin(mark);
    if (win) {
      this._winner = fromSlotId;
      this._winningLine = win;
      this.state = {
        status: GameStatus.WON,
        score: 0,
        data: this._serializeBoard(),
        winner: fromSlotId,
      };
      return this.state;
    }

    if (this._isBoardFull()) {
      this.state = {
        status: GameStatus.DRAW,
        score: 0,
        data: this._serializeBoard(),
        winner: null,
      };
      return this.state;
    }

    this._currentSlot = this._currentSlot === SlotId.PLAYER ? SlotId.OPPONENT : SlotId.PLAYER;
    this.state = {
      status: GameStatus.PLAYING,
      score: 0,
      data: this._serializeBoard(),
      winner: null,
    };
    return this.state;
  }

  get mode(): "cpu" | "kali" {
    return this._mode;
  }

  get difficulty(): Difficulty {
    return this._difficulty;
  }

  get currentSlot(): string {
    return this._currentSlot;
  }

  private _isDifficulty(value: unknown): value is Difficulty {
    return typeof value === "string" && ["easy", "medium", "hard"].includes(value);
  }

  private _isValidMove(row: unknown, col: unknown): boolean {
    if (typeof row !== "number" || typeof col !== "number") return false;
    if (row < 0 || row > 2 || col < 0 || col > 2) return false;
    return this._board[row][col] === null;
  }

  private _checkWin(mark: Mark): [number, number][] | null {
    for (const line of WIN_LINES) {
      if (line.every(([r, c]) => this._board[r][c] === mark)) {
        return line;
      }
    }
    return null;
  }

  private _isBoardFull(): boolean {
    return this._board.every((row) => row.every((cell) => cell !== null));
  }

  private _serializeBoard(): TicTacToeData {
    return {
      board: this._board.map((row) => [...row]),
      currentSlot: this._currentSlot,
      winner: this._winner,
      winningLine: this._winningLine,
      starter: this._starter,
      playerMark: "X",
      opponentMark: "O",
      difficulty: this._difficulty,
      mode: this._mode,
    };
  }
}
