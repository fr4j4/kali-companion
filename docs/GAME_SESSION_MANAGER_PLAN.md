# Plan: GameSessionManager — Arquitectura por capas + Tests

## Objetivo

1. Fix del bug: el razonamiento de la IA no llega al panel porque el turno AI no existe en el store cuando llegan los chunks de streaming.
2. Refactor: extraer la lógica de orquestación de la View a un `GameSessionManager` transversal con factory por paradigma, dejando la View como pura presentación.
3. Tests: cobertura de arquitectura e integración en frontend (vitest) y backend (pytest).

---

## Principios y buenas prácticas (aplicar a TODAS las tareas)

- Sin valores mágicos: usar constantes con nombre. Prohibido literales como `"turn-based"`, `"player"`, `"ai"`, `"opponent"`, timeouts sueltos.
- Tipado estricto: sin `any`. Usar tipos/interfases exportadas con `readonly` donde corresponda.
- SRP: una clase/archivo = una responsabilidad. El manager orquesta; el store persiste; la View presenta; `BaseGame` aplica reglas.
- No lógica de negocio en componentes: la View solo despacha acciones al manager y reacciona a callbacks. Cero imports a `aiSlotFiller`, `AISlot`, `useChat`, `useGameWS` desde la View.
- Nombres descriptivos: `submitPlayerAction`, `triggerAITurn`, `completeAITurn`.
- Manejo de errores explícito: capturar en el boundary correcto (el manager), propagar vía callback `onAIStatusChange`.
- Cleanup obligatorio: todo `useEffect` retorna cleanup; todo listener se desuscribe; `destroy()` aborta operaciones en curso.
- Tests deterministas: sin timers reales, sin red, sin WS. Todo mockeado. Un test = un comportamiento.
- Tests de backend: seguir el patrón de `test_game_move_protocol.py` — `ConnectionTestHelper` con `_sent` capturando respuestas, `tmp_path` para filesystem, `@pytest.mark.asyncio` para handlers async.

---

## Arquitectura

```
GameWidget (ensamblaje)
  ├── crea BaseGame (como hoy)
  ├── setea gameSessionStore con wsClient (como hoy)
  ├── crea providers (AISlot o TicTacToeCPUPlayer)
  ├── crea GameSessionManager via factory
  └── <GameRenderer game={game} manager={manager} />

GameRenderer → GameWindow (despacho visual)
  └── pasa game + manager a la View concreta

TicTacToeView (presentación pura)
  └── renderiza + despacha acciones al manager
```

---

## Tareas

### T0 — Configurar vitest en `kali-web` (NUEVO — infraestructura)

No existe framework de tests en el frontend hoy.

- devDependencies a agregar (`package.json`): `vitest`, `jsdom`
- Crear `kali-web/vitest.config.ts`:
  ```typescript
  import { defineConfig } from "vitest/config";
  export default defineConfig({
    test: { environment: "jsdom", globals: true, include: ["src/**/*.test.ts"] },
    resolve: { alias: { "@": "/src" } },
  });
  ```
