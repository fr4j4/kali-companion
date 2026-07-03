# Game AI WebSocket Protocol

> **Status:** Implemented (2026-07-02)
> **Backend:** `kali-core/kali_core/server.py` — `_handle_game_move()`
> **Frontend:** `kali-web/src/lib/wsClient.ts` — `sendAndWait()`, `kali-web/src/games/ai/ai-slot.ts` — `AISlot.decide()`

---

## 1. Transport

- **Channel:** Same Kali WebSocket connection (`/ws`)
- **Dev proxy:** Vite proxies `ws://localhost:5173/ws` → `ws://127.0.0.1:8900/ws`
- **No new HTTP endpoints.** All game AI traffic uses the existing WebSocket channel.

---

## 2. Message Format

### Client → Server: `game_move`

```json
{
  "event": "game_move",
  "game_type": "tictactoe",
  "game_state": {
    "board": [["X", null, null], [null, null, null], [null, null, null]],
    "current_turn": "opponent"
  },
  "rules": {
    "system_prompt": "You are a Tic-Tac-Toe AI. Always respond with valid JSON."
  },
  "session_id": "abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | Yes | Must be `"game_move"` |
| `game_type` | string | Yes | Identifies the game (e.g., `"tictactoe"`) |
| `game_state` | object | Yes | Full game state — board, turns, scores, etc. |
| `rules` | object | Yes | Must include `system_prompt`; may include additional rules |
| `session_id` | string | No | For future stateful features; currently unused |

### Server → Client: `game_move_response`

```json
{
  "kind": "game_move_response",
  "action": {
    "type": "move",
    "data": { "row": 1, "col": 2 }
  },
  "error": null
}
```

Or with an error + fallback:

```json
{
  "kind": "game_move_response",
  "action": null,
  "error": {
    "code": "PARSE_ERROR",
    "message": "Model returned invalid JSON",
    "fallback_action": { "type": "move", "data": { "row": 0, "col": 0 } }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | `GameAction \| null` | The validated move, or `null` if error |
| `error` | `GameMoveError \| null` | Error details + fallback, or `null` if success |

---

## 3. Error Codes

| Code | Meaning |Fallback Strategy |
|------|---------|-----------------|
| `INVALID_MOVE` | LLM returned coordinates outside the board or on an occupied cell | Server computes fallback move (random legal cell) |
| `PARSE_ERROR` | LLM response was not valid JSON | Server computes fallback move |
| `MODEL_ERROR` | LLM provider raised an exception | Server computes fallback move |
| `NO_LEGAL_MOVES` | Board is full (draw) | `null` action with no fallback |
| `WS_TIMEOUT` | Frontend timed out waiting for response | Frontend shows retry overlay |
| `WS_ERROR` | WebSocket send/receive failed | Frontend shows retry overlay |

---

## 4. Key Design Decisions

1. **Request/response events are different.** The client sends `"game_move"` but the server responds with `"game_move_response"`. `sendAndWait` must register the listener on the response event name, not the request event name.

2. **Single user message.** `_build_game_messages()` returns `[{role: "user", content: "SYSTEM INSTRUCTIONS:\n..."}]` — NOT a `{"role": "system"}` message. `DirectLLMProvider.complete()` prepends its own system prompt automatically; two system messages cause 400 errors on Jinja-templated backends.

3. **Server-side validation.** The backend validates the LLM's output before returning it. Invalid JSON → `PARSE_ERROR`. Illegal coordinates → `INVALID_MOVE`. The frontend never needs to re-validate.

4. **Fallback always provided.** On any error, `fallback_action` is always populated with a legal move. The frontend can use it immediately or show an error overlay.

5. **Stateless.** Each `game_move` is self-contained. No conversation history is accumulated between moves.

6. **`session_id` optional.** Forward-compatible gate for future stateful features.

---

## 5. Adding a New Game

### Backend (`server.py`)

```python
elif kind == "game_move":
    await self._handle_game_move(event)
```

In `_handle_game_move()`:
1. Extract `game_type`, `game_state`, `rules`
2. Call `_build_game_messages(rules, game_state)` — returns `[{role: "user", ...}]`
3. Call `self._llm_provider.complete(messages)`
4. Parse with `_parse_game_action(response, game_state)` — validates coordinates
5. On error, `_get_fallback_move(game_state)` computes a legal fallback
6. Send `game_move_response` event

### Frontend

1. Create `game-ai.ts` constants: `GameMode`, `KaliStatus`, `KaliErrorCode`, timeout, retries
2. Wire `AISlot` via `AISlotFiller.fill()` using `wsClient.sendAndWait("game_move", ...)`
3. Use `KaliError` for structured error handling
4. Use `kaliStatusRef` for synchronous click-blocking during AI turn
5. Show error overlay with Retry / CPU Fallback / GiveUp options
