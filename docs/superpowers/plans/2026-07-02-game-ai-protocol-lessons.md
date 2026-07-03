# Lessons Learned: Kali Game AI Protocol & Frontend Integration

> **Context:** Implementation of Tic-Tac-Toe (Ta-Te-Ti) with VS CPU and VS Kali AI modes,
> and the WebSocket-based game AI protocol connecting frontend games to the Kali backend LLM.
>
> **Last updated:** 2026-07-02.

---

## 1. Architecture Overview

### 1.1 Game Engine Architecture

Kali Toys games follow a **client-side engine pattern** with a clean separation between:

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (kali-web)                                    │
│                                                          │
│  ┌──────────────┐   ┌────────────┐   ┌─────────────┐  │
│  │ Game Engine  │   │ Game View  │   │ AI Provider │  │
│  │ (base-game)  │◄──│ (React)    │──►│ (AISlot)    │  │
│  └──────────────┘   └────────────┘   └──────┬──────┘  │
│         ▲                                    │          │
│         │                              ┌────▼────┐    │
│         │                              │ WSClient│    │
│         │                              └────┬────┘    │
└─────────┼────────────────────────────────┼──────────┘
          │                                │
          │     ┌─────────────────────────┘
          │     │
          ▼     ▼
┌──────────────────────────────────────────────────────┐
│  Backend (kali-core)                                 │
│                                                       │
│  ┌────────────┐   ┌──────────────────┐   ┌────────┐ │
│  │ dispatch() │──►│ _handle_game_move│──►│ Direct │ │
│  │  (WS)      │   │                 │   │ LLM    │ │
│  └────────────┘   └──────────────────┘   └────┬───┘ │
│                                               │      │
└───────────────────────────────────────────────┼──────┘
```

**Key principle:** The game engine (`BaseGame` subclass) is completely **AI-provider agnostic**. It only receives actions from slots. The view wires the appropriate AI provider (CPU or Kali) to each slot.

### 1.2 The AISlot Pattern

The `AISlot` / `AISlotFiller` pattern decouples the game from the AI implementation:

```typescript
// View wires AI to the opponent slot
aiSlotFiller.fill(GameType.TIC_TAC_TOE, SlotId.OPPONENT, new AISlot(wsClient));

// Game engine asks the filler for a decision when it's the AI's turn
const filler = aiSlotFiller.get(GameType.TIC_TAC_TOE, SlotId.OPPONENT);
const action = await filler.decide(gameState);
game.handleAction(action, SlotId.OPPONENT);
```

**Benefits:**
- The same game works with CPU AI, Kali LLM, or any future AI provider
- No changes to the game engine when switching AI backends
- Easy to test with mock AI providers

---

## 2. The WebSocket Game AI Protocol

### 2.1 Event Pair

```
Frontend ──game_move──► Backend ──LLM call──► LLM provider
                 │                       │
                 │◄──game_move_response─┘
                 │
                 ▼
          Frontend applies action to game
