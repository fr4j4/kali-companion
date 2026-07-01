# Kali-Toys — Games Module Design

> **Component name:** kali-toys (the cat's toys — games, play, and interactive content).
> **Status:** Spec.
> **Last updated:** 2026-06-30.

## Overview

kali-toys is a new module that brings interactive games to Kali. It supports four
game archetypes — single-player, versus (player vs Kali), cooperative
(player + Kali), and trivia/quiz (Kali generates content) — all rendered as
artifacts on the NeuralCanvas and communicating via the existing kali-yarn
WebSocket protocol.

The module is split into a backend engine (Python, in `kali-core`) and a
frontend renderer (TypeScript/React, in `kali-web`), following the existing
Kali architecture. Only one game is active at a time.

## Architecture

```
kali-toys/
├── core/                       ← Shared types and constants (TypeScript)
│   ├── constants/
│   │   ├── events.ts           ← GameEvents (ws event names)
│   │   ├── player-types.ts     ← PlayerType (human, ai, content)
│   │   ├── action-types.ts     ← ActionType (select, move, text, command)
│   │   └── game-status.ts      ← GameStatus (playing, won, lost, ...)
│   ├── types/
│   │   ├── player.ts           ← PlayerSlot
│   │   ├── game-config.ts      ← GameConfig
│   │   ├── game-action.ts      ← GameAction
│   │   └── game-state.ts       ← GameState
│   ├── base-game.ts            ← BaseGame (abstract class)
│   └── game-engine.ts          ← GameEngine (centralized, one active game)
├── games/                      ← Game implementations
│   ├── snake/
│   ├── tictactoe/
│   ├── trivia/
│   └── ...
├── ai/
│   ├── ai-slot.ts              ← Kali occupies a slot (versus / cooperative)
│   ├── ai-generator.ts         ← Kali generates content (trivia)
│   └── ai-coach.ts             ← Kali helps without playing
└── tools/
    └── games.py                ← Tools for kali-mind (game_start, game_action)
```

### Layers

| Layer | Location | Language | Responsibility |
|-------|----------|----------|----------------|
| **Engine core** | `kali-toys/core/` | TypeScript | BaseGame, GameEngine, types, constants |
| **Game logic** | `kali-toys/games/*/` | TypeScript | Game-specific rules and state |
| **AI integration** | `kali-toys/ai/` | TypeScript | Kali fills player slots or generates content |
| **Agent tools** | `kali-core/.../tools/games.py` | Python | Bridge between kali-mind and game engine |
| **Rendering** | `kali-web/src/components/games/` | TypeScript/React | Canvas, Grid, and Widget renderers |
| **Protocol** | Existing kali-yarn | WS JSON | Events with `game:*` prefix |

## Player Slots

Each game declares its player slots. A slot is a seat at the table:
who plays and what role they take.

```typescript
// core/types/player.ts
export const PlayerType = {
  HUMAN: "human",       // Real person
  AI: "ai",             // Kali as an active participant
  CONTENT: "content",   // Kali as content generator (not a player)
} as const;

export type PlayerTypeValue = typeof PlayerType[keyof typeof PlayerType];

export const SlotId = {
  PLAYER: "player",       // The human player
  OPPONENT: "opponent",   // AI plays against
  TEAMMATE: "teammate",   // AI plays alongside
  PLAYER2: "player2",     // Second human (local multiplayer)
} as const;

export type SlotIdValue = typeof SlotId[keyof typeof SlotId];

export interface PlayerSlot {
  readonly id: SlotIdValue;
  readonly type: PlayerTypeValue;
  readonly name: string;
}
```

### Slot configurations per archetype

| Archetype | Slots | Kali's role |
|-----------|-------|-------------|
| **Single player** | `[player]` | Observes, may coach |
| **Versus** | `[player, opponent]` | Active opponent |
| **Cooperative** | `[player, teammate]` | Plays alongside |
| **Trivia** | `[player]` | Generates questions |
| **Local 2P** | `[player, player2]` | None |

## Game Actions

Two categories of actions keep the interface clean:

### 1. Game commands (control flow, same for all games)

```typescript
export const GameCommand = {
  START: "start",
  RESTART: "restart",
  PAUSE: "pause",
  RESUME: "resume",
  GIVE_UP: "give_up",
  PLAY_AGAIN: "play_again",
  REQUEST_HINT: "request_hint",
} as const;

export type GameCommandValue = typeof GameCommand[keyof typeof GameCommand];
```

### 2. Game actions (game-specific interaction)

```typescript
export const ActionType = {
  SELECT: "select",   // Choose from N options (trivia, story, RPS)
  MOVE: "move",       // Direction or position (tic-tac-toe, chess, 2048)
  TEXT: "text",       // Free text (wordle, code guess, math challenge)
  COMMAND: "command", // Game control (restart, pause, give_up)
  CUSTOM: "custom",   // Anything that doesn't fit above
} as const;

export type ActionTypeValue = typeof ActionType[keyof typeof ActionType];
```

**Interpretation depends on the game (single dispatch via ActionType + game type):**

```
Game         Type       Data
─────────────────────────────────────
Trivia       select     { option: 2 }
RPS          select     { choice: "rock" }
Memory       select     { cardIndex: 4 }
Story        select     { path: "go_left" }

TicTacToe    move       { row: 0, col: 1 }
2048         move       { direction: "right" }
Chess        move       { from: "e2", to: "e4" }

Wordle       text       { word: "HOUSE" }
CodeGuess    text       { answer: "42" }
```

### Real-time vs turn-based

| Type | Game loop location | State flow |
|------|-------------------|------------|
| **Real-time** (Snake, Breakout) | Frontend Canvas | Periodic `game:state` snapshots to backend |
| **Turn-based** (TicTacToe, Trivia) | Backend engine | Discrete `game:action` + `game:state` per turn |

Real-time games send periodic state snapshots so Kali can observe and respond
("estás a punto de chocar — gira a la izquierda") without the backend needing
to process every frame.

## Base Game Interface

```typescript
// core/base-game.ts
export abstract class BaseGame {
  abstract readonly type: GameTypeValue;
  abstract readonly slots: ReadonlyArray<PlayerSlot>;

  abstract start(config?: GameConfig): GameState;
  abstract handleAction(action: GameAction, fromSlotId: SlotIdValue): GameState;

  pause(): void {}
  resume(): void {}
  tick(): void {}

  getState(): GameState { return this._state; }
  getStatus(): GameStatusValue { return this._state.status; }
  get version(): number { return this._version; }
  get prevData(): unknown { return this._prevData; }

  readonly onStateChange?: (type: GameTypeValue, state: GameState) => void;
}
```

`tick()` is optional (default no-op) and used by real-time games such as Snake or Breakout. `prevData` exposes a deep clone of the previous state's `data` so that renderers can interpolate smoothly between the last tick and the current one.

> **Important:** Games that use interpolation must **not mutate their serialized data in-place**. For example, a Snake game must create a new snake array on every tick rather than `unshift`/`pop` on the same array. If the previous `state.data` points to a mutated array, `prevData` becomes identical to the current data and interpolation will not work.

## Game Engine

```typescript
// core/game-engine.ts
export class GameEngine {
  private _activeGame: BaseGame | null = null;

  get activeGame(): BaseGame | null { return this._activeGame; }
  get isPlaying(): boolean { return this._activeGame !== null; }

  startGame(type: GameTypeValue, config: GameConfig): GameState {
    this._activeGame = GameRegistry.create(type, config);
    this._activeGame.onStateChange = this.handleStateChange;
    return this._activeGame.start(config);
  }

  handleAction(action: GameAction, fromSlotId: SlotIdValue): GameState {
    if (!this._activeGame) throw new Error("No active game");
    const result = this._activeGame.handleAction(action, fromSlotId);
    return result;
  }

  endGame(): void {
    this._activeGame = null;
  }

  private handleStateChange = (type: GameTypeValue, state: GameState): void => {
    this._ws.emit(GameEvents.STATE, { type, state });
  };
}
```

## WebSocket Protocol (kali-yarn)

Games reuse the existing WS connection with a `game:*` event prefix:

| Event | Direction | Payload |
|-------|-----------|---------|
| `game:start` | Backend → Frontend | `{ type, config, initialState }` |
| `game:state` | Bidirectional | `{ type, state }` |
| `game:action` | Frontend → Backend | `{ type, fromSlotId, data }` |
| `game:ai_move` | Backend → Frontend | `{ fromSlotId, action }` (Kali's turn) |
| `game:help` | Bidirectional | `{ hint }` |
| `game:end` | Backend → Frontend | `{ winner, score, reason }` |

## Game Registry

```typescript
// core/game-registry.ts
export class GameRegistry {
  private static _games = new Map<GameTypeValue, new (config: GameConfig) => BaseGame>();

  static register(type: GameTypeValue, ctor: new (config: GameConfig) => BaseGame): void {
    _games.set(type, ctor);
  }

  static create(type: GameTypeValue, config: GameConfig): BaseGame {
    const Ctor = _games.get(type);
    if (!Ctor) throw new Error(`Unknown game type: ${type}`);
    const game = new Ctor(config);
    return game;
  }
}
```

## AI Integration

Three distinct AI roles, implemented as separate abstractions that consume the
same `GameAction` interface:

```typescript
// ai/ai-slot.ts
export class AISlot {
  constructor(private game: BaseGame, private slotId: SlotIdValue) {}

  /** Ask Kali to decide the next action for this slot. */
  async decide(context: GameState): Promise<GameAction> {
    const llmPrompt = buildPrompt(context, this.slotId);
    const response = await llmProvider.complete(llmPrompt);
    return parseAction(response);
  }
}

// Versus:   AISlot(game, "opponent") → Kali chooses moves
// Coop:     AISlot(game, "teammate") → Kali suggests moves
// Trivia:   AIGenerator(game) → Kali creates questions
// Coach:    AICoach(game) → Kali observes and advises
```

## Agent Tools (Python)

```python
# kali-core/kali_core/claws/tools/games.py
@register
async def game_start(params: dict, ctx: ToolContext) -> ToolResult:
    """Start a new game session."""
    type = params["type"]
    config = parse_config(params["config"])
    # Emit via WS → frontend renders game artifact
    return ToolResult(artifact=game_artifact(type, config))

@register
async def game_action(params: dict, ctx: ToolContext) -> ToolResult:
    """Send an action to the active game."""
    # Forward to GameEngine via WS
    ...
```

## Game Catalog

Refer to `docs/GAMES.md` for the full catalog of 20 games across 4 archetypes.
Games are implemented incrementally; the catalog is the "eventually all" list.

## Rendering

### Architecture: Ref-based game state (no game state in React)

All game state lives in a **mutable ref** (`useRef`). React is never the source
of truth for game positions, board state, or animation data. This decouples the
game loop from React's render cycle and ensures smooth 60fps updates for
real-time games without impacting the rest of the app.

```
gameRef (mutable, in useRef)
  ├── game.tick()             ← real-time games only (rAF)
  ├── game.handleAction()     ← both real-time and turn-based (input → state change)
  ├── game.getState()         ← read by draw loop directly (no setState)
  └── game.version            ← monotomically increasing counter (triggers HUD re-render only)

View:
  ├── draw loop (rAF or sync):
  │     reads gameRef.getState() → paints canvas / grid / UI
  │     NEVER passes through React setState
  └── React HUD (score, buttons, labels):
        receives a signal via game.version → setState(version)
        renders text/botones reading gameRef.getState()
        minimal React surface area
```

Rendering strategies:

| Renderer | Used by | Implementation | Loop |
|----------|---------|----------------|------|
| `CanvasRenderer` | Real-time games (Snake, Breakout) | HTML5 `<canvas>`, rAF loop reads game ref | rAF (`requestAnimationFrame`) |
| `GridRenderer` | Grid-based games (2048, TicTacToe, Chess) | CSS Grid, sync draw from game ref after handleAction | Sync (no rAF) |
| `WidgetRenderer` | Text/UI games (Trivia, Story, Wordle) | Kali widget components, read game ref after handleAction | Sync (no rAF) |

No matter the strategy: game state always lives in the ref, never in `useState`.

Each game artifact is a draggable window on the NeuralCanvas, consistent with
other Kali artifacts.

## Real-Time Game Loop

Real-time games share a single `useGameLoop` hook that encapsulates the rAF
cycle, tick scheduling, and interpolation timing:

```typescript
// hooks/useGameLoop.ts
useGameLoop(
  game,               // BaseGame instance (must implement tick())
  tickMs,           // current tick interval (can change dynamically, e.g. per level)
  onFrame,          // (interp: number) => void — draw the current frame
  onStatusChange,   // (status) => void — React HUD update
);
```

The hook:
- Reads `game.tick()` at fixed intervals defined by `tickMs`
- Calls `onFrame(interp)` every frame with `interp` in `[0, 1]`, where `0` is
  immediately after a tick and `1` is just before the next tick
- Stores `tickMs` in a ref so that the loop does **not** restart when speed
  changes (e.g. on level up)
- Resets its internal timer when the game transitions to `PLAYING` to avoid an
  immediate unexpected tick on start/resume

### Smooth movement with interpolation

For grid-based real-time games, never redraw only on state changes. Instead,
redraw every frame and interpolate object positions between `game.prevData`
and `game.getState().data`.

```typescript
const eased = smoothstep(interp);   // or any easing curve
const px = lerp(prev.x, curr.x, eased) * CELL;
const py = lerp(prev.y, curr.y, eased) * CELL;
```

Recommended refinements learned from Snake:
- Use an easing curve (e.g. `smoothstep`) instead of linear interpolation: the
  movement feels more organic when it accelerates and decelerates between cells.
- Use rounded corners (`roundRect`) for moving objects: hard rectangles
  accentuate the discrete grid and make sub-pixel movement look jittery.
- Keep game logic grid-based but render at sub-pixel positions.

### Dynamic speed and levels

Real-time games may change speed as the player progresses. The recommended
pattern is:

- Store a `level` and derive `tickMs` from it.
- Expose `getLevel()` and `getTickMs()` on the game class.
- Serialize `level`, `foodsEaten`, and `speed` inside `state.data` so the HUD can
  display them without extra React state.
- Pass `game.getTickMs()` to `useGameLoop`; the ref-based implementation will
  pick up the new speed on the next frame without restarting the loop.

Example progression curve used by Snake:

```typescript
const BASE_TICK_MS = 150;   // starting speed (level 1)
const MIN_TICK_MS = 70;     // speed floor
const FOODS_PER_LEVEL = 4;  // how many foods to level up

getTickMs(level) {
  const decrease = Math.pow(level - 1, 1.5) * 5;
  return Math.max(MIN_TICK_MS, Math.round(BASE_TICK_MS - decrease));
}
```

This produces slow speed increases early on and steeper increases as the player
advances, keeping the early game approachable while creating tension later.

## Universal Game Rules

Every game — regardless of genre — must implement these behaviours.

### 1. Title screen

Each game starts on a title/presentation screen with:
- The game name and icon.
- Optionally, a brief instruction or tagline.
- An explicit **start trigger** (button or "Press ENTER to start").
- The game must NOT start automatically on mount. The player must actively
  choose to begin.

### 2. Pause menu

The game must have a pause overlay accessible at any time during active play:
- Pause freezes all game loops (ticks, timers, rAF, AI turns).
- The overlay shows:
  - Current score / progress (so the player knows where they stand).
  - **Resume** button to continue.
  - **Restart** button to start over from the beginning (resets all state).
  - **Give up / Quit** button to exit the game and return to the launchpad.
- While paused, the background is dimmed but still visible (the last frame is
  kept on screen).

### 3. Universal pause button

| Key | Action |
|-----|--------|
| `Escape` / `ESC` | Toggle pause (if playing → pause, if paused → resume). |
| `P` | Toggle pause (same as ESC). |

These keys must work regardless of where focus is in the window. The pause
action must be handled at the top view level and must not conflict with other
global shortcuts (e.g. Kali's push-to-talk).

### 4. Game over

When the game ends (win, loss, draw, or player quits):
- A **game over screen** is shown over the final board/canvas state.
- It displays: result (won/lost/draw), final score, and any relevant stats.
- Two buttons: **Play again** (restart) and **Quit** (return to launchpad).
- If the game is single-player with a high-score concept, a "New high score!"
  callout is shown.

### 5. State machine

Every game follows this lifecycle:

```
TITLE ──[start]──> PLAYING ──[pause]──> PAUSED ──[resume]──> PLAYING
                     │                    │
                     ├──[win/loss/draw]──> GAME_OVER ──[play again]──> PLAYING
                     │                                              └──> TITLE
                     └──[quit]──> LAUNCHPAD (window closes)
```

The BaseGame `GameStatus` enum already covers these states:

```
WAITING    (title screen state — game created, not yet started)
PLAYING    (active play)
PAUSED     (paused by player)
WON        (player wins)
LOST       (player loses)
DRAW       (draw)
```

## Success criteria

- Any game in the catalog can be started by voice or text ("Kali, juguemos tic-tac-toe").
- Games render as artifacts on the NeuralCanvas.
- Score and state are persisted across session refreshes.
- Versus games: Kali makes moves autonomously within reasonable time.
- Cooperative games: Kali provides hints or suggestions on request.
- Trivia games: Kali generates plausible, varied questions.
- New games can be added by: registering the type, implementing BaseGame,
  and dropping a React renderer component.
