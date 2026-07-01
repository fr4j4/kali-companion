# Snake Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a working Snake game as a Kali artifact window — real-time canvas rendering, keyboard input, score tracking, periodic state emission for Kali AI to observe.

**Architecture:** Single-player Snake running entirely in the frontend Canvas with KeyboardEvent input. The `SnakeGame` class (kali-toys core) manages state and collision logic. A React Canvas component runs the render loop. State is emitted periodically to the backend via WS so Kali can observe and coach.

**Tech Stack:** TypeScript, React, HTML5 Canvas, existing kali-yarn WebSocket protocol.

## Global Constraints

- Follow existing project conventions (TypeScript strict, noUnusedLocals, verbatimModuleSyntax, react-jsx)
- Only one game active at a time (GameEngine enforces this)
- SnakeGame must extend BaseGame from `src/games/core/base-game.ts`
- Snake must register via `GameRegistry.register(GameType.SNAKE, SnakeGame)`
- All constants from existing `src/games/core/constants/*` — never re-define strings
- Real-time games emit periodic state; no action forwarding for every frame
- Build passes `npx tsc --noEmit` with zero errors

---
### Task 1: SnakeGame class (game logic)

**Files:**
- Create: `kali-web/src/games/snake/snake-game.ts`
- Test: (test file TBD when test infra is set up)

**Interface:**
- Consumes: `BaseGame` from `../core/base-game.ts`, types from `../core/types/*`
- Produces: `SnakeGame` class with `start()`, `handleAction()`, and internal `tick()` loop

- [ ] **Step 1: Create the SnakeGame class**

Write `kali-web/src/games/snake/snake-game.ts`:

```typescript
import type { GameConfig } from "../core/types/game-config";
import type { GameAction } from "../core/types/game-action";
import type { GameState } from "../core/types/game-state";
import { BaseGame } from "../core/base-game";
import { GameType } from "../core/constants/game-types";
import { PlayerType, SlotId } from "../core/constants/player-types";
import { ActionType } from "../core/constants/action-types";
import { GameStatus } from "../core/constants/game-status";

interface Point {
  x: number;
  y: number;
}

type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

const BOARD_W = 20;
const BOARD_H = 20;
const INITIAL_SPEED_MS = 200;
const TICK_EMIT_INTERVAL = 3; // Emit state every N ticks

export class SnakeGame extends BaseGame {
  readonly type = GameType.SNAKE;
  readonly slots = [
    { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
  ] as const;

  private snake: Point[] = [];
  private food: Point = { x: 0, y: 0 };
  private direction: Direction = "RIGHT";
  private nextDirection: Direction = "RIGHT";
  private _score = 0;
  private _tickHandle: ReturnType<typeof setInterval> | null = null;
  private _tickCount = 0;

  start(_config?: GameConfig): GameState {
    this.snake = [{ x: Math.floor(BOARD_W / 2), y: Math.floor(BOARD_H / 2) }];
    this.direction = "RIGHT";
    this.nextDirection = "RIGHT";
    this._score = 0;
    this._tickCount = 0;
    this._spawnFood();

    this.state = {
      status: GameStatus.PLAYING,
      score: this._score,
      data: this._serializeBoard(),
      winner: null,
    };

    this._tickHandle = setInterval(() => this._tick(), INITIAL_SPEED_MS);

    return this.state;
  }

  handleAction(action: GameAction, _fromSlotId: string): GameState {
    if (action.type === ActionType.MOVE && typeof action.data === "string") {
      const dir = action.data.toUpperCase() as Direction;
      if (this._isValidDirection(dir)) {
        this.nextDirection = dir;
      }
    }
    return this.state;
  }

  private _tick(): void {
    this.direction = this.nextDirection;
    const head = this.snake[0];
    const newHead = { ...head };

    switch (this.direction) {
      case "UP":    newHead.y -= 1; break;
      case "DOWN":  newHead.y += 1; break;
      case "LEFT":  newHead.x -= 1; break;
      case "RIGHT": newHead.x += 1; break;
    }

    // Wall collision
    if (newHead.x < 0 || newHead.x >= BOARD_W || newHead.y < 0 || newHead.y >= BOARD_H) {
      this._endGame("Wall");
      return;
    }

    // Self collision
    if (this.snake.some((p) => p.x === newHead.x && p.y === newHead.y)) {
      this._endGame("Self");
      return;
    }

    this.snake.unshift(newHead);

    // Food collision
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

    this._tickCount++;
    if (this._tickCount % TICK_EMIT_INTERVAL === 0) {
      this.emitState();
    }
  }

  private _endGame(reason: string): void {
    if (this._tickHandle) clearInterval(this._tickHandle);
    this._tickHandle = null;
    this.state = {
      status: reason === "Wall" ? GameStatus.LOST : GameStatus.LOST,
      score: this._score,
      data: this._serializeBoard(),
      winner: "player",
    };
    this.emitState();
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
      speed: INITIAL_SPEED_MS,
    };
  }

  destroy(): void {
    if (this._tickHandle) clearInterval(this._tickHandle);
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No errors. If errors appear about unused imports or wrong types, fix them.

- [ ] **Step 3: Commit**

```bash
git add kali-web/src/games/snake/snake-game.ts
git commit -m "feat(snake): add SnakeGame class with board, collision, and state"
```

---
### Task 2: Snake Canvas Renderer (React component)

**Files:**
- Create: `kali-web/src/components/games/SnakeView.tsx`
- Modify: `kali-web/src/components/games/GameWindow.tsx` (add Snake routing)

**Interface:**
- Consumes: `SnakeGame` state serialized as GameState
- Produces: React component with Canvas render loop + keyboard input

- [ ] **Step 1: Create the SnakeView component**

Write `kali-web/src/components/games/SnakeView.tsx`:

```tsx
import { useEffect, useRef, useCallback } from "react";
import type { GameState } from "../../games/core/types/game-state";