```

**`game_move` (frontend → backend):**
```typescript
{
  event: "game_move",
  game_type: string,           // e.g. "tictactoe", "chess"
  session_id?: string,         // optional; for future stateful use
  rules: {
    system_prompt: string,      // full prompt for this game + difficulty
    response_format: "json",    // always "json"
    // ... game-specific config
  },
  game_state: object,          // game-specific state (board, positions, etc.)
  player_role: string,          // role label of the AI player
  difficulty?: string,
  starter?: string,
  player_marker?: string,
  opponent_marker?: string,
}
```

**`game_move_response` (backend → frontend):**
```typescript
{
  event: "game_move_response",
  game_type: string,
  session_id?: string,
  action: { type: string, data: object } | null,
  error: {
    code: "PARSE_ERROR" | "INVALID_MOVE" | "MODEL_ERROR" | "NO_LEGAL_MOVES",
    message: string,
    fallback_action?: { type: string, data: object },  // always legal
  } | null,
}
```

### 2.2 Design Principles

1. **Stateless backend.** Each `game_move` carries all context needed. No history accumulation between moves. Prevents context pollution in the LLM and keeps the backend simple.

2. **Fresh messages per request.** The backend builds a `messages[]` array from scratch. Does NOT use `AgentRuntime.respond()` which would maintain conversation history. The `messages` list contains a **single `user` message** with the game system prompt embedded as a preamble — NOT a `system` message. This is critical because `DirectLLMProvider.complete()` preprends its own `system` message automatically; emitting two system messages causes a 400 error from Jinja-templated LLM backends.

3. **Structured JSON I/O.** Both request and response are typed JSON. The backend validates the model's output before returning it.

4. **Server-side validation.** If the LLM returns invalid JSON or illegal coordinates, the server detects it, computes a fallback move, and returns both the error AND a fallback action the frontend can use.

5. **`session_id` optional.** If provided, the backend may use it for future stateful features. If absent, the request is purely stateless. Forward-compatible gate, not a requirement.

### 2.3 Why WebSocket and Not REST?

- **Consistency.** Kali's entire frontend-backend communication is WebSocket-based.
- **No new HTTP endpoints.** No need to extend the FastAPI app.
- **Natural proxy through Vite.** In dev, `ws://localhost:5173/ws` is automatically proxied to `ws://127.0.0.1:8900/ws`.
- **Bi-directional.** The protocol is symmetric — same channel for requests and responses.

---

## 3. Common Pitfalls & How to Avoid Them

### 3.1 React Closure Staleness

**Problem:** A `useCallback` captures a prop or context value in its closure. If that value changes (e.g., WebSocket connects, `chat` object is recreated), the callback still references the old value.

**Example from TicTacToeView:**
```typescript
// WRONG: 'chat' was NOT in the dependency array
const startGame = useCallback(() => {
  if (chat.wsClient) {  // chat.wsClient is STALE — always null!
    aiSlotFiller.fill(..., new AISlot(SlotId.OPPONENT, chat.wsClient));
  }
}, [game, starter, difficulty, mode, systemStatus, refresh]);
//                                              ↑ chat is MISSING
```

**Fix:** Always include all values the callback uses in its dependency array:
```typescript
}, [game, starter, difficulty, mode, systemStatus, chat, refresh]);
//                                                    ^^^^ added
```

**Rule:** If you reference `X` inside a `useCallback` or `useEffect`, `X` MUST be in the dependency array. This is not optional — it is the mechanism that recreates the callback when `X` changes.

### 3.2 Silent Error Swallowing

**Problem:** If an async operation (like `filler.decide()`) fails and the error is caught with an empty `catch {}`, the user never knows something went wrong. The game just appears to "not respond."

**Example from initial implementation:**
```typescript
// WRONG: silently swallows all errors
filler.decide(gameState).catch(() => {
  // If the AI fails, the game just waits.
});
```

**Fix:** Always propagate errors to UI state so the user can see and react to failures:
```typescript
filler.decide(gameState).then((action) => {
  game.handleAction(action, SlotId.OPPONENT);
  refresh();
}).catch((err: unknown) => {
  const error = err instanceof KaliError ? err : new KaliError("WS_ERROR", ...);
  setKaliStatus("error");
  setKaliError(error);  // User sees this in the UI
});
```

### 3.3 Missing Click-Blocking During AI Thinking

**Problem:** If the user clicks a cell while the AI is "thinking" (waiting for the backend/LLM), the move might be registered after the AI's move — causing state inconsistency or the move being ignored.

**Fix:** Use a `useRef` for synchronous blocking (not `useState`, which is async):
```typescript
const kaliStatusRef = useRef<KaliStatusValue>(KaliStatus.IDLE);

const handleCellClick = (row: number, col: number) => {
  if (kaliStatusRef.current === KaliStatus.THINKING) return;  // sync check
  // ...
};
```

**Why `useRef` and not `useState`?** When you call `setKaliStatus("thinking")`, React schedules a re-render. The synchronous code after `setKaliStatus()` still sees the OLD value of `kaliStatus` until the next render. A `ref` updates immediately and is readable synchronously in the same tick.

### 3.4 No Timeout on Async Operations

**Problem:** `sendAndWait()` waits forever for a response. If the WebSocket is disconnected or the backend is unreachable, the Promise never resolves or rejects. The game hangs permanently.