- `tsconfig.json`: agregar `"vitest/globals"` a `types`.
- `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

### T1 — `games/core/game-session-store.ts`: agregar `completeAITurn`

- Agregar método `completeAITurn(sessionId, turnNumber, action, stateAfter): void`.
- Busca el turno por `turnNumber` dentro de `s.turns`. Si lo encuentra, actualiza `turn.action` y `turn.stateAfter`, y llama `this.emit()`.
- No toca `reasoning` (ya fue finalizado por `finalizeTurnReasoning`).
- Si no encuentra el turno o no hay `turns`, retornar sin error (idempotente).
- Exportar la clase `GameSessionStore` (no solo el singleton) para que los tests creen instancias frescas.

### T2 — `games/core/game-session-constants.ts`: auditar y completar constantes

- Verificar que existan constantes para: paradigmas (`TURN_BASED`, `REALTIME`), actores (`PLAYER`, `AI`), status de sesión, placeholders de action vacía.
- `GAME_ACTOR` y `GAME_PARADIGM` ya existen — usarlos.
- Definir `PLACEHOLDER_AI_ACTION` congelado con `Object.freeze` o `as const`.
- Reusar `KALI_MAX_RETRIES` de `game-ai.ts` (no duplicar).

### T3 — `games/core/game-session-manager.ts`: interfaz + factory (NUEVO)

- Interfaz `GameSessionManager` con: `destroy()`, `pause()`, `resume()`, `giveUp()`, `submitPlayerAction(action)`, `retryAI()`, `fallbackToCPU(provider)`, `subscribe(fn): () => void`, getters `kaliStatus`, `kaliError`, `retryCount`.
- `GameSessionManagerCallbacks`: `onStateChange`, `onAIStatusChange(status, error?)`.
- Factory `createGameSessionManager(game, providers, callbacks)` que branchea por `game.paradigm`.
- `providers` como `ReadonlyMap<SlotIdValue, MoveProvider>`.
- El `default` del switch lanza error explícito (fail-fast).

### T4 — `games/core/turn-based-session-manager.ts` (NUEVO)

Implementación completa de la lógica que hoy está en `TicTacToeView`:

- Estado interno: `_turnNumber`, `_retryCount`, `_kaliStatus`, `_kaliError`, `_cancelled`, copia mutable interna del map de providers.
- `submitPlayerAction(action)`: aplica acción al game, registra turno player en store, `onStateChange()`, si siguiente slot es AI → `_triggerAITurn()`.
- `_triggerAITurn()` (fix del bug):
  1. `onAIStatusChange(THINKING)`.
  2. `turnNumber++`.
  3. Crear turno placeholder AI en `sessionStore.addTurn` con `reasoning: { text: "", done: false }`.
  4. `provider.decide(state, turnNumber)` — los chunks se acumulan vía `updateTurnReasoning`, se finaliza con `finalizeTurnReasoning`.
  5. Si `_cancelled` → return.
  6. `game.handleAction(action, slotAI)`.
  7. `sessionStore.completeAITurn(turnNumber, action, stateAfter real)`.
  8. `onAIStatusChange(IDLE)`, `onStateChange()`.
  9. Si siguiente slot sigue siendo AI → recursión (con guard de `_cancelled`).
- Manejo de errores: timeout + retries, `onAIStatusChange(ERROR)`.
- `retryAI()`, `fallbackToCPU(provider)`, `pause()`, `resume()`, `giveUp()`, `destroy()`, `subscribe()`.
- Determinar slot AI: iterar `game.slots` y encontrar slot con `type === PlayerType.AI` que tenga provider registrado.
- Detectar siguiente slot: leer `currentSlot` del estado serializado (`game.getState().data as { currentSlot?: string }`).

### T5 — `games/core/realtime-session-manager.ts` (NUEVO — stub)

- Métodos comunes (`pause`, `resume`, `giveUp`, `destroy`) funcionan.
- `submitPlayerAction`, `retryAI`, `fallbackToCPU` lanzan `Error` descriptivo.
- `kaliStatus` siempre `IDLE`, `kaliError` siempre `null`, `retryCount` siempre `0`.

### T6 — `components/widgets/GameWidget.tsx`: crear providers + manager

- Tras `game.start()` y `gameSessionStore.setWSClient(wsClient)`:
  - Construir `providers = new Map<SlotIdValue, MoveProvider>()`.
  - Para slots con `type === PlayerType.AI`: crear `AISlot(slot.id, wsClient, game.sessionId)`.
  - Crear `manager = createGameSessionManager(game, providers, { onStateChange, onAIStatusChange })`.
  - Guardar `manager` en `useRef`.
  - En cleanup: `managerRef.current?.destroy()` antes de `gameRef.current?.stop()`.
  - Pasar `manager` a `<GameRenderer game={game} manager={manager} />`.

### T7 — `GameRenderer.tsx` + `GameWindow.tsx`: pasar manager

- Props: agregar `manager: GameSessionManager`.
- `GameWindow`: pasar `manager` a cada View concreta. Hacer `manager` opcional en Views que aún no lo consumen (Snake, 2048), obligatorio en `TicTacToeView`.

### T8 — `components/games/TicTacToeView.tsx`: reducir a presentación pura

- Props: `{ game: TicTacToeGame; manager: GameSessionManager; hasKali: boolean }`.
- Eliminar imports: `useChat`, `hasLLMIntegration`, `useGameWS`, `aiSlotFiller`, `AISlot`, `gameSessionStore`, `GAME_ACTOR`, `turnNumberRef`.
- Eliminar: `turnNumberRef`, `registerTurn()`, `useEffect` de detección de turno AI, lógica de retry/fallback con `filler.decide()`.
- Conservar: estado UI local (`mode`, `difficulty`, `starter`), renderizado del tablero, botones, overlays.
- `startGame()`: `game.restart(...)`, si `mode === CPU` → `manager.fallbackToCPU(new TicTacToeCPUPlayer(difficulty))`.
- `handleCellClick` → `manager.submitPlayerAction(...)`.
- Botones: retry → `manager.retryAI()`, fallback → `manager.fallbackToCPU(...)`, give up → `manager.giveUp()`.
- Estado de IA: lee `manager.kaliStatus`, `manager.kaliError`, `manager.retryCount`.
- `hasKali`: recibido como prop desde `GameWidget` (que tiene acceso a `systemStatus`).
- Re-render: `useEffect` con `manager.subscribe(() => setTick(t => t + 1))`.

### T9 — `src/games/core/__tests__/game-session-store.test.ts` (NUEVO — test frontend)

Tests del store con instancia fresca de `GameSessionStore`:

- `startSession`: crea sesión turn-based con `turns` vacíos, realtime con `events` vacíos, emite a suscriptores, envía WS.
- `addTurn`: agrega turno a sesión correcta, no agrega si no existe sesión, emite, envía WS.
- `updateTurnReasoning`: acumula chunks en reasoning del turno correcto, no hace nada si el turno no existe (regresión del bug), emite en cada chunk.
- `finalizeTurnReasoning`: reemplaza texto y marca `done=true`, no hace nada si el turno no existe.
- `completeAITurn`: actualiza `action` y `stateAfter` por `turnNumber`, preserva reasoning, no hace nada si no existe turno/sesión, emite.
- `endSession`: setea status y `endedAt`, envía WS con sesión completa.
- `clearSession`: elimina sesión del mapa, emite.
- `getAITurns`: filtra turnos con `actor === "ai"`, retorna `[]` si no hay sesión.

### T10 — `src/games/core/__tests__/turn-based-session-manager.test.ts` (NUEVO — test frontend)

Tests del manager con mocks de `BaseGame` y `MoveProvider`:

- `submitPlayerAction`: aplica acción al game, registra turno player, incrementa `turnNumber`, llama `onStateChange`, dispara AI si siguiente slot es AI.
- `triggerAITurn` (fix del bug): crea turno placeholder AI **antes** de `decide()`, pasa `turnNumber` correcto, chunks se acumulan en store, finaliza reasoning, aplica acción al game, completa turno con `action`+`stateAfter` reales, llama `onAIStatusChange(THINKING→IDLE)`, llama `onStateChange`.
- Manejo de errores: error → `onAIStatusChange(ERROR)`, timeout + retries, abort por `destroy()`.
- `retryAI`: re-ejecuta, incrementa `retryCount`, no reintenta si `>= KALI_MAX_RETRIES`.
- `fallbackToCPU`: reemplaza provider, resetea `retryCount`, re-dispara.
- `pause/resume/giveUp`: delegan al game, llaman `onStateChange`.
- `subscribe`: notifica en cada cambio, desuscripción funciona.
- `destroy`: marca cancelado, `decide()` no aplica acción al resolver.
- Getters: `kaliStatus`, `kaliError`, `retryCount` reflejan estado actual.

### T11 — `src/games/core/__tests__/game-session-manager-factory.test.ts` (NUEVO — test frontend)

- Factory devuelve `TurnBasedSessionManager` si `paradigm === "turn-based"`.
- Factory devuelve `RealtimeSessionManager` si `paradigm === "realtime"`.
- Factory lanza `Error` si paradigma es desconocido.
- Stub realtime: `submitPlayerAction`/`retryAI`/`fallbackToCPU` lanzan `Error`, `kaliStatus` siempre `IDLE`, `pause/resume/giveUp` no lanzan error.

### T12 — `kali-core/tests/test_game_session_handlers.py` (NUEVO — test backend)

Cubre los handlers WS de sesión sin tests hoy. Helper `SessionConnectionTestHelper(Connection)` con `server.game_session_service = GameSessionService(base_path=str(tmp_path))`.

- `TestHandleGameSessionStart`: no-op con campos completos, no-op con campos faltantes, no lanza error.
- `TestHandleGameSessionEnd`: persiste sesión y responde `game_session_persisted` con path, sesión realtime con events, sesión sin turns, status default `ABANDONED` cuando falta.
- `TestHandleListGameSessions`: lista filtrada por `gameId`, lista global sin `gameId`, lista vacía cuando no hay sesiones.
- `TestHandleLoadGameSession`: carga sesión existente con datos completos, retorna `null` si no existe, `sessionId` vacío retorna `null`.
- `TestHandleDeleteGameSession`: elimina sesión existente (`deleted=true`), sesión inexistente (`deleted=false`), `sessionId` vacío (`deleted=false`).

### T13 — `kali-core/tests/test_game_session_settings.py` (NUEVO — test backend)

Cubre `_apply_settings` para `game_session_path`. Usa `monkeypatch` para aislar estado global.

- Sets custom path: envía `game_session_path` con valor custom, verifica `settings.game_session_path`.
- Empty path resets to default: envía vacío, verifica `~/.kali/game-sessions`.
- Expands user path: envía `~/my-sessions`, verifica que `~` se expande.
- Missing key does not modify: evento sin `game_session_path`, verifica que no se modifica.
- Status includes `game_session_path`: `_build_status_payload` incluye la key.

---

## Fases y paralelismo

### Fase A — Paralela (puede ejecutarse con subagentes en simultáneo)

Tareas sin dependencias entre sí:

| Tarea | Descripción | Bloquea a |
|-------|-------------|-----------|
| **T0** | Setup vitest | T9, T10, T11 |
| **T1** | Store `completeAITurn` | T3, T4, T9 |
| **T2** | Constantes | T3, T4, T5 |
| **T12** | Tests backend handlers | (independiente) |
| **T13** | Tests backend settings | (independiente, pero conviene tras T12) |

Estas 5 tareas pueden ejecutarse en paralelo. T12 y T13 son de backend y completamente independientes del frontend.

### Fase B — Secuencia estricta (un paso a la vez)

Depende de T1 + T2. Debe ejecutarse en orden:

1. **T3** — Interfaz + factory (define el contrato que T4 y T5 implementan)
2. **T4** — `TurnBasedSessionManager` (implementa la interfaz de T3)
3. **T5** — `RealtimeSessionManager` stub (implementa la interfaz de T3)

T3 debe ir antes que T4 y T5. T4 y T5 podrían ir en paralelo tras T3, pero como T4 es la pieza central y T5 es trivial, conviene un solo agente secuencial.

### Fase C — Secuencia estricta (un paso a la vez)

Depende de T3 + T4 + T5. Debe ejecutarse en orden:

1. **T6** — `GameWidget` crea providers + manager
2. **T7** — `GameRenderer` + `GameWindow` pasan manager
3. **T8** — `TicTacToeView` se reduce a presentación

Cada paso depende del anterior porque cambia la prop `manager` que fluye por la cadena.

### Fase D — Paralela (puede ejecutarse con subagentes en simultáneo)

Depende de T0 + T1 + T4. Los tests de frontend dependen solo de la lógica (no de la integración UI):

| Tarea | Depende de |
|-------|------------|
| **T9** | T0 (vitest), T1 (store) |
| **T10** | T0 (vitest), T4 (manager) |
| **T11** | T0 (vitest), T3 (interfaz), T5 (stub) |

Estas 3 pueden ejecutarse en paralelo.

### Fase E — Paralela (independiente del frontend)

Los tests de backend pueden ejecutarse en cualquier momento (incluso en paralelo con Fase A-D):

| Tarea | Depende de |
|-------|------------|
| **T12** | Ninguna (backend standalone) |
| **T13** | T12 (conviene tras T12 para reusar helper) |

---

## Diagrama de dependencias

```
Fase A (paralela):
  T0 ──────────────────────────────────────> T9, T10, T11
  T1 ──────────> T3 ──> T4 ──> T5 ──────────> T6
  T2 ──────────> T3
  T12 ──────────────────────────────────────> T13

