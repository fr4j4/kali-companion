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
  getState(): GameState { return this._state; }
  getStatus(): GameStatusValue { return this._state.status; }

  protected emitState(): void {
    this.onStateChange?.(this.type, this._state);
  }

  readonly onStateChange?: (type: GameTypeValue, state: GameState) => void;
}
```

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

Three rendering strategies, each implemented as a React component:

| Renderer | Used by | Implementation |
|----------|---------|----------------|
| `CanvasRenderer` | Real-time games (Snake, Breakout) | HTML5 `<canvas>` inside artifact |
| `GridRenderer` | Grid-based games (2048, TicTacToe, Chess) | CSS Grid in artifact |
| `WidgetRenderer` | Text/UI games (Trivia, Story, Wordle) | Kali widget components |

Each game artifact is a draggable window on the NeuralCanvas, consistent with
other Kali artifacts.

## Success criteria

- Any game in the catalog can be started by voice or text ("Kali, juguemos tic-tac-toe").
- Games render as artifacts on the NeuralCanvas.
- Score and state are persisted across session refreshes.
- Versus games: Kali makes moves autonomously within reasonable time.
- Cooperative games: Kali provides hints or suggestions on request.
- Trivia games: Kali generates plausible, varied questions.
- New games can be added by: registering the type, implementing BaseGame,
  and dropping a React renderer component.