**Fix:** Always use timeouts for any async operation that involves network I/O:
```typescript
sendAndWait<T>(eventName: string, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.off(eventName, handler);
      reject(new Error(`sendAndWait timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (response: T) => {
      clearTimeout(timer);
      this.off(eventName, handler);
      resolve(response);
    };
    this.on(eventName, handler);
    this.send(payload);
  });
}
```

### 3.5 Magic Strings and Numbers

**Problem:** Hardcoded strings like `"idle"`, `"thinking"`, `"error"` and numbers like `10000` (timeout ms) scattered across the codebase make maintenance difficult and typo-prone.

**Fix:** Centralize all game-related constants in a dedicated file:
```typescript
// games/core/constants/game-ai.ts
export const KaliStatus = {
  IDLE: "idle",
  THINKING: "thinking",
  ERROR: "error",
} as const;

export const GAME_AI_TIMEOUT_MS = 10_000;
export const KALI_MAX_RETRIES = 2;
```

This also enables TypeScript autocomplete and compile-time checking.

### 3.6 Backend State Pollution (AgentRuntime History)

**Problem:** The `AgentRuntime.respond()` method maintains unbounded conversation history per session. Using it for game AI would:
- Accumulate game-related messages in the user's chat history
- Pollute the LLM context with stale game states
- Make it impossible to run multiple independent games simultaneously

**Fix:** Call `DirectLLMProvider.complete()` directly with a fresh `messages[]` array constructed from scratch:
```python
def _build_game_messages(self, rules: dict, game_state: dict) -> list[dict]:
    system_prompt = rules.get("system_prompt", "You are a game AI.")
    user_content = json.dumps({"game_state": game_state})
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content},
    ]
# No history. No tools. No AgentRuntime.respond().
```

### 3.7 Frontend Direct LLM Calls (Security)

**Problem:** Calling the LLM directly from the browser (as the first `GameLLMProvider` implementation did) exposes API credentials to the client, bypasses the backend's permission system, and is architecturally inconsistent.

**Fix:** All LLM calls go through the backend. The frontend only talks to the backend via WebSocket. The backend uses the configured `llm_provider` (DirectLLMProvider, NanobotLLMProvider, etc.) which holds the API credentials securely.

### 3.8 Double System Message Error (Jinja LLM Backends)

**Problem:** `DirectLLMProvider.complete()` prepends its own `{"role": "system", "content": self._system_prompt}` to the messages list (line 448 of `direct.py`). If `_build_game_messages()` also includes a `{"role": "system"}` message with the game's system prompt, the resulting payload has **two** system messages. Some LLM backends (particularly those using Jinja2 templating internally, like some custom deployments) reject this with:

```
"System message must be at the beginning."
```

**Root cause:**
```python
# direct.py line 448:
full = [{"role": "system", "content": system_content}]
full += messages  # ← _build_game_messages already has a {"role": "system"} entry!
```

**Fix:** `_build_game_messages()` must NOT include a `system` message. Instead, embed the game system prompt inside the `user` message as a preamble:

```python
def _build_game_messages(self, rules: dict, game_state: dict) -> list[dict]:
    system_prompt = rules.get("system_prompt", "You are a game AI. Output valid JSON.")
    user_content = (
        "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nGame state:\n"
        + json.dumps(game_state, indent=2)
    )
    return [{"role": "user", "content": user_content}]  # single user message, no system