Fase B (secuencial):   T3 → T4 → T5
Fase C (secuencial):   T6 → T7 → T8
Fase D (paralela):      T9 || T10 || T11  (tras T0+T1+T4)
Fase E (paralela):      T12 → T13          (independiente)
```

---

## Asignación sugerida a subagentes

| Agente | Tareas | Notas |
|--------|--------|-------|
| **Agente 1** (core frontend) | T0 → T1 → T2 → T3 → T4 → T5 | Cadena del corazón del manager. Secuencial. |
| **Agente 2** (UI) | T6 → T7 → T8 | Arranca tras T3+T4+T5. Secuencial. |
| **Agente 3** (tests frontend) | T9, T10, T11 | Arranca tras T0+T1+T4. Paralela entre los 3. |
| **Agente 4** (backend) | T12 → T13 | Independiente. Puede arrancar desde el inicio. |

---

## Verificación final (secuencial — tras todas las fases)

1. TypeScript: `cd kali-web && npx tsc --noEmit`
2. Vitest: `cd kali-web && npx vitest run`
3. Python tests (sesión): `cd kali-core && python -m pytest tests/test_game_session_service.py tests/test_game_session_handlers.py tests/test_game_session_settings.py -q`
4. Python tests (full): `cd kali-core && python -m pytest tests/ -q` (las 2 fallas preexistentes de TTS son esperadas)
5. Manual: Tic-Tac-Toe vs Kali → razonamiento en streaming en panel izquierdo con cursor `▌`.

---

## Estructura de archivos final

```
kali-web/
  vitest.config.ts                              # NUEVO (T0)
  package.json                                  # MODIFICADO (T0)
  tsconfig.json                                 # MODIFICADO (T0)
  src/games/core/
    game-session-store.ts                       # MODIFICADO (T1)
    game-session-constants.ts                    # MODIFICADO (T2)
    game-session-manager.ts                     # NUEVO (T3)
    turn-based-session-manager.ts               # NUEVO (T4)
    realtime-session-manager.ts                 # NUEVO (T5)
    __tests__/
      game-session-store.test.ts                # NUEVO (T9)
      turn-based-session-manager.test.ts        # NUEVO (T10)
      game-session-manager-factory.test.ts      # NUEVO (T11)
  src/components/
    widgets/GameWidget.tsx                      # MODIFICADO (T6)
    games/GameRenderer.tsx                      # MODIFICADO (T7)
    games/GameWindow.tsx                         # MODIFICADO (T7)
    games/TicTacToeView.tsx                      # MODIFICADO (T8)

