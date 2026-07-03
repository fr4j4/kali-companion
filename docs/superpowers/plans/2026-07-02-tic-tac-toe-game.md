# Tic-Tac-Toe Game Implementation Plan

> **Goal:** Implement Tic-Tac-Toe as a Kali artifact window with two modes: VS CPU (local AI) and VS Kali (LLM via AISlot). Support configurable starter and difficulty.
>
> **Status:** Implemented.
> **Last updated:** 2026-07-02.

## Architecture

Turn-based 3×3 board game. The `TicTacToeGame` class (`kali-web/src/games/tic-tac-toe/tic-tac-toe-game.ts`) holds the board, alternating turns, win detection, draw detection, and lifecycle commands. The React view (`kali-web/src/components/games/TicTacToeView.tsx`) renders the board and a pre-game lobby. Two different AI providers can fill the `opponent` slot:

- `TicTacToeCPUPlayer` — local deterministic / heuristic / minimax player.
- `GameLLMProvider` — frontend bridge that sends the board state to the configured LLM and returns a move action.

Neither the game nor the view know whether the opponent is local or remote; the view simply connects a filler to the `opponent` slot returned by `game.getSlots()`.

## Tech Stack

TypeScript, React, CSS Grid, existing Kali Toys core (`BaseGame`, `GameRegistry`, `GameWindow`), `AISlotFiller` singleton, and existing `GameStatus` / `ActionType` / `GameCommand` constants.

## Global Constraints

- Extend `BaseGame` from `src/games/core/base-game.ts`.
- Register via `GameRegistry.register(GameType.TIC_TAC_TOE, TicTacToeGame)`.
- Use existing constants; never redefine strings.
- State lives in the game class; the view reads `game.getState()`.
- Build passes `npx tsc --noEmit` with zero errors.
- The game engine must treat the `opponent` slot as opaque: it only receives `handleAction(action, 'opponent')` and updates `currentSlot` to decide whose turn it is.

---

### Task 1: AISlotFiller singleton

**Files:**
- Create: `kali-web/src/games/ai/ai-slot-filler.ts`

**Behavior:**
- Global registry that maps a game + slot to an AI provider implementing `decide(state) -> action`.
- Exposes `register(gameId, slot, provider)`, `unregister(gameId, slot)`, and `get(gameId, slot)`.
- Allows the view to attach and detach AI players without the game class caring.

---

### Task 2: TicTacToeGame class

**Files:**
- Create: `kali-web/src/games/tic-tac-toe/tic-tac-toe-game.ts`

**Behavior:**
- 3×3 board initialized empty.
- Slots: `player` (human) and `opponent` (AI).
- Markers: `X` and `O`; who gets which marker depends on who starts.
- Valid action: `{ type: 'move', data: { row, col } }`.
- Win detection: three in a row, column, or diagonal.
- Draw detection: board full with no winner.
- Lifecycle commands: `start`, `restart`, `pause`, `resume`, `give_up`, `play_again`.
- On `restart`/`play_again`, preserve the configured starter and difficulty.
- `getSlots()` returns `[{ id: 'player', type: PlayerType.HUMAN }, { id: 'opponent', type: PlayerType.AI }]`.

**State data shape (`TicTacToeStateData`):**
```typescript
interface TicTacToeStateData {
  board: (string | null)[][];
  currentSlot: string;
  winner: string | null;
  draw: boolean;
  mode: 'cpu' | 'kali';
  difficulty: 'easy' | 'medium' | 'hard';
  starter: 'player' | 'opponent';
  playerMarker: 'X' | 'O';
  opponentMarker: 'X' | 'O';
}
```

---

### Task 3: TicTacToeCPUPlayer

**Files:**
- Create: `kali-web/src/games/tic-tac-toe/tic-tac-toe-cpu.ts`

**Behavior:**
- Implements a common `AIPlayer` interface so it can be registered through `AISlotFiller`.
- Difficulty levels:
  - `easy` — pick a random empty cell.
  - `medium` — if a winning move exists, take it; otherwise if the opponent has a winning move, block it; otherwise random.
  - `hard` — minimax with optimal play; if multiple moves have the same score, pick one randomly for variety.
- Return type: `{ type: 'move', data: { row, col } }`.

---