```

**Rule:** The game backend MUST NOT emit `{"role": "system"}` messages. All system context must be embedded in the user message. The LLM provider's own system prompt is prepended automatically by `complete()`.

---

## 4. File Organization for Kali Games

### 4.1 Frontend Structure

```
kali-web/src/games/
├── core/
│   ├── constants/
│   │   ├── game-types.ts      # GameType.TIC_TAC_TOE, etc.
│   │   ├── game-status.ts     # GameStatus values
│   │   ├── action-types.ts    # ActionType values
│   │   ├── player-types.ts    # SlotId, PlayerType
│   │   └── game-ai.ts        # Kali AI constants (status, error codes, config)
│   └── types/
│       ├── game-state.ts       # GameState interface
│       ├── game-action.ts      # GameAction interface
│       └── game-config.ts      # GameConfig interface
├── ai/
│   ├── ai-slot-filler.ts      # Singleton registry: AI → game slots
│   ├── ai-slot.ts             # AISlot class: WS-based AI provider
│   ├── kali-error.ts          # KaliError class + helpers
│   └── game-llm-provider.ts   # (legacy direct REST, superseded by ai-slot)
├── tic-tac-toe/
│   ├── tic-tac-toe-game.ts    # Game engine
│   ├── tic-tac-toe-cpu.ts    # CPU AI (minimax, random, blocking)
│   └── tic-tac-toe-data.ts   # TicTacToe-specific types
└── components/games/
    ├── GameWindow.tsx         # Game router
    └── TicTacToeView.tsx     # React view
```

### 4.2 Backend Structure

```
kali_core/
├── server.py                   # WS dispatch + _handle_game_move + helpers
└── mind/llm/
    ├── provider.py            # LLMProvider protocol
    └── direct.py             # DirectLLMProvider.complete()
```

For a new game, you only touch `server.py` to add the `game_move` branch in `dispatch()` and the handler methods. You do NOT need to modify the game engine or the frontend unless the game has unique requirements.

---

## 5. The Game View Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  WAITING (pre-game lobby)                                   │
│  - Mode / difficulty / starter selectors                      │
│  - START button                                              │
└────────────────────────┬────────────────────────────────────┘
                         │ startGame()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PLAYING                                                      │
│  - Board renders                                             │
│  - Player clicks → game.handleAction() → refresh()           │
│  - Opponent turn: filler.decide() → game.handleAction()       │
│  - If kali mode: wsClient.sendAndWait("game_move", ...)      │
│    - kaliStatus = "thinking" (UI shows "KALI PENSANDO...")    │
│    - Response arrives → action applied                        │
│    - kaliStatus = "idle"                                     │
└─────────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│  WON / LOST    │           │     ERROR       │
│  / DRAW        │           │ (Kali failed)   │
│                │           │                 │
│  PLAY AGAIN    │           │ RETRY (max 2)  │
│  QUIT          │           │ CPU FALLBACK     │
│                │           │ RENDIRSE        │
└─────────────────┘           └─────────────────┘
```

---

## 6. Testing Strategy

### 6.1 Backend (Python)

Test the protocol handlers in isolation using fake objects — no real WebSocket or network needed:

```python
class ConnectionTestHelper(Connection):
    """Exposes _parse_game_action etc. for unit testing."""
    def __init__(self, llm_response=None):
        self.server = type("Srv", ..., {"llm_provider": FakeLLMProvider(llm_response)})

# Test parse errors, invalid moves, fallback logic, error codes
def test_parse_error_returns_fallback(conn):
    response = {"text": "not json at all"}
    action, error = conn._parse_game_action(response, game_state, {})
    assert action is None
    assert error["code"] == "PARSE_ERROR"
    assert error["fallback_action"] is not None
```

Key tests:
- Valid move parsing
- Parse errors → fallback
- Invalid coordinates (out of range, negative, occupied) → fallback
- Network/API failures → MODEL_ERROR
- Full async roundtrip via `_handle_game_move()`

### 6.2 Frontend (TypeScript)

Manual verification steps:
1. VS CPU mode: verify AI makes moves correctly
2. VS Kali mode with LLM connected: verify `game_move` WS frame is sent, `game_move_response` is received and applied
3. VS Kali mode with LLM disconnected: verify error overlay appears within ~10s (timeout)
4. VS Kali mode with LLM returning invalid JSON: verify error overlay with PARSE_ERROR
5. Click a cell during Kali thinking: verify click is blocked
6. Retry once/twice: verify retry count works
7. After max retries: verify "Continuar con CPU" works

---

## 7. Adding a New Game with Kali AI

### 7.1 Backend

**In `server.py`:**

1. Add to `dispatch()`:
```python
elif kind == "game_move":
    await self._handle_game_move(event)
```

