# VR UX Panel 2D — Mejoras + Juegos en VR

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Elevar la UX del frame VR de artefactos 2D (snap-to-face, drag por rayo, minimizar, z-order, ahorro GPU) y definir cómo se implementan y muestran los juegos del canvas 2D (Snake, 2048, TicTacToe) dentro de VR con controles de controlador.

**Architecture:** El pipeline existente (`WS artifact` → `useChat` → `worldIds` → `Widget2DPanel` uikit + `VrWidgetRenderer`) se extiende sin cambiar contratos: (1) mejoras de interacción viven en `GripGrab`/`Widget2DPanel`/`panelFocus.ts`; (2) los juegos reutilizan el **model layer puro** existente (`BaseGame` subclasses: lógica, estado, `handleAction`) pero con una **vista nativa VR nueva por juego** (uikit `VrGameView`), porque las `SnakeView/2048View` 2D son `<canvas>` DOM que no renderiza en HMD. Un `VrGameLauncher` (arte `game` en VR) lista el catálogo (`GAME_CATALOG`) y lanza partidas creando eventos artifact `game` con `mode:"game", gameType`.

**Tech Stack:** three@0.185, @react-three/fiber@8.18, @react-three/xr@5.7 (Interactive/useXREvent), @react-three/uikit@1.0.75 (+ @pmndrs/pointer-events, ya integrados), `@zappar/msdf-generator` para fuente con tildes (ya OK).

---

## Estado actual (verificado en repo)

* Pipeline VR: `VREntry.tsx` — `RoomCanvas` (worldIds Set, auto-spawn streaming, slots estables) → `Widget2DPanels` → `Widget2DPanel` (branch immersive: `Root` uikit 420×~350, `VrWidgetRenderer`) + `GripGrab` (drag/zoom sticky) + `XrPointerBridge` (pointer events + wheel por thumbstick con foco) + `panelFocus.ts` (foco por pinch).
* Juegos 2D: `src/games/` — `BaseGame` (clase abstracta, paradigma turn-based/realtime, `handleAction(GameAction)`, `getState()`), registros: `SnakeGame`, `TwentyFortyEightGame`, `TicTacToeGame`. Vistas DOM: `GameWindow` → `SnakeView`/`TwentyFortyEightView`/`TicTacToeView` (canvas 2D + botones). Catálogo: `game-catalog.ts` (GAME_CATALOG, CATEGORIES). Launcher 2D: `ToysLaunchpad` (crea window `game` con `mode`/`gameType`).
* `windowType "game"` ya existe en los 23 tipos; `VrWidgetRenderer` lo manda a `Fallback` (texto plano) — aquí va la integración.

---

## PARTE A — Mejoras UX del frame VR (artefactos 2D)

### Task A1: Snap-to-face al soltar (lerp de orientación)

**Objective:** Al soltar el grip en pose rara, el panel se re-orienta suavemente mirando al usuario.

**Files:**
- Modify: `kali-web/src/vr/VREntry.tsx` (GripGrab, `onSqueezeEnd`)

**Steps:**
1. Añadir ref `snapRef = useRef(false)`; en `onSqueezeEnd` activarlo y guardar quaternion objetivo: `lookAt(panelPos → cameraPos)` (solo yaw+pitch leve, mantener roll 0).
2. En `useFrame`: si `snapRef.current`, slerp `group.quaternion` hacia el objetivo con factor `1 - exp(-12 * delta)`; cuando el ángulo < 0.5°, apagar.
3. tsc + vitest + build.
4. Commit `feat(vr): snap-to-face al soltar panel`.

**Test manual:** agarrar panel, girarlo 90°, soltar → se endereza en ~0.3s sin saltos.

### Task A2: Drag por rayo sin grip (trigger en header)

**Objective:** Mantener trigger sobre el header arrastra el panel a distancia (patrón Quest estándar).

**Files:**
- Modify: `kali-web/src/vr/VREntry.tsx` (Widget2DPanel header — `Interactive` wrapper o Container `onPointerDown/Up`)
- Modify: `kali-web/src/vr/XrPointerBridge.tsx` (exponer `xrDrag.begin(controller)`, `xrDrag.end()`)

**Steps:**
1. En `panelFocus.ts` añadir `dragState: { controller, offset } | null` compartido.
2. Header: `onPointerDown` → guardar `dragState = { controller: actual, offset: panelPos - ctrlRayClosestPoint }`; en bridge `selectend` → limpiar.
3. En bridge `useFrame`: si `dragState`, recolocar panel a lo largo del rayo del control a la distancia capturada (clamp 0.4–2.5 m), mirando al usuario.
4. Cursor del header cambia a "✥ mover" al hover.
5. Commit `feat(vr): drag por rayo desde el header`.