### Task 4: GameLLMProvider

**Files:**
- Create: `kali-web/src/games/ai/game-llm-provider.ts`

**Behavior:**
- Implements the same `AIPlayer` interface.
- Reads `systemStatus` for `llm_api_url`, `llm_model`, and whether an API key is set (`llm_api_key_set`).
- Builds a prompt describing the current board and asks for the next move as JSON: `{"row": number, "col": number}`.
- Calls the chat completions endpoint with a placeholder `Authorization: Bearer present` header when a key is configured.
- Validates the response and falls back to a safe random move on parse or network errors.

---

### Task 5: TicTacToeView component

**Files:**
- Create: `kali-web/src/components/games/TicTacToeView.tsx`

**Behavior:**
- Neon-styled 3×3 grid with X/O markers.
- Pre-game lobby / title screen:
  - Mode selector: `VS CPU` / `VS Kali`.
  - Difficulty selector (enabled only for VS CPU).
  - Starter selector: `You start` / `Opponent starts`.
  - `VS Kali` option is visible but disabled if no LLM provider is available.
- During play:
  - Highlight current player's turn.
  - Draw a winning line when the game ends.
  - Show draw / win / loss overlay with Play Again and Quit.
- Wire the selected opponent into `AISlotFiller` when the game begins and clean it up on unmount / game end.
- Do not pause on focus loss (turn-based).

---

### Task 6: Register the game and add GameWindow case

**Files:**
- Modify: `kali-web/src/games/register-games.ts`
- Modify: `kali-web/src/components/games/GameWindow.tsx`

**Behavior:**
- Register `TicTacToeGame` so the launchpad card is enabled.
- Add a `case GameType.TIC_TAC_TOE:` in `GameWindow.tsx` returning `<TicTacToeView game={...} />`.

---

### Task 7: Verify

```bash
cd kali-web
npx tsc --noEmit
```

Expected: zero errors.

---

### Task 8: Update documentation

- Modify: `docs/GAMES.md` — set `tictactoe` status to `Implementado` and update description.
- Create: this plan file at `docs/superpowers/plans/2026-07-02-tic-tac-toe-game.md`.

---

## Lessons learned (post-implementation)

### 1. Slots are opaque to the game engine

The game should not know whether `opponent` is a CPU, a local LLM, or a remote Kali instance. It only cares that `opponent` is an AI-typed slot and that actions arrive via `handleAction(action, 'opponent')`. This kept the engine small and made the two opponent modes interchangeable.

### 2. Use a singleton filler, not direct references from the game class

Creating `AISlotFiller` as a global registry allowed the view to attach whichever provider the user selected without touching `TicTacToeGame`. This separation of concerns also makes it trivial to reuse the same pattern for future versus games.

### 3. Slot IDs must be typed as strings internally

The `BaseGame` API expects slot identifiers to be strings. The first implementation typed `_currentSlot` as the literal `'player'`, which caused a TypeScript error when assigning `'opponent'`. Using a plain `string` type resolved the mismatch while still validating via runtime slot lookups.

### 4. Validate LLM responses defensively

LLMs may return malformed JSON, coordinates out of range, or occupied cells. `GameLLMProvider` normalizes the response and falls back to a random legal move. This prevents the game from hanging when the model or network misbehaves.

### 5. Preserve configuration across restarts

When the user chooses a mode/difficulty/starter, those values should be part of the game state and passed again on `restart`/`play_again`. Otherwise every round resets to defaults and breaks the UX.

### 6. Turn-based games should not pause on focus loss

Like 2048, Tic-Tac-Toe does not benefit from pausing when the window loses focus. The generic `GameWidget` pause-on-focus behavior was bypassed for this game to avoid unnecessary state transitions.

### 7. Avoid reading `systemStatus` directly from game engine code

The provider layer is the right place to consume `systemStatus`. The game engine should remain independent of any particular backend status shape, which makes unit testing easier and keeps the architecture clean.

---

## Future improvements (out of scope for this pass)

- Scoreboard with win/loss/draw statistics across rounds.
- Animated winning line drawn across the three winning cells.
- Smarter prompting for Kali (personality, explanation of the move).
- Networked multiplayer (human vs human) using Kali's slot system.
- Sound effects for move, win, and draw.
