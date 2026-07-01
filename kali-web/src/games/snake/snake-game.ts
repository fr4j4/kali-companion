import type { GameConfig } from "../core/types/game-config";
import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import { BaseGame } from "../core/base-game";
import { GameType } from "../core/constants/game-types";
import { PlayerType, SlotId } from "../core/constants/player-types";
import { ActionType, GameCommand } from "../core/constants/action-types";
import { GameStatus } from "../core/constants/game-status";

interface Point {
  x: number;
  y: number;
}

type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

const BOARD_W = 20;
const BOARD_H = 20;
const TICK_INTERVAL_MS = 200;

export class SnakeGame extends BaseGame {
  readonly type = GameType.SNAKE;
  readonly slots = [
    { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
  ] as const;

  static readonly BOARD_W = BOARD_W;
  static readonly BOARD_H = BOARD_H;
  static readonly TICK_INTERVAL_MS = TICK_INTERVAL_MS;

  private snake: Point[] = [];
  private food: Point = { x: 0, y: 0 };
  private direction: Direction = "RIGHT";
  private nextDirection: Direction = "RIGHT";
  private _score = 0;

  start(_config?: GameConfig): GameState {
    this.snake = [{ x: Math.floor(BOARD_W / 2), y: Math.floor(BOARD_H / 2) }];
    this.direction = "RIGHT";
    this.nextDirection = "RIGHT";
    this._score = 0;
    this._spawnFood();

    this.state = {
      status: GameStatus.WAITING,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
    };

    return this.state;
  }

  begin(): void {
    this.state = {
      status: GameStatus.PLAYING,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
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

  restart(): void {
    this.start();
    this.begin();
  }

  giveUp(): void {
    this.state = {
      status: GameStatus.LOST,
      score: this._score,
      data: this._serializeBoard(),
      winner: "player",
    };
  }

  handleAction(action: GameAction, _fromSlotId: string): GameState {
    if (action.type === ActionType.COMMAND) {
      switch (action.data) {
        case GameCommand.START:
        case GameCommand.PLAY_AGAIN:
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
      }
    }

    if (
      this.state.status !== GameStatus.PLAYING ||
      action.type !== ActionType.MOVE ||
      typeof action.data !== "string"
    ) {
      return this.state;
    }

    const dir = action.data.toUpperCase() as Direction;
    if (this._isValidDirection(dir)) {
      this.nextDirection = dir;
    }

    return this.state;
  }

  tick(): void {
    if (this.state.status !== GameStatus.PLAYING) return;

    this.direction = this.nextDirection;
    const head = this.snake[0];
    const newHead = { ...head };

    switch (this.direction) {
      case "UP":    newHead.y -= 1; break;
      case "DOWN":  newHead.y += 1; break;
      case "LEFT":  newHead.x -= 1; break;
      case "RIGHT": newHead.x += 1; break;
    }

    if (newHead.x < 0 || newHead.x >= BOARD_W || newHead.y < 0 || newHead.y >= BOARD_H) {
      this._endGame();
      return;
    }

    if (this.snake.some((p) => p.x === newHead.x && p.y === newHead.y)) {
      this._endGame();
      return;
    }

    this.snake.unshift(newHead);

    if (newHead.x === this.food.x && newHead.y === this.food.y) {
      this._score += 10;
      this._spawnFood();
    } else {
      this.snake.pop();
    }

    this.state = {
      status: GameStatus.PLAYING,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
    };
  }

  private _endGame(): void {
    this.state = {
      status: GameStatus.LOST,
      score: this._score,
      data: this._serializeBoard(),
      winner: "player",
    };
  }

  private _spawnFood(): void {
    const occupied = new Set(this.snake.map((p) => `${p.x},${p.y}`));
    let p: Point;
    do {
      p = { x: Math.floor(Math.random() * BOARD_W), y: Math.floor(Math.random() * BOARD_H) };
    } while (occupied.has(`${p.x},${p.y}`));
    this.food = p;
  }

  private _isValidDirection(dir: Direction): boolean {
    const opposites: Record<Direction, Direction> = {
      UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT",
    };
    return dir !== opposites[this.direction];
  }

  private _serializeBoard() {
    return {
      board: { width: BOARD_W, height: BOARD_H },
      snake: this.snake,
      food: this.food,
      direction: this.direction,
      speed: TICK_INTERVAL_MS,
    };
  }
}