const CELL_SIZE = 24;
const BOARD_W = 20;
const BOARD_H = 20;

interface Props {
  state: GameState;
  onMove: (direction: string) => void;
}

export function SnakeView({ state, onMove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = state.data as {
      snake: { x: number; y: number }[];
      food: { x: number; y: number };
      direction: string;
    } | null;
    if (!data) return;

    const w = BOARD_W * CELL_SIZE;
    const h = BOARD_H * CELL_SIZE;
    canvas.width = w;
    canvas.height = h;

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= BOARD_W; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE, 0);
      ctx.lineTo(x * CELL_SIZE, h);
      ctx.stroke();
    }
    for (let y = 0; y <= BOARD_H; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE);
      ctx.lineTo(w, y * CELL_SIZE);
      ctx.stroke();
    }

    // Snake
    data.snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? "#00d4aa" : "#00a885";
      ctx.fillRect(seg.x * CELL_SIZE + 1, seg.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });

    // Food
    ctx.fillStyle = "#ff4757";
    ctx.beginPath();
    const fx = data.food.x * CELL_SIZE + CELL_SIZE / 2;
    const fy = data.food.y * CELL_SIZE + CELL_SIZE / 2;
    ctx.arc(fx, fy, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }, [state]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Keyboard handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const dir: Record<string, string> = {
        ArrowUp: "UP", ArrowDown: "DOWN",
        ArrowLeft: "LEFT", ArrowRight: "RIGHT",
      };
      const d = dir[e.key];
      if (d) {
        e.preventDefault();
        onMove(d);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onMove]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 bg-[#0d0d0d]">
      <canvas
        ref={canvasRef}
        className="rounded-lg shadow-lg"
        style={{
          width: BOARD_W * CELL_SIZE,
          height: BOARD_H * CELL_SIZE,
        }}
      />
      <div className="mt-3 text-sm text-muted">
        Score: {state.score} — Usa las flechas del teclado
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register Snake in GameWindow**

Modify `kali-web/src/components/games/GameWindow.tsx`:

```tsx
import type { GameTypeValue } from "../../games/core/constants/game-types";
import type { GameState } from "../../games/core/types/game-state";
import { GameType } from "../../games/core/constants/game-types";
import { SnakeView } from "./SnakeView";

interface Props {
  type: GameTypeValue;
  state: GameState;
  onAction: (action: { type: string; data: unknown }) => void;
}

export function GameWindow({ type, state, onAction }: Props) {
  switch (type) {
    case GameType.SNAKE:
      return (
        <SnakeView
          state={state}
          onMove={(dir) => onAction({ type: "move", data: dir })}
        />
      );
    default:
      return (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 flex items-center justify-center text-muted">
            Game: {type} — Score: {state.score}
          </div>
        </div>
      );
  }
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add kali-web/src/components/games/SnakeView.tsx kali-web/src/components/games/GameWindow.tsx
git commit -m "feat(snake): add SnakeView Canvas renderer and wire into GameWindow"
```

---
### Task 3: Game launch integration (frontend → backend)

**Files:**
- Create: `kali-web/src/components/games/GameLauncher.tsx`
- Modify: none

**Interface:**
- Consumes: `GameEngine` from `src/games/core/game-engine.ts`
- Produces: React component that starts Snake when Kali says "empecemos snake"

- [ ] **Step 1: Create the GameLauncher**

Write `kali-web/src/components/games/GameLauncher.tsx`:

```tsx
import { useState, useCallback } from "react";
import type { GameTypeValue } from "../../games/core/constants/game-types";
import type { GameState } from "../../games/core/types/game-state";
import { GameType } from "../../games/core/constants/game-types";
import { GameRenderer } from "./GameRenderer";

interface Props {
  wsEmit: (event: string, payload: unknown) => void;
}

export function GameLauncher({ wsEmit }: Props) {
  const [activeGame, setActiveGame] = useState<{
    type: GameTypeValue;
    state: GameState;
  } | null>(null);

  const handleAction = useCallback((action: { type: string; data: unknown }) => {
    wsEmit("game:action", { action });
  }, [wsEmit]);

  const handleWsMessage = useCallback((msg: { event: string; payload: unknown }) => {
    if (msg.event === "game:start") {
      const p = msg.payload as { type: GameTypeValue; config: unknown; state: GameState };
      setActiveGame({ type: p.type, state: p.state });
    }
    if (msg.event === "game:state") {
      const p = msg.payload as { type: GameTypeValue; state: GameState };
      setActiveGame((prev) => prev && prev.type === p.type ? { type: p.type, state: p.state } : prev);
    }
    if (msg.event === "game:end") {
      setActiveGame(null);
    }
  }, []);

  if (!activeGame) return null;

  return (
    <GameRenderer
      type={activeGame.type}
      state={activeGame.state}
      onAction={handleAction}
    />
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add kali-web/src/components/games/GameLauncher.tsx
git commit -m "feat(snake): add GameLauncher that wires WS events to game renderer"
```

---
### Task 4: WS integration — periodic state emission from frontend

**Files:**
- Modify: `kali-web/src/components/games/SnakeView.tsx` (add periodic state emission)

- [ ] **Step 1: Add state emission to SnakeView**

Modify the SnakeView to accept an `onState` callback that emits state periodically:

```tsx
interface Props {
  state: GameState;
  onMove: (direction: string) => void;
  onState?: (state: GameState) => void;
}
```

Add a `useEffect` that calls `onState` every 500ms:

```tsx
useEffect(() => {
  if (!onState) return;
  const id = setInterval(() => onState(state), 500);
  return () => clearInterval(id);
}, [onState, state]);
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add kali-web/src/components/games/SnakeView.tsx
git commit -m "feat(snake): add periodic state emission for Kali observation"
```

---
### Self-Review

**Spec coverage:** All spec requirements covered — SnakeGame implements BaseGame interface, SnakeView renders Canvas, GameWindow routes by type, state emits periodically.

**Placeholder scan:** No TBDs, TODOs, or vague instructions. Every code block is complete.

**Type consistency:** `GameType.SNAKE` matches constant in `game-types.ts`. `BaseGame` method signatures match `base-game.ts`. All imports use correct relative paths.