2. Implement helpers in `Connection` class:
```python
def _handle_game_move(self, event):
    # 1. Extract game_type, rules, game_state
    # 2. Build messages with _build_game_messages()
    # 3. Call llm_provider.complete(messages)
    # 4. Parse with _parse_game_action() — handles validation + fallback
    # 5. Send game_move_response event
```

**Key:** `_is_legal_move()` and `_get_fallback_move()` currently have Tic-Tac-Toe-specific logic. For a new game, create a validator strategy (can be a registry of game-type → validator functions, or a base class method that gets overridden).

### 7.2 Frontend

1. **Create game engine** in `kali-web/src/games/<game>/`:
   - Extend `BaseGame`
   - Define `slots` with `PlayerType.AI` for the Kali/opponent slot
   - Implement `handleAction()` — receives moves, updates state, detects win/draw

2. **Create AI slot** in `kali-web/src/games/ai/<game>-slot.ts`:
   - Build system prompt from game state
   - Call `wsClient.sendAndWait<GameMoveResponseEvent>("game_move", {...})`
   - Throw structured `KaliError` on failure

3. **Register in `register-games.ts`** and add case in `GameWindow.tsx`

4. **Create React view** with the same pattern as `TicTacToeView`:
   - Lobby with mode/difficulty/starter selectors
   - Game board rendering
   - Error overlay with Retry/CPU Fallback/GiveUp buttons
   - `kaliStatusRef` for synchronous click-blocking

---

## 8. Key Constants Reference

```typescript
// kali-web/src/games/core/constants/game-ai.ts

export const KaliStatus = {
  IDLE: "idle",
  THINKING: "thinking",
  ERROR: "error",
} as const;

export const KaliErrorCode = {
  WS_NULL: "WS_NULL",           // wsClient was null when decide() was called
  WS_TIMEOUT: "WS_TIMEOUT",     // sendAndWait timed out
  WS_ERROR: "WS_ERROR",         // network/WebSocket error
  PARSE_ERROR: "PARSE_ERROR",   // LLM returned unparseable response
  INVALID_MOVE: "INVALID_MOVE", // LLM returned illegal coordinates
  MODEL_ERROR: "MODEL_ERROR",   // LLM provider/API failed
  NO_LEGAL_MOVES: "NO_LEGAL_MOVES", // board is full
} as const;

export const GAME_AI_TIMEOUT_MS = 10_000;  // 10 seconds
export const KALI_MAX_RETRIES = 2;        // retry limit before fallback prompt

export const GameMode = {
  CPU: "cpu",
  KALI: "kali",
} as const;

export const TttField = {
  BOARD: "board",
  CURRENT_SLOT: "currentSlot",
  DIFFICULTY: "difficulty",
  STARTER: "starter",
  PLAYER_MARK: "playerMark",
  OPPONENT_MARK: "opponentMark",
  MODE: "mode",
} as const;
```

---

## 9. Quick Checklist for New Game with AI

**Backend:**
- [ ] `dispatch()` has `elif kind == "game_move"` → calls `_handle_game_move()`
- [ ] `_handle_game_move()` calls `llm.complete()` with fresh messages
- [ ] `_build_game_messages()` emits ONLY a single `user` message — **no** `{"role": "system"}` (direct.py prepends one automatically; double-system causes 400 on Jinja backends)
- [ ] `_parse_game_action()` validates coordinates for THIS game
- [ ] `_get_fallback_move()` returns a legal move for THIS game
- [ ] Unit tests cover: valid, parse error, invalid move, timeout, network error

**Frontend:**
- [ ] `game-ai.ts` constants defined
- [ ] `kali-error.ts` used for structured errors (no silent null returns)
- [ ] Game engine slot has `type: PlayerType.AI`
- [ ] AISlot uses `wsClient.sendAndWait("game_move", ...)`
- [ ] `ai-slot-filler.ts` used to wire provider to slot
- [ ] View: `chat` in all relevant `useCallback`/`useEffect` deps
- [ ] View: `kaliStatusRef` used for synchronous click-blocking
- [ ] View: error overlay with Retry / CPU Fallback / GiveUp
- [ ] `npx tsc --noEmit` passes