kali-core/tests/
    test_game_session_service.py                 # EXISTE (sin cambios)
    test_game_move_protocol.py                   # EXISTE (sin cambios)
    test_game_session_handlers.py               # NUEVO (T12)
    test_game_session_settings.py               # NUEVO (T13)
```

---

## Lo que los tests garantizan

| Test | Garantía |
|------|----------|
| **Frontend** | |
| store — `completeAITurn` | Actualiza action + stateAfter sin romper reasoning |
| store — `updateTurnReasoning` | Chunks se acumulan solo si el turno existe (regresión del bug) |
| manager — `triggerAITurn` | Turno placeholder se crea **antes** de `decide()` — fix del bug |
| manager — streaming | Chunks llegan al store durante `decide()` y se finalizan al resolver |
| manager — errores | Timeouts, retries, fallback, abort por destroy |
| manager — ciclo completo | Player action → AI turn → store tiene ambos turnos con datos correctos |
| factory — paradigma | Cada paradigma devuelve el manager correcto; desconocido lanza error |
| factory — stub realtime | Métodos turn-based lanzan error explícito (fail-fast) |
| **Backend** | |
| handlers — start | No-op handler no lanza error con campos completos o faltantes |
| handlers — end | Persiste sesión y responde `game_session_persisted` con path |
| handlers — list | Lista filtrada por gameId, lista global, lista vacía |
| handlers — load | Carga sesión existente, retorna null si no existe |
| handlers — delete | Elimina sesión existente, retorna false si no existe |
| settings — game_session_path | Aplica path custom, resetea al default con vacío, expande `~`, no modifica si key ausente |
| settings — status payload | `game_session_path` está en el status |

---

## Fuera de scope

- Cablear 2048 turn registration (futuro).
- Implementar Snake realtime (futuro).
- Extender `MoveProvider` con `abort()`.
- Modificar `BaseGame` para exponer `nextSlotId()`.
- Mover `console.log` de `AISlot` a un logger condicional.