import type { GameConfig } from "../core/types/game-config";
import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import { BaseGame } from "../core/base-game";
import { GameType } from "../core/constants/game-types";
import { PlayerType, SlotId } from "../core/constants/player-types";
import { ActionType, GameCommand } from "../core/constants/action-types";
import { GameStatus } from "../core/constants/game-status";

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type BoardSize = 3 | 4 | 5 | 6;

export interface Tile {
  value: number;
  id: number;
}

export interface TilePosition {
  row: number;
  col: number;
}

export interface BoardData {
  size: BoardSize;
  cells: (Tile | null)[][];
  score: number;
  bestTile: number;
  moves: number;
  won: boolean;
  over: boolean;
  lastSpawned: TilePosition | null;
  mergedIds: number[];
  prevPositions: Record<number, TilePosition>;
  newIds: number[];
}

const DEFAULT_SIZE: BoardSize = 4;
const WIN_VALUE = 2048;

function createEmptyBoard(size: number): (Tile | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function cloneBoard(cells: (Tile | null)[][]): (Tile | null)[][] {
  return cells.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

let _tileId = 1;
function nextTileId(): number {
  return _tileId++;
}

export class TwentyFortyEightGame extends BaseGame {
  readonly type = GameType.TWENTY_FORTY_EIGHT;
  readonly paradigm = "turn-based" as const;
  readonly slots = [
    { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
  ] as const;

  private _size: BoardSize = DEFAULT_SIZE;
  private _cells: (Tile | null)[][] = [];
  private _score = 0;
  private _moves = 0;
  private _won = false;
  private _over = false;
  private _lastSpawned: TilePosition | null = null;
  private _mergedIds: number[] = [];
  private _prevPositions: Record<number, TilePosition> = {};
  private _newIds: number[] = [];

  start(config?: GameConfig): GameState {
    const requestedSize = this._resolveSize(config);
    this._size = requestedSize;
    this._cells = createEmptyBoard(this._size);
    this._score = 0;
    this._moves = 0;
    this._won = false;
    this._over = false;
    this._lastSpawned = null;
    this._mergedIds = [];
    this._prevPositions = {};
    this._newIds = [];
    _tileId = 1;

    const first = this._spawnTile();
    const second = this._spawnTile();
    this._newIds = first && second ? [first.id, second.id] : [];


    this.state = {
      status: GameStatus.WAITING,
      score: this._score,
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

  restart(size?: BoardSize): void {
    const config: GameConfig | undefined = size
      ? { slots: this.slots as unknown as readonly import("../core/types/player").PlayerSlot[], rules: { size } }
      : undefined;
    this.start(config);
    this.begin();
  }

  giveUp(): void {
    this._over = true;
    this.state = {
      status: GameStatus.LOST,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
    };
  }

  handleAction(action: GameAction, _fromSlotId: string): GameState {
    if (action.type === ActionType.COMMAND) {
      switch (action.data) {
        case GameCommand.START:
          this.begin();
          return this.state;
        case GameCommand.PLAY_AGAIN:
        case GameCommand.RESTART:
          this.restart(this._size);
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
      typeof action.data !== "string"
    ) {
      return this.state;
    }

    const dir = action.data.toUpperCase() as Direction;
    if (!this._isValidDirection(dir)) return this.state;

    return this._move(dir);
  }

  get size(): BoardSize {
    return this._size;
  }

  getScore(): number {
    return this._score;
  }

  getMoves(): number {
    return this._moves;
  }

  private _resolveSize(config?: GameConfig): BoardSize {
    const rulesSize = config?.rules?.size;
    if (typeof rulesSize === "number") {
      const allowed: BoardSize[] = [3, 4, 5, 6];
      if (allowed.includes(rulesSize as BoardSize)) return rulesSize as BoardSize;
    }
    if (typeof rulesSize === "string") {
      const parsed = Number.parseInt(rulesSize, 10);
      const allowed: BoardSize[] = [3, 4, 5, 6];
      if (allowed.includes(parsed as BoardSize)) return parsed as BoardSize;
    }
    return DEFAULT_SIZE;
  }

  private _isValidDirection(dir: string): dir is Direction {
    return ["UP", "DOWN", "LEFT", "RIGHT"].includes(dir);
  }

  private _move(dir: Direction): GameState {
    this._mergedIds = [];
    this._prevPositions = this._buildPositionMap(this._cells);
    this._newIds = [];
    const result = this._slide(dir);

    if (!result.changed) {
      this._prevPositions = {};
      this.state = {
        ...this.state,
        data: this._serializeBoard(),
      };
      return this.state;
    }

    this._cells = result.cells;
    this._score += result.scoreDelta;
    this._moves += 1;
    this._lastSpawned = this._spawnTile();

    if (!this._won && result.reached2048) {
      this._won = true;
    }

    const canMove = this._hasAvailableMoves();
    if (!canMove) {
      this._over = true;
    }

    const status = this._over ? GameStatus.LOST : this._won ? GameStatus.WON : GameStatus.PLAYING;

    this.state = {
      status,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
    };

    this._prevPositions = {};
    this._newIds = [];

    return this.state;
  }

  private _buildPositionMap(cells: (Tile | null)[][]): Record<number, TilePosition> {
    const map: Record<number, TilePosition> = {};
    for (let row = 0; row < cells.length; row++) {
      for (let col = 0; col < cells[row].length; col++) {
        const tile = cells[row][col];
        if (tile) map[tile.id] = { row, col };
      }
    }
    return map;
  }

  private _slide(dir: Direction): { cells: (Tile | null)[][]; changed: boolean; scoreDelta: number; reached2048: boolean } {
    const size = this._size;
    const newCells = createEmptyBoard(size);
    let changed = false;
    let scoreDelta = 0;
    let reached2048 = false;

    for (let i = 0; i < size; i++) {
      let line: Tile[] = [];
      for (let j = 0; j < size; j++) {
        const row = dir === "UP" || dir === "DOWN" ? j : i;
        const col = dir === "UP" || dir === "DOWN" ? i : j;
        const actualRow = dir === "DOWN" ? size - 1 - row : row;
        const actualCol = dir === "RIGHT" ? size - 1 - col : col;
        const tile = this._cells[actualRow][actualCol];
        if (tile) line.push(tile);
      }

      const merged: Tile[] = [];
      let k = 0;
      while (k < line.length) {
        const current = line[k];
        const next = line[k + 1];
        if (next && current.value === next.value) {
          const mergedValue = current.value * 2;
          const mergedTile: Tile = { value: mergedValue, id: nextTileId() };
          merged.push(mergedTile);
          this._mergedIds.push(current.id, next.id);
          scoreDelta += mergedValue;
          if (mergedValue >= WIN_VALUE) reached2048 = true;
          k += 2;
        } else {
          merged.push({ ...current });
          k += 1;
        }
      }

      while (merged.length < size) {
        merged.push(null as unknown as Tile);
      }

      for (let j = 0; j < size; j++) {
        const row = dir === "UP" || dir === "DOWN" ? j : i;
        const col = dir === "UP" || dir === "DOWN" ? i : j;
        const actualRow = dir === "DOWN" ? size - 1 - row : row;
        const actualCol = dir === "RIGHT" ? size - 1 - col : col;

        const prevTile = this._cells[actualRow][actualCol];
        const newTile = merged[j] ? { ...merged[j], id: merged[j].id } : null;
        newCells[actualRow][actualCol] = newTile;

        if (
          (prevTile === null && newTile !== null) ||
          (prevTile !== null && newTile === null) ||
          (prevTile && newTile && (prevTile.value !== newTile.value || prevTile.id !== newTile.id))
        ) {
          changed = true;
        }
      }
    }

    return { cells: newCells, changed, scoreDelta, reached2048 };
  }

  private _spawnTile(): Tile & TilePosition | null {
    const size = this._size;
    const empties: TilePosition[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!this._cells[row][col]) empties.push({ row, col });
      }
    }
    if (empties.length === 0) return null;
    const spot = empties[Math.floor(Math.random() * empties.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile: Tile = { value, id: nextTileId() };
    this._cells[spot.row][spot.col] = tile;
    this._newIds.push(tile.id);
    return { ...tile, ...spot };
  }

  private _hasAvailableMoves(): boolean {
    const size = this._size;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const tile = this._cells[row][col];
        if (!tile) return true;
        const right = col + 1 < size ? this._cells[row][col + 1] : null;
        const down = row + 1 < size ? this._cells[row + 1][col] : null;
        if ((right && right.value === tile.value) || (down && down.value === tile.value)) return true;
      }
    }
    return false;
  }

  private _serializeBoard(): BoardData {
    const bestTile = this._cells.flat().reduce((max, cell) => Math.max(max, cell?.value ?? 0), 0);
    return {
      size: this._size,
      cells: cloneBoard(this._cells),
      score: this._score,
      bestTile,
      moves: this._moves,
      won: this._won,
      over: this._over,
      lastSpawned: this._lastSpawned,
      mergedIds: [...this._mergedIds],
      prevPositions: { ...this._prevPositions },
      newIds: [...this._newIds],
    };
  }
}