**Test manual:** apuntar al header, mantener trigger, mover la mano → panel sigue el rayo; soltar → queda.

### Task A3: Minimizar a mini-card

**Objective:** Colapsar panel a mini-tarjeta (dot color + título + score/preview) para liberar espacio con 6 paneles.

**Files:**
- Create: `kali-web/src/vr/VrMiniCard.tsx` (plano 0.28×0.09 m, `Interactive`: pinch restaura)
- Modify: `kali-web/src/vr/VREntry.tsx` (estado `minimizedIds: Set<string>` en RoomCanvas; Widget2DPanel branch early-return `<VrMiniCard>`)
- Modify: `kali-web/src/vr/widgets/VrWidgetRenderer.tsx` (export `VrWidgetSummary(ev): string` — 1 línea de preview por tipo)

**Steps:**
1. `VrWidgetSummary`: switch por tipo → `table` = "N filas", `code` = "N líneas", `quiz` = "N preguntas", `document` = primeras 40 chars, etc.
2. Botón "–" en header (junto a ✕, color `#38bdf8`).
3. Mini-card posiciones: grilla 3×2 fija bajo el abanico (y=1.2 m, radio 1.2 m), `Interactive onSelect` → quitar de `minimizedIds`.
4. Commit `feat(vr): minimizar panel a mini-card`.

### Task A4: Barra de progreso de scroll

**Objective:** Feedback de cuánto contenido queda por scrollear.

**Files:**
- Modify: `kali-web/src/vr/VREntry.tsx` (Container scroll → capturar ref; polling `scrollPosition`/`maxScrollPosition` en useFrame cada ~150ms → estado local `scrollRatio`)
- Modify: `kali-web/src/vr/VREntry.tsx` (barra 3D: mesh fino en el borde derecho del backing, escala Y = ratio, color `#38bdf8`)

**Steps:**
1. `const scrollRef = useRef<any>(null)` en el Container scroll (ref de uikit expone `scrollPosition: Signal<[x,y]>` y `maxScrollPosition`).
2. `useFrame` throttled: leer y setear `scrollRatio` solo si cambió >2%.
3. Mesh barra `args={[0.006, 0.6 * ratio, 0.001]}` position borde derecho.
4. Commit `feat(vr): indicador de progreso de scroll`.

### Task A5: Throttle de re-render fuera de vista (ahorro GPU Quest)

**Objective:** Contenido en streaming que no está en el frustum no fuerza re-layout cada 80ms.

**Files:**
- Modify: `kali-web/src/vr/VREntry.tsx` (Widget2DPanel: `useFrame` → frustum check con `THREE.Frustum.setFromProjectionScreenMatrix`; estado `inView`)
- Modify: `kali-web/src/vr/widgets/VrWidgetRenderer.tsx` (prop `frozen?: boolean` → memo que devuelve el último render)

**Steps:**
1. Frustum check cada 20 frames.
2. Si `!inView` y `ev.phase === "streaming"`: renderizar `<memo>` con snapshot del ev cada 2s en vez de cada update.
3. Commit `perf(vr): congela re-render de paneles fuera de vista`.

---

## PARTE B — Juegos en VR

### Decisiones de diseño (ya tomadas, con justificación)

* **Reusar el modelo, no la vista.** `SnakeGame/2048Game/TicTacToe` son clases puras con `handleAction()` — perfectas para VR. Las vistas 2D son canvas DOM invisibles en HMD → **nada de `Html`**: vistas nativas uikit.
* **Estado del juego → React state.** Cada `Vr*GameView` corre un `useFrame`-tick (realtime: snake) o subscripción a cambios (turn-based) y re-dibuja.
* **Render del tablero:** celdas como `Container`s uikit en grilla flex (Snake 20×20=400 celdas es demasiado → Snake se dibuja en un `planeGeometry` con `CanvasTexture` repintada por tick; 2048 4×4 y TicTacToe 3×3 sí en uikit).
* **Controles VR:** d-pad 3D (4 botones uikit con `Interactive`) para Snake; swipe = fling del stick; 2048 = stick con detección de fling (umbral 0.7, cooldown 250ms); TicTacToe = tap directo en celda (ya funciona con el bridge de clicks).
* **Launcher:** artefacto `game` con `mode:"launchpad"` en VR → `VrGameLauncher` (uikit, lista GAME_CATALOG con icono/nombre/1P-2P, botón Jugar → inyecta ev `{mode:"game", gameType}` vía `chat.setArtifactContent`).

### Task B1: Contrato VrGameView + host

**Objective:** Esqueleto que instancia la clase del juego y enruta acciones VR.

**Files:**
- Create: `kali-web/src/vr/games/VrGameHost.tsx` — factory `gameType → VrView`; instancia `GameRegistry.create(gameType, {slots: []})`, cleanup on unmount, HUD score/status.
- Modify: `kali-web/src/vr/widgets/VrWidgetRenderer.tsx` — `case "game"` → parse `parseContent(ev)` → `{mode, gameType}` → `mode==="launchpad" ? <VrGameLauncher ev> : <VrGameHost gameType>`.

**Steps:**
1. `VrGameHost` con HUD uikit (score, status, botones reiniciar/salir).
2. Wire en `VrWidgetRenderer` + tipo `VrGameContent = { mode?: "launchpad"|"game"; gameType?: GameTypeValue }`.
3. tsc.
4. Commit `feat(vr): VrGameHost + wiring en VrWidgetRenderer`.

### Task B2: VrGameLauncher (catálogo)

**Objective:** Lista de juegos disponibles dentro del artefacto `game` en VR.

**Files:**
- Create: `kali-web/src/vr/games/VrGameLauncher.tsx`
- Files leyendo: `kali-web/src/games/game-catalog.ts` (GAME_CATALOG, GAME type), `register-games.ts` (ensureRegistered)

**Steps:**
1. Card por juego: icono (emoji — la fuente MSDF no los tiene: usar dot de color por categoría en su lugar), nombre, descripción corta, badge jugadores ("1P"/"2P"), botón "Jugar".
2. "Jugar" → `chat.setArtifactContent(ev.id, {...ev, content: JSON.stringify({mode:"game", gameType: id})})` (mismo panel cambia a juego).
3. Filtrar `GameRegistry.isRegistered(id)`; no registrados deshabilitados ("pronto").
4. Commit `feat(vr): launcher de juegos en VR`.

### Task B3: TicTacToe VR (turn-based, tap directo)

**Objective:** El más simple para validar el patrón completo end-to-end.

**Files:**
- Create: `kali-web/src/vr/games/VrTicTacToe.tsx`
- Reuses: `TicTacToeGame` (`handleAction({type: ACTION, data: {row, col}}, slot)`)

**Steps:**
1. **Failing test** (`kali-web/src/vr/games/__tests__/VrTicTacToe.test.tsx`): renderiza 9 celdas; click en celda vacía llama `handleAction`; X/O se pinta según `getState()`.
   Run: `npx vitest run src/vr/games` → FAIL.
2. Grid uikit 3×3 de 90×90 px, símbolos `✕`/`◯` fontSize 34, línea ganadora resaltada.
3. Turno IA (`hasKali`): reusar `AISlot` es complejo (WS) — v1: modo 2 jugadores locales; IA se deja para task B6.
4. Run test → PASS. Build.
5. Commit `feat(vr): TicTacToe jugable en VR`.

### Task B4: 2048 VR (grilla uikit + fling del stick)

**Objective:** Segundo juego, valida input por stick.

**Files:**
- Create: `kali-web/src/vr/games/Vr2048.tsx`
- Reuses: `TwentyFortyEightGame.handleAction({type: MOVE, data: "up"|"down"|"left"|"right"})`, `getState().grid`

**Steps:**
1. **Failing test**: mover right mergea correctamente vía handleAction (lógica pura ya testeada — test de integración del view-model).
2. Grilla 4×4 uikit: Container 88×88, colores por valor (paleta 2→`#1e293b` … 2048→`#f59e0b`), score arriba.
3. Hook `useStickFling`: lee `gl.xr.getSession()` stick derecho en `useFrame`; |y|>0.7 dispara dirección y bloquea 250ms.
4. D-pad alternativo en HUD (4 botones) para probar sin stick.
5. Run test → PASS. Build.
6. Commit `feat(vr): 2048 jugable con fling del stick`.

### Task B5: Snake VR (realtime, CanvasTexture)

**Objective:** El único realtime; render en textura, input por d-pad/fling.

**Files:**
- Create: `kali-web/src/vr/games/VrSnake.tsx`
- Reuses: `SnakeGame` (tick manual), `ActionType.COMMAND` ("up"/"down"/"left"/"right"/"pause"), `GameStatus`

**Steps:**
1. **Failing test**: COMMAND "up" cambia dirección; colisión → status GAME_OVER.
2. `planeGeometry` 0.6×0.6 m + `CanvasTexture` 480×480: `useFrame` acumula dt; cada `tickMs` llama `game.tick()`, repinta canvas (celdas 24px, paleta PALETTE de SnakeView), `texture.needsUpdate = true`.
3. D-pad uikit bajo el tablero (4 botones 40×40, `Interactive`) + fling del stick.
4. Game over → overlay uikit "Fin — puntaje X — Reiniciar".
5. Run test → PASS. Build.
6. Commit `feat(vr): Snake jugable en VR (CanvasTexture + d-pad)`.

### Task B6: IA como oponente (opcional, TicTacToe)

**Objective:** vs Kali usando el pipeline existente de IA de juegos.

**Files:**
- Modify: `kali-web/src/vr/games/VrTicTacToe.tsx` (toggle "vs Kali" → AISlot + wsClient de `useGameWS()`)

**Steps:**
1. Instanciar `AISlot(slotId, wsClient, () => game.sessionId)` igual que `GameWidget` (copiar patrón, ~20 líneas).
2. Toggle en HUD; default off (funciona sin conexión al backend de juegos).
3. Commit `feat(vr): modo vs Kali en TicTacToe`.

### Task B7: QA + integración al flujo de artefactos

**Objective:** Los juegos entran al ecosistema: auto-spawn, foco, scroll, minimizar.

**Steps:**
1. DebugPanel: el botón `game` inyecta sample con `mode:"launchpad"` (verificar que el sample actual tenga JSON correcto — si no, actualizar `samples` en `VREntry.tsx`).
2. Verificar: auto-spawn respeta `phase==="complete"` (los games llegan completos — ya cubierto), foco por pinch funciona sobre el tablero, wheel no interfiere con el fling (foco + rayo sobre panel).
3. `npx tsc --noEmit && npx vitest run && npm run build`.
4. Commit `test(vr): samples de game + verificación integral`.
5. Deploy: push + `fresh-clone` pull + curl de verificación de módulos servidos (`VrGameHost`, `VrSnake`, etc.).

---

## Archivos que cambiarán (resumen)

| Archivo | Acción |
|---|---|
| `kali-web/src/vr/VREntry.tsx` | A1–A4, B7 (snap, drag, minimizar, barra, samples) |
| `kali-web/src/vr/XrPointerBridge.tsx` | A2, drag por rayo |
| `kali-web/src/vr/panelFocus.ts` | A2 (dragState compartido) |
| `kali-web/src/vr/VrMiniCard.tsx` | A3 (nuevo) |
| `kali-web/src/vr/widgets/VrWidgetRenderer.tsx` | A5, B1 (case game, summary, frozen) |
| `kali-web/src/vr/games/VrGameHost.tsx` | B1 (nuevo) |
| `kali-web/src/vr/games/VrGameLauncher.tsx` | B2 (nuevo) |
| `kali-web/src/vr/games/VrTicTacToe.tsx` | B3, B6 (nuevo) |
| `kali-web/src/vr/games/Vr2048.tsx` | B4 (nuevo) |
| `kali-web/src/vr/games/VrSnake.tsx` | B5 (nuevo) |

**No se toca:** backend kali-core, `useChat`, `artifact_stream.py`, vistas 2D (`SnakeView` etc.), contratos de protocolo.

## Tests / validación

* Unit (vitest): views-model tests B3–B5 (acciones mutan estado, render de celdas). Comando: `npx vitest run src/vr/games`.
* Tipo + build: `npx tsc --noEmit && npm run build` (VREntry debe seguir ~400 kB; los juegos van dentro de ese chunk — aceptable).
* Manual en Quest (`https://192.168.1.14:8444/#/vr`): cada task tiene su paso de prueba manual descrito.
* Regression: pelotitas siguen ausentes; tildes OK; spawn streaming OK (ya verificados).

## Riesgos y tradeoffs

1. **Snake con CanvasTexture**: repintar 480×480 cada tick (~10/s) es barato en Quest; el riesgo es el `needsUpdate` compitiendo con uikit — mitigación: textura en mesh separado del Root uikit (hermano, no hijo).
2. **Fling del stick vs scroll del panel**: ambos usan el stick derecho — regla de desambiguación: si el panel enfocado es un juego → fling; si no → wheel. Decide `getFocusedPanel().id` + `gameIdsRef`.
3. **AISlot acoplado a WS de juegos**: si el backend de juegos no está corriendo en la LAN de pruebas, el toggle IA debe fallar suave (timeout → "Kali no disponible"). Por eso es B6 opcional.
4. **Fuente MSDF sin emojis**: el catálogo usa iconos emoji — en VR se reemplazan por dots de color por categoría (solución ya decidida); si luego se quieren iconos, generar atlas con esos glyphs.
5. **Chunk size**: 3 juegos + host suman ~30–40 kB a VREntry (398 kB hoy) — aceptable; si supera 450 kB, lazy-import de `VrGameHost`.

## Orden de ejecución sugerido

A1 → A3 → B1 → B2 → B3 → B4 → B5 → A2 → A4 → A5 → B6 → B7.
(A1 y A3 son cortos y dan feedback visual inmediato; A2/A4/A5 son refinamientos; B es el bloque grande coherente.)
