# Plan: Sistema de emociones del avatar — Emociones expresadas por el LLM

## Objetivo

Rediseñar el sistema de emociones y estados del avatar para que el agente (Kali) pueda expresar emociones de forma contextual y persistente, en lugar del sistema actual donde la ejecución de tareas muestra una cara de enojo (`enojado`) por diseño.

### Problema actual

El motor del avatar (`kali-web/src/avatar/AvatarMoodEngine.ts:109-113`) fuerza la emoción `enojado` durante toda la ejecución de herramientas (`tool_event` con `status === "running"`), combinado con `state="idle"` y sin animación. El usuario percibe al avatar como "molesto" cuando solo está concentrado trabajando. Además, `enojado` está sobrecargado: significa concentración, consent pendiente, error de tool y error de transporte — todos mapean a la misma cara.

### Solución

1. **Nuevo catálogo de emociones** compartido entre backend y frontend.
2. **El LLM emite emociones explícitamente** con un bloque `<emotion:ETIQUETA/>` al final de su respuesta; el backend lo parsea del stream y emite un evento WS `emotion_event`.
3. **Humor persistente**: la emoción del LLM persiste como "humor actual" entre turnos hasta que el LLM emita uno nuevo.
4. **Precedencia**: estado programático (tool running, consent) > emoción expresada por el LLM.
5. **Nuevas emociones** `concentrado` (reemplaza `enojado` durante tools) y `esperando` (consent pendiente).
6. **Plugpoint arquitectural** `EmotionProvider` para un futuro modelo local de inferencia de emociones (no se implementa, solo se deja el hueco).
7. **La cara de enojo durante `hablando`**: el estado `hablando` ya NO neutraliza la emoción — si el LLM emitió `enojado`, se ve durante el TTS.

---

## Principios y buenas prácticas (aplicar a TODAS las tareas)

- Sin valores mágicos: usar constantes con nombre. Prohibido literales sueltos como timeouts o etiquetas.
- Tipado estricto: sin `any`. Usar tipos/interfases exportadas con `readonly` donde corresponda.
- SRP: una función/archivo = una responsabilidad. El motor deriva; el provider provee; el hook es glue React; el SVG renderiza.
- No lógica de negocio en componentes: `AvatarSVG` solo setea `data-state`/`data-mood` y maneja animación de boca. Nada de derivación de emociones en él.
- Cleanup obligatorio: todo `useEffect` retorna cleanup; todo timer se limpia en unmount; todo listener se desuscribe.
- Tests deterministas: sin timers reales, sin red, sin WS. Todo mockeado. Funciones puras reciben `now` inyectable.
- Tests de backend: seguir el patrón de `test_game_move_protocol.py` — `ConnectionTestHelper` con `_sent` capturando respuestas, `@pytest.mark.asyncio` para handlers async.
- Comentarios: solo donde el "por qué" no es obvio. Nada de comentarios que repitan lo que el código ya dice.

---

## Decisiones de diseño (cerradas en sesión de grilling)

| # | Decisión | Contexto |
|---|----------|----------|
| D1 | Rediseño completo del sistema, no solo fix del síntoma | El sistema actual está mal diseñado conceptualmente |
| D2 | Dos mecanismos: LLM emite emoción (primario) + modelo local (futuro, placeholder arquitectural) | Toggleable en config |
| D3 | Precedencia: estado programático → emoción del LLM | El programático gana durante tool/consent |
| D4 | Mantener CSS+SVG como capa visual | Sin cambiar el motor de render |
| D5 | Es estético pero prioritario | Parte de la experiencia del asistente |
| D6 | LLM emite bloque `<emotion:feliz/>` al final del stream | Opción A: campo estructurado post-stream |
| D7 | Desincronización emoción/TTS aceptable | No se sincroniza por palabra/token |
| D8 | Modelo local: solo placeholder arquitectural, no se implementa | El toggle existe pero no cambia comportamiento |
| D9 | El LLM es el actor emocional con estado interno | El agente tiene humor que persiste |
| D10 | Solo etiquetas del enum; system prompt inyecta la lista | No valores libres |
| D11 | Criterio de terminado: debug panel + ok manual sobre 5 escenarios | Definidos en sección "Verificación" |
| D12 | Humor discreto persistente ahora; continuo (-1..1) documentado para futuro | El campo `continuous` queda en la interfaz |
| D13 | Si LLM no emite bloque → mantiene emoción anterior | Fallback a humor actual |
| D14 | Si LLM emite valor inválido → fallback a `normal` | No mapear aproximaciones |
| D15 | Si LLM emite bloque a mitad → extraer sin perder texto | El texto visible no contiene el bloque |
| D16 | `kali-core` arma el system prompt desde catálogo compartido | El backend conoce las emociones pero no renderiza |
| D17 | `hablando` ya NO fuerza `normal` | La emoción del LLM se visible durante TTS |
| D18 | 5 escenarios de validación definidos | Ver sección "Verificación" |
| D19 | `EmotionProvider` con interfaz async + confidence + `continuous?` | Listo para humor continuo futuro |
| D20 | Backend parsea `<emotion:.../>`, emite `emotion_event` WS | El cliente nunca parsea texto |
| D21 | Catálogo compartido leído por `kali-core` | Una sola fuente de verdad |
| D22 | Tool falla sin emoción del LLM → persiste `confundido` | No `enojado`, para no confundir al usuario |
| D23 | Backend envía lista de emociones del turno; cliente toma la última | Futuro: secuencia completa para transiciones |

---

## Arquitectura

```
┌─────────────────── kali-core (backend) ────────────────────────────┐
│                                                                      │
│  emotion_catalog.json  ←─ fuente compartida (catálogo)               │
│         │                                                            │
│         ▼                                                            │
│  system prompt builder  → añade al prompt del LLM:                   │
│    "Puedes expresar emoción con <emotion:ETIQUETA/>                  │
│     al final de tu respuesta.                                        │
│     Emociones válidas: normal, enojado, sorprendido, ..."            │
│                                                                      │
│  LLM stream →  delta handler                                         │
│         │                                                            │
│         ▼                                                            │
│  EmotionStreamFilter  (nuevo, patrón similar a MarkerSuppressor)     │
│    - detecta <emotion:.../> en el stream                             │
│    - extrae del texto visible (delta limpio)                         │
│    - acumula lista de emociones del turno                            │
│    - valida contra catálogo (inválido → descarta)                    │
│         │                                                            │
│         ▼                                                            │
│  emite emotion_event WS: { emotions: [...], final: "feliz" }         │
│  + delta (texto limpio sin el bloque)                                │
└──────────────────────────────────────────────────────────────────────┘
                            │ WS
                            ▼
┌─────────────────── kali-web (frontend) ────────────────────────────┐
│                                                                      │
│  useChat.ts                                                          │
│    - recibe emotion_event → setEmotionEvents(list)                   │
│    - recibe delta (texto limpio)                                     │
│    - reconcilia toolEvents (reemplaza último running, no append)     │
│                                                                      │
│  EmotionProvider (interfaz, plugpoint arquitectural)                 │
│    ┌─ LLMEmotionProvider  (implementado)                             │
│    │   getEmotion(ctx): Promise<EmotionResult>                       │
│    │   → lee última emoción de la lista del turno                    │
│    └─ LocalModelEmotionProvider  (stub, futuro)                      │
│        → retorna { emotion: "normal", confidence: 0 }                │
│                                                                      │
│  avatarStateMachine.ts (funciones puras)                             │
│    deriveState(ctx) → AvatarState  (programático)                    │
│    deriveEmotion(ctx, state, currentMood) → AvatarEmotion            │
│      1. override (click → ronroneando)                               │
│      2. debug force                                                  │
│      3. tool running → concentrrado                                  │
│      4. consent → esperando                                          │
│      5. tool error sin emoción LLM → confundido (persiste)           │
│      6. emoción del LLM vía EmotionProvider                          │
│      7. fallback → mantiene currentMood                              │
│                                                                      │
│  AvatarMoodEngine.ts (hook, glue React)                              │
│    - arma AvatarContext                                              │
│    - llama deriveState/deriveEmotion                                 │
│    - persiste currentMood entre turnos (useState)                    │
│    - timers para transiciones temporales                             │
│    - timeout de seguridad para stale tool running                    │
│                                                                      │
│  AvatarSVG.tsx → data-state + data-mood → CSS                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Restricciones documentadas

- **R1**: `ToolEvent` (`kali-core/kali_core/yarn/protocol.py` y `kali-web/src/lib/protocol.ts:313-320`) no trae campo `id`/`call_id`. La reconciliación de `toolEvents` en el cliente se hace por `(session_id, tool)` último running, no por `call_id`. Llamadas concurrentes a la misma herramienta en el mismo turno pueden pisarse. Documentado para futura fase cuando el protocolo añada `call_id`.
- **R2**: Humor continuo (-1..1, valencia+arousal) no se implementa en este plan. El campo `continuous` queda en la interfaz `EmotionResult` como `undefined` para que un `ContinuousMoodProvider` futuro lo reemplace sin romper consumidores.
- **R3**: `LocalModelEmotionProvider` es un stub que retorna `normal`. El toggle de UI existe pero activarlo no cambia el comportamiento visible. Documentado como "Próximamente".
- **R4**: La desincronización emoción/TTS es aceptada (D7). La emoción del LLM se muestra cuando llega el `emotion_event`, no sincronizada con el audio del TTS por palabra/token.

---

## Tareas

### Etapa 1 — Backend: catálogo + system prompt

> **Paralelizable con**: Etapa 2 (mismo paquete `kali-core`, archivos distintos). Ambas etapas tocan `kali-core` pero en archivos diferentes. Coordinar para no pisar `runtime.py` simultáneamente (Etapa 2 toca el loop de streaming; Etapa 1 toca `direct.py` y un archivo nuevo).
>
> **Bloquea a**: Etapa 3 (frontend necesita el evento WS `emotion_event` que define Etapa 2).

#### T1.1 — Crear `emotion_catalog.json`

**Archivo**: `kali-core/kali_core/mind/emotion_catalog.json` (nuevo)

Catálogo compartido de emociones válidas. Lo lee `kali-core` para construir el fragmento del system prompt. Futuramente lo puede leer `kali-web` para validación.

```json
{
  "instruction": "Puedes expresar cómo te sientes con un bloque <emotion:ETIQUETA/> al final de tu respuesta, después del texto visible. Las emociones influyen en la expresión del avatar. Etiquetas válidas y su significado:",
  "emotions": [
    { "id": "normal", "description": "Estado neutro, sin emoción particular" },
    { "id": "enojado", "description": "Frustración, enfado, o cuando algo falla" },
    { "id": "sorprendido", "description": "Sorpresa, asombro, resultado inesperado" },
    { "id": "ronroneando", "description": "Contento, afectuoso, siendo acariciado" },
    { "id": "feliz", "description": "Satisfacción, alegría, éxito, algo salió bien" },
    { "id": "confundido", "description": "Duda, confusión, algo salió raro" },
    { "id": "concentrado", "description": "Trabajando, enfocado en una tarea" },
    { "id": "esperando", "description": "Esperando confirmación del usuario" }
  ]
}
```

**Notas**:
- Los `id` deben coincidir exactamente con los valores de `AvatarEmotion` en `kali-web/src/avatar/avatarConfig.ts:25-31` (tras la modificación de T5.1).
- `concentrado` y `esperando` son nuevas; el resto ya existe.

#### T1.2 — Constructor del fragmento del system prompt

**Archivo**: `kali-core/kali_core/mind/emotion_prompt.py` (nuevo)

Función que lee `emotion_catalog.json` y construye el texto a inyectar en el system prompt del LLM.

```python
"""Builds the emotion instruction fragment for the LLM system prompt."""

from __future__ import annotations
import json
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent / "emotion_catalog.json"

def build_emotion_prompt_fragment() -> str:
    """Return the emotion instruction text for the system prompt.

    Reads emotion_catalog.json and produces a human-readable list of
    valid emotion tags the LLM can emit via <emotion:ETIQUETA/>.
    """
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    instruction = catalog["instruction"]
    emotions = catalog["emotions"]
    lines = [instruction]
    for e in emotions:
        lines.append(f"  - {e['id']}: {e['description']}")
    lines.append(
        "\nEjemplo: '¡Listo! He creado el archivo. <emotion:feliz/>'"
    )
    return "\n".join(lines)
```

#### T1.3 — Inyectar el fragmento en el system prompt

**Archivo**: `kali-core/kali_core/mind/llm/direct.py:193`

En el método `stream`, donde se construye `system_content` (línea 193):

```python
# Antes:
system_content = self._system_prompt
if tools:
    system_content += "\n\n" + self._tool_descriptions_system(tools)

# Después:
system_content = self._system_prompt
system_content += "\n\n" + build_emotion_prompt_fragment()
if tools:
    system_content += "\n\n" + self._tool_descriptions_system(tools)
```

Importar `build_emotion_prompt_fragment` desde `..emotion_prompt`.

**Notas**:
- La inyección va **antes** de las tools para que el LLM vea las emociones temprano en el contexto.
- Si `self._system_prompt` está vacío (config por defecto), el fragmento se agrega igual — no hay razón para no ofrecer emociones.

#### T1.4 — Test del system prompt

**Archivo**: `kali-core/tests/test_emotion_prompt.py` (nuevo)

```python
def test_emotion_prompt_includes_all_catalog_emotions():
    fragment = build_emotion_prompt_fragment()
    assert "<emotion:" in fragment
    for emotion_id in ["normal", "enojado", "sorprendido", "ronroneando", "feliz", "confundido", "concentrado", "esperando"]:
        assert emotion_id in fragment

def test_emotion_prompt_includes_example():
    fragment = build_emotion_prompt_fragment()
    assert "Ejemplo" in fragment
```

---

### Etapa 2 — Backend: parser del stream + evento WS

> **Paralelizable con**: Etapa 1 (archivos distintos en `kali-core`). Coordinar el toque de `runtime.py` — esta etapa modifica el loop de streaming.
>
> **Bloquea a**: Etapa 3 (frontend necesita `emotion_event` WS).

#### T2.1 — `EmotionStreamFilter`

**Archivo**: `kali-core/kali_core/mind/emotion_filter.py` (nuevo)

Filtro de stream que detecta y extrae bloques `<emotion:ETIQUETA/>` del texto del LLM. Patrón similar a `MarkerSuppressor` (`kali-core/kali_core/mind/marker_suppressor.py`).

**Contrato**:
- `feed(chunk: str) -> str`: recibe un chunk del stream, retorna el texto **limpio** (sin bloques `<emotion:.../>`). Mantiene un buffer interno para detectar bloques que llegan partidos entre chunks.
- `flush() -> list[str]`: al final del stream, retorna la lista de emociones detectadas (vacía si ninguna). Flush del buffer residual.
- Emociones inválidas (no en catálogo) se descartan silenciosamente — no afectan la lista ni el texto (el bloque se extrae igual).

**Regex del bloque**: `r"<emotion:([a-zA-Z_-]+)\s*/>"` — captura la etiqueta entre `<emotion:` y `/>`.

**Buffer**: mantener los últimos N caracteres del texto anterior para detectar un bloque que llega partido (ej. `<emotion:fe` en un chunk, `liz/>` en el siguiente). N = 20 caracteres (suficiente para `<emotion:esperando/>`).

**Validación contra catálogo**: cargar los ids válidos desde `emotion_catalog.json` al instanciar. Si la etiqueta no está en el catálogo, descartar el bloque (extraerlo del texto pero no agregarlo a la lista).

**Caso de bloque a mitad del texto** (D15): el bloque se extrae, el texto antes y después se concatena sin perder contenido. Ej. `"Hola <emotion:feliz/> ¿Cómo estás?"` → `"Hola  ¿Cómo estás?"` + emoción `feliz`.

**Caso de múltiples bloques** (D23): todos se acumulan en la lista. El cliente toma el último. Ej. `"Pienso... <emotion:concentrado/> ... ¡Listo! <emotion:feliz/>"` → lista `["concentrado", "feliz"]`, texto limpio `"Pienso...  ... ¡Listo! "`.

#### T2.2 — Nuevo `StreamEvent.kind = "emotion"`

**Archivo**: `kali-core/kali_core/mind/llm/provider.py:35`

Añadir `"emotion"` al `Literal` de `kind`:

```python
kind: Literal["delta", "tool_call", "reasoning", "done", "step", "usage", "emotion"]
```

Añadir campo `emotions: list[str] | None = None` al `StreamEvent` (dataclass o NamedTuple según el patrón existente).

#### T2.3 — Integrar `EmotionStreamFilter` en el runtime

**Archivo**: `kali-core/kali_core/mind/runtime.py:300-309`

En el loop de streaming, después del `delta_filter` (MarkerSuppressor) existente, añadir el `EmotionStreamFilter`:

```python
# En la sección donde se inicializan los filtros (alrededor de línea 291-298):
emotion_filter = EmotionStreamFilter()

# En el handler de delta (alrededor de línea 301-309):
if event.kind == "delta" and event.text:
    safe_from_tc = delta_filter.feed(event.text)
    if not safe_from_tc:
        continue
    # Pasar por el filtro de emociones
    safe_from_emotion = emotion_filter.feed(safe_from_tc)
    result = artifact_processor.feed(safe_from_emotion)
    if result.chat_text:
        yield StreamEvent(kind="delta", text=result.chat_text)
    for art_evt in result.artifact_events:
        await self._emit_artifact_event(art_evt, session_id)
```

Al final del step/stream (después del loop `async for event`), hacer flush del emotion_filter y emitir el `StreamEvent` de emoción:

```python
# Después del flush del delta_filter (alrededor de línea 374-394):
emotions = emotion_filter.flush()
if emotions:
    yield StreamEvent(kind="emotion", emotions=emotions)
```

**Notas**:
- El `EmotionStreamFilter` se reinicia en cada step del multi-step loop (mismo scope que `delta_filter`).
- Las emociones se acumulan **entre steps** del mismo turno. Mantener una lista acumulada del turno completo fuera del loop de steps, o emitir un `emotion` por step y concatenar en el servidor. **Decisión**: acumular por turno — mantener `turn_emotions: list[str] = []` fuera del loop de steps, extender con `emotion_filter.flush()` después de cada step, y emitir un solo `StreamEvent(kind="emotion", emotions=turn_emotions)` al final del turno (antes del `done`).

#### T2.4 — Nuevo evento WS `emotion_event`

**Archivo**: `kali-core/kali_core/yarn/protocol.py:34`

Añadir `"emotion_event"` a `EventTypeOut`:

```python
EventTypeOut = Literal[
    ...,
    "emotion_event",
    ...
]
```

**Archivo**: `kali-core/kali_core/server.py:3063-3088`

En el handler del loop `async for event`, añadir el caso para `emotion`:

```python
elif event.kind == "emotion":
    await self.send({
        "event": "emotion_event",
        "session_id": session_id,
        "emotions": event.emotions,
        "final": event.emotions[-1] if event.emotions else None,
    })
```

#### T2.5 — Tests del parser

**Archivo**: `kali-core/tests/test_emotion_filter.py` (nuevo)

Casos de test:
1. Stream con `<emotion:feliz/>` al final → lista `["feliz"]`, texto limpio sin el bloque.
2. Stream sin bloque → lista vacía, texto sin cambios.
3. Bloque inválido (`<emotion:melancolico/>`) → descartado, lista vacía, texto sin el bloque.
4. Bloque a mitad (`"Hola <emotion:feliz/> ¿Cómo estás?"`) → lista `["feliz"]`, texto `"Hola  ¿Cómo estás?"`.
5. Bloque partido entre chunks (`"texto <emotion:fe"` + `"liz/> resto"`) → lista `["feliz"]`, texto `"texto  resto"`.
6. Dos bloques (`"<emotion:concentrado/> ... <emotion:feliz/>"`) → lista `["concentrado", "feliz"]`.
7. Test de integración: stream completo del runtime emite `emotion_event` WS con `final` correcto. Patrón de `test_game_move_protocol.py` con `ConnectionTestHelper`.

---

### Etapa 3 — Frontend: protocolo + useChat

> **Depende de**: Etapa 2 (necesita el evento WS `emotion_event` definido y emitido).
>
> **Paralelizable con**: Etapa 5 (mismo paquete `kali-web`, archivos distintos). Etapa 3 toca `protocol.ts` y `useChat.ts`; Etapa 5 toca `avatarConfig.ts`, `avatarStateMachine.ts`, `AvatarMoodEngine.ts`. Sin conflicto.
>
> **Bloquea a**: Etapa 4 (EmotionProvider necesita `EmotionEvent` de `protocol.ts`).

#### T3.1 — Tipo `EmotionEvent` en el protocolo

**Archivo**: `kali-web/src/lib/protocol.ts` (después de línea 320, junto a `ToolEvent`)

```typescript
export interface EmotionEvent {
  event: "emotion_event";
  session_id: string;
  emotions: string[];   // lista completa del turno
  final: string | null; // última emoción (la que se muestra)
}
```

Añadir `"emotion_event"` al tipo union de eventos entrantes que use `useChat` (verificar dónde está el `IncomingEvent` union).

#### T3.2 — Estado `emotionEvents` + handler WS en `useChat`

**Archivo**: `kali-web/src/hooks/useChat.ts`

- Añadir a `ChatState` (alrededor de línea 128-129):
  ```typescript
  emotionEvents: EmotionEvent[];
  ```
- Añadir `useState`:
  ```typescript
  const [emotionEvents, setEmotionEvents] = useState<EmotionEvent[]>([]);
  ```
- Añadir handler WS (después del handler de `tool_event`, línea 502):
  ```typescript
  client.on("emotion_event", (p) => {
    setEmotionEvents((prev) => [...prev, p as EmotionEvent]);
  });
  ```
- Limpiar en `newSession` / reset (junto con `setToolEvents([])`, líneas 938/974):
  ```typescript
  setEmotionEvents([]);
  ```

#### T3.3 — Reconciliación mínima de `toolEvents`

**Archivo**: `kali-web/src/hooks/useChat.ts:483-502`

Reemplazar el append puro por reconciliación por `(session_id, tool)`:

```typescript
client.on("tool_event", (p) => {
  const ev = p as ToolEvent;
  setToolEvents((prev) => {
    const key = `${ev.session_id}::${ev.tool}`;
    if (ev.status === "running") {
      // Reemplazar el último running de esta tupla, o append si no hay
      const lastRunningIdx = [...prev].reverse().findIndex(
        (e) => `${e.session_id}::${e.tool}` === key && e.status === "running"
      );
      if (lastRunningIdx >= 0) {
        const realIdx = prev.length - 1 - lastRunningIdx;
        const next = [...prev];
        next[realIdx] = ev;
        return next;
      }
      return [...prev, ev];
    }
    // Terminal: marcar el último running de esta tupla como terminado
    const lastRunningIdx = [...prev].reverse().findIndex(
      (e) => `${e.session_id}::${e.tool}` === key && e.status === "running"
    );
    if (lastRunningIdx >= 0) {
      const realIdx = prev.length - 1 - lastRunningIdx;
      const next = [...prev];
      next[realIdx] = ev;
      return next;
    }
    return [...prev, ev];
  });
  // ... el resto del handler de messages se mantiene igual
});
```

Añadir purga de `toolEvents` terminados tras TTL:

```typescript
// useRef para el timer de purga
const toolGcRef = useRef<number | null>(null);

// Dentro del handler de tool_event, después de setToolEvents:
if (ev.status !== "running") {
  if (toolGcRef.current) clearTimeout(toolGcRef.current);
  toolGcRef.current = window.setTimeout(() => {
    setToolEvents((prev) => prev.filter((e) => e.status === "running"));
  }, 3000);
}
```

**Restricción R1**: documentar en un comentario que sin `call_id` del backend, dos llamadas concurrentes a la misma tool pueden pisarse.

---

### Etapa 4 — Frontend: `EmotionProvider` (plugpoint arquitectural)

> **Depende de**: Etapa 3 (necesita `EmotionEvent` de `protocol.ts`).
>
> **Paralelizable con**: Etapa 5 (archivos distintos). Etapa 4 crea archivos nuevos en `kali-web/src/avatar/`; Etapa 5 modifica `avatarConfig.ts`, `AvatarMoodEngine.ts`, crea `avatarStateMachine.ts`. Sin conflicto.
>
> **Bloquea a**: Etapa 5 (la máquina de estados usa `EmotionProvider`).

#### T4.1 — Interfaz `EmotionProvider`

**Archivo**: `kali-web/src/avatar/EmotionProvider.ts` (nuevo)

```typescript
import type { AvatarEmotion } from "./avatarConfig";
import type { ToolEvent } from "../lib/protocol";

export interface EmotionResult {
  emotion: AvatarEmotion | null;  // null = "mantener humor actual"
  confidence: number;
  /** Futuro: humor continuo (valencia + arousal). Undefined por ahora (R2). */
  continuous?: { valence: number; arousal: number };
}

export interface EmotionContext {
  emotionEvents: Array<{ final: string | null }>;
  toolEvents: ToolEvent[];
  chatError: string | null;
  now: number;
}

export interface EmotionProvider {
  getEmotion(ctx: EmotionContext): Promise<EmotionResult>;
}
```

#### T4.2 — `LLMEmotionProvider`

**Archivo**: `kali-web/src/avatar/LLMEmotionProvider.ts` (nuevo)

```typescript
import type { AvatarEmotion } from "./avatarConfig";
import type { EmotionProvider, EmotionResult, EmotionContext } from "./EmotionProvider";

const VALID_EMOTIONS: ReadonlySet<string> = new Set([
  "normal", "enojado", "sorprendido", "ronroneando",
  "feliz", "confundido", "concentrado", "esperando",
]);

export class LLMEmotionProvider implements EmotionProvider {
  async getEmotion(ctx: EmotionContext): Promise<EmotionResult> {
    const lastEvent = ctx.emotionEvents[ctx.emotionEvents.length - 1];
    if (!lastEvent || !lastEvent.final) {
      return { emotion: null, confidence: 0 };
    }
    const raw = lastEvent.final;
    if (!VALID_EMOTIONS.has(raw)) {
      return { emotion: "normal", confidence: 0.5 };
    }
    return { emotion: raw as AvatarEmotion, confidence: 0.9 };
  }
}
```

#### T4.3 — `LocalModelEmotionProvider` (stub)

**Archivo**: `kali-web/src/avatar/LocalModelEmotionProvider.ts` (nuevo)

```typescript
import type { EmotionProvider, EmotionResult, EmotionContext } from "./EmotionProvider";

/**
 * Placeholder para futuro modelo local de inferencia de emociones.
 * No implementado — retorna siempre normal (R3).
 * El toggle de UI permite seleccionarlo pero no cambia comportamiento visible.
 */
export class LocalModelEmotionProvider implements EmotionProvider {
  async getEmotion(_ctx: EmotionContext): Promise<EmotionResult> {
    return { emotion: "normal", confidence: 0 };
  }
}
```

---

### Etapa 5 — Frontend: máquina de estados + humor persistente

> **Depende de**: Etapa 4 (usa `EmotionProvider`).
>
> **Paralelizable con**: Etapa 3 (archivos distintos), Etapa 4 (archivos distintos).
>
> **Bloquea a**: Etapa 6 (DebugPad necesita los nuevos tipos) y Etapa 7 (CSS necesita las nuevas emociones en el enum).

#### T5.1 — Extender `AvatarEmotion`

**Archivo**: `kali-web/src/avatar/avatarConfig.ts:25-31`

```typescript
export type AvatarEmotion =
  | "normal" | "enojado" | "sorprendido" | "ronroneando"
  | "feliz" | "confundido" | "concentrado" | "esperando";
```

**Notas**:
- No se agrega `trabajando` al `AvatarState` — la concentración es una emoción, no un estado. Los estados siguen siendo `idle | escuchando | pensando | hablando`.
- No se agrega `durmiendo` todavía (queda la regla CSS huérfana para el futuro).

#### T5.2 — Funciones puras de derivación

**Archivo**: `kali-web/src/avatar/avatarStateMachine.ts` (nuevo)

```typescript
import type { AvatarState, AvatarEmotion } from "./avatarConfig";
import type { EmotionProvider, EmotionContext } from "./EmotionProvider";
import type { DebugAvatarState } from "./debugAvatarState";

export interface AvatarContext extends EmotionContext {
  debug: DebugAvatarState;
  consentRequest: unknown | null;
  ttsPlaying: boolean;
  pttState: "idle" | "recording" | "listening";
  streaming: boolean;
  typing: boolean;
  overrideEmotion?: { emotion: AvatarEmotion; until: number } | null;
  currentMood: AvatarEmotion;  // humor persistente
  emotionProvider: EmotionProvider;
}

/** Deriva el estado programático (prioridad, primera que gana). */
export function deriveState(ctx: AvatarContext): AvatarState {
  if (ctx.debug.overrideState) return ctx.debug.overrideState;
  if (ctx.consentRequest) return "idle";
  if (ctx.toolEvents.some((e) => e.status === "running")) return "idle";
  if (ctx.ttsPlaying) return "hablando";
  if (ctx.pttState === "recording" || ctx.pttState === "listening") return "escuchando";
  if (ctx.streaming) return "pensando";
  return "idle";
}

/**
 * Deriva la emoción (prioridad, primera que gana).
 * Es async porque consulta el EmotionProvider.
 */
export async function deriveEmotion(
  ctx: AvatarContext,
  state: AvatarState,
): Promise<AvatarEmotion> {
  // 1. Click override (ronroneando tras acariciar)
  if (ctx.overrideEmotion && ctx.now < ctx.overrideEmotion.until) {
    return ctx.overrideEmotion.emotion;
  }

  // 2. Debug force
  if (ctx.debug.overrideEmotion && ctx.debug.forceEmotion) {
    return ctx.debug.overrideEmotion;
  }

  // 3. Tool running → concentrrado (reemplaza el antiguo enojado)
  if (ctx.toolEvents.some((e) => e.status === "running")) {
    return "concentrado";
  }

  // 4. Consent pendiente → esperando
  if (ctx.consentRequest) {
    return "esperando";
  }

  // 5. Tool error sin emoción del LLM → confundido (D22)
  const lastTool = ctx.toolEvents[ctx.toolEvents.length - 1];
  if (lastTool && lastTool.status === "error") {
    const llmResult = await ctx.emotionProvider.getEmotion(ctx);
    if (!llmResult.emotion) {
      return "confundido";  // persiste (no es temporal)
    }
  }

  // 6. Emoción del LLM
  const llmResult = await ctx.emotionProvider.getEmotion(ctx);
  if (llmResult.emotion) {
    return llmResult.emotion;
  }

  // 7. Fallback → mantiene humor actual (D12/D13)
  return ctx.currentMood;
}
```

**Notas**:
- La regla `if (state === "pensando" || state === "escuchando") → normal` del motor actual (`AvatarMoodEngine.ts:96-99`) se **elimina**. La emoción se deriva del contexto, no del estado.
- `hablando` ya NO fuerza `normal` (D17). Si el LLM emitió `enojado`, se ve durante el TTS.

#### T5.3 — Hook refactorizado

**Archivo**: `kali-web/src/avatar/AvatarMoodEngine.ts`

Refactorizar a glue React que llama a las funciones puras. Cambios:

- **Humor persistente** (`currentMood`): `useState<AvatarEmotion>("normal")`. Sobrevive entre turnos. Se actualiza cuando `deriveEmotion` devuelve una emoción del LLM o un fallback que difiere.
- **Derivación de estado**: `useMemo` con `deriveState(ctx)`.
- **Derivación de emoción**: `useEffect` que llama `deriveEmotion(ctx, state)` (es async). Al resolver, si la emoción difiere de `currentMood`, actualiza `currentMood` y `emotion`.
- **Timers**: un solo `emotionTimer` ref. **Siempre** limpiar antes de setear. Transiciones temporales: `concentrado → feliz` tras tool success (2s), `concentrado → confundido` tras tool error sin emoción LLM (persiste, no temporal).
- **Timeout de seguridad para stale tool running**: al entrar en `concentrado`, programar `setTimeout(TOOL_STALE_MS)` (20s por defecto, configurable en `emotionConfig.ts`). Si al dispararse sigue habiendo un `running` sin terminal, purgar ese `running` (emitir un evento interno o marcarlo como cancelado en el estado local) y volver a `currentMood`.
- **Cleanup en unmount**: el `useEffect` retorna `() => { if (emotionTimer.current) clearTimeout(emotionTimer.current); if (staleTimer.current) clearTimeout(staleTimer.current); }`.
- **`EmotionProvider`**: instanciar `LLMEmotionProvider` por defecto. El toggle de config (T8.1) switchea a `LocalModelEmotionProvider` si el usuario lo selecciona (aunque no cambia comportamiento, R3).

#### T5.4 — Config de constantes

**Archivo**: `kali-web/src/avatar/emotionConfig.ts` (nuevo)

```typescript
export const EMOTION_CONFIG = {
  toolStaleMs: 20_000,
  toolGcMs: 3_000,
  successEmotionMs: 2_000,
  errorEmotionMs: 3_000,
} as const;
```

#### T5.5 — Tests de la máquina de estados

**Archivo**: `kali-web/src/avatar/avatarStateMachine.test.ts` (nuevo)

Casos de test (vitest, siguiendo el patrón de `textEmotionAnalyzer.test.ts`):

1. **Regresión del síntoma**: `toolEvents` con `running` → emoción `concentrado`, NO `enojado`.
2. **Precedencia override > debug > tool > LLM > fallback**: un test por cada par adyacente.
3. **Humor persistente**: sin emoción del LLM y sin tool → retorna `currentMood`.
4. **Stale tool running**: `running` con timestamp > `toolStaleMs` → la derivación trata como terminado, vuelve a `currentMood`. (Para esto, el contexto incluye `now` inyectable.)
5. **Tool error sin emoción LLM**: último tool `error`, `EmotionProvider` retorna `null` → emoción `confundido`.
6. **Tool error con emoción LLM**: último tool `error`, `EmotionProvider` retorna `feliz` → emoción `feliz` (el LLM decide cómo reaccionar al error).
7. **Emoción del LLM durante `hablando`**: `ttsPlaying=true`, `EmotionProvider` retorna `enojado` → emoción `enojado` (no `normal`).
8. **Consent pendiente**: `consentRequest` presente → emoción `esperando`.
9. **Click override**: `overrideEmotion = { emotion: "ronroneando", until: future }` → `ronroneando` pisa todo.
10. **Snapshot de turno completo**: secuencia de contextos (user input → tool running → success → LLM emite feliz → idle) → snapshot de `(state, emotion)` en cada paso.

Mock del `EmotionProvider`: un `MockEmotionProvider` que retorna un `EmotionResult` configurable por test.

---

### Etapa 6 — Frontend: DebugPad + simuladores

> **Depende de**: Etapa 5 (necesita los nuevos tipos de emoción).
>
> **Paralelizable con**: Etapa 7 (CSS es independiente del DebugPad).

#### T6.1 — Botones de debug para nuevas emociones

**Archivo**: `kali-web/src/stage/DebugPad.tsx:235-241`

Añadir botones después de `Confundido`:

```tsx
<Button onClick={() => debug.setAvatarEmotion("concentrado", forceEmotion)}>Concentrado</Button>
<Button onClick={() => debug.setAvatarEmotion("esperando", forceEmotion)}>Esperando</Button>
```

#### T6.2 — Simulador de `emotion_event`

**Archivo**: `kali-web/src/hooks/useDebug.ts` (después de `simulateToolError`, línea 180)

```typescript
const simulateEmotion = useCallback((emotion: string) => {
  if (!clientRef.current) return;
  clientRef.current.simulate({
    event: "emotion_event",
    session_id: "debug",
    emotions: [emotion],
    final: emotion,
  } as unknown as EmotionEvent);
}, []);
```

Añadir a la interfaz `DebugApi` y exportar. Añadir botones en el DebugPad para emitir emociones simuladas:

```tsx
<Section title="Emociones LLM" forceOpen={allExpanded}>
  <Button onClick={() => debug.simulateEmotion("feliz")}>Feliz</Button>
  <Button onClick={() => debug.simulateEmotion("enojado")}>Enojado</Button>
  <Button onClick={() => debug.simulateEmotion("sorprendido")}>Sorprendido</Button>
  <Button onClick={() => debug.simulateEmotion("confundido")}>Confundido</Button>
</Section>
```

---

### Etapa 7 — CSS: nuevas caras + micro-animación

> **Depende de**: Etapa 5 (necesita las emociones en el enum para que `data-mood` las use).
>
> **Paralelizable con**: Etapa 6 (CSS no depende del DebugPad).

#### T7.1 — Cara de `concentrado`

**Archivo**: `kali-web/src/styles.css` (después de las reglas de `enojado`, línea 1295)

```css
#avatar-svg[data-mood="concentrado"] .angry-eyelid { display: none; }
#avatar-svg[data-mood="concentrado"] .mouth-closed { display: block; }
#avatar-svg[data-mood="concentrado"] .mouth-angry { display: none; }
#avatar-svg[data-mood="concentrado"] .avatar-animate { animation: avatarFocusBreath 3.5s ease-in-out infinite; }
#avatar-svg[data-mood="concentrado"] .presence-halo { animation: avatarHaloFocus 4.8s ease-in-out infinite; }
#avatar-svg[data-mood="concentrado"] .brow-left { transform: rotate(6deg) translateY(2px); opacity: 0.7; }
#avatar-svg[data-mood="concentrado"] .brow-right { transform: rotate(-6deg) translateY(2px); opacity: 0.7; }
#avatar-svg[data-mood="concentrado"] .cheek-left,
#avatar-svg[data-mood="concentrado"] .cheek-right { opacity: 0.15; }
/* Micro-animación: parpadeo lento + micro-movimiento de orejas */
#avatar-svg[data-mood="concentrado"] .eyelid-left,
#avatar-svg[data-mood="concentrado"] .eyelid-right { animation: avatarFocusBlink 4s ease-in-out infinite; }
#avatar-svg[data-mood="concentrado"] .left-ear { animation: avatarWorkingEarLeft 6s ease-in-out infinite; }
#avatar-svg[data-mood="concentrado"] .right-ear { animation: avatarWorkingEarRight 6s ease-in-out infinite 0.3s; }
```

**Keyframes nuevos** (al final del archivo, junto a los demás `@keyframes`):

```css
@keyframes avatarFocusBreath {
  0%, 100% { transform: scale(1) translateY(0); }
  50% { transform: scale(1.005) translateY(-1px); }
}
@keyframes avatarHaloFocus {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.02); }
}
@keyframes avatarFocusBlink {
  0%, 90%, 100% { transform: scaleY(1); }
  93%, 96% { transform: scaleY(0.1); }
}
@keyframes avatarWorkingEarLeft {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-3deg); }
}
@keyframes avatarWorkingEarRight {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(3deg); }
}
```

**Diferencia clave con `enojado`**: boca neutral (no fruncida), cejas ±6° (no ±12°), pupilas normales (sin `scaleX(0.12)`), orejas animadas (no aplastadas ±38°). El avatar se ve enfocado, no agresivo.

#### T7.2 — Cara de `esperando`

**Archivo**: `kali-web/src/styles.css` (después de `concentrado`)

```css
#avatar-svg[data-mood="esperando"] .angry-eyelid { display: none; }
#avatar-svg[data-mood="esperando"] .mouth-closed { display: block; }
#avatar-svg[data-mood="esperando"] .mouth-angry { display: none; }
#avatar-svg[data-mood="esperando"] .avatar-animate { animation: avatarBreathe 4.6s ease-in-out infinite; }
#avatar-svg[data-mood="esperando"] .brow-left { transform: translateY(-4px) rotate(-2deg); opacity: 0.75; }
#avatar-svg[data-mood="esperando"] .brow-right { transform: translateY(-4px) rotate(2deg); opacity: 0.75; }
#avatar-svg[data-mood="esperando"] .pupil-core { transform: scale(1.05); }
#avatar-svg[data-mood="esperando"] .eyelid-left,
#avatar-svg[data-mood="esperando"] .eyelid-right { transform: scaleY(0.9); animation: none; }
```

**Diferencia con `enojado`**: cejas levantadas (no fruncidas), ojos abiertos, postura atenta sin agresividad.

#### T7.3 — Ajuste de `hablando` + emoción coexistente

**Archivo**: `kali-web/src/styles.css:1251-1260`

Las reglas de `hablando` ya no fuerzan mood. Verificar que `.mouth-opened` (hablando) coexista con `.mouth-angry` (enojado). Si hay conflicto (ambas quieren controlar la boca), priorizar `.mouth-opened` durante TTS y `.mouth-angry` cuando TTS termina.

Añadir especificidad:

```css
/* Durante hablando, la boca abierta tiene prioridad sobre la emoción */
#avatar-svg[data-state="hablando"] .mouth-opened { opacity: 1 !important; }
#avatar-svg[data-state="hablando"] .mouth-closed { opacity: 0 !important; }
#avatar-svg[data-state="hablando"] .mouth-angry { display: none; }
```

**Notas**: la emoción se sigue reflejando en cejas, orejas, pupilas, parpadeo — solo la boca se cede al TTS durante `hablando`.

#### T7.4 — `aria-live` accesible

**Archivo**: `kali-web/src/avatar/AvatarSVG.tsx`

Añadir un nodo `aria-live="polite"` oculto que anuncia cambios de **estado** (no de emoción — sería ruido), con debounce 500ms:

```tsx
// En el componente AvatarSVG:
const [ariaMessage, setAriaMessage] = useState("");
useEffect(() => {
  const timer = setTimeout(() => {
    const stateLabels: Record<AvatarState, string> = {
      idle: "Inactivo",
      escuchando: "Escuchando",
      pensando: "Pensando",
      hablando: "Hablando",
    };
    setAriaMessage(stateLabels[state] ?? "");
  }, 500);
  return () => clearTimeout(timer);
}, [state]);

// En el JSX del return:
<span aria-live="polite" className="sr-only">{ariaMessage}</span>
```

Añadir clase `.sr-only` en `styles.css` si no existe (estándar de accesibilidad).

---

### Etapa 8 — Toggle de UI para `EmotionProvider`

> **Depende de**: Etapa 4 (necesita la interfaz `EmotionProvider`).
>
> **Paralelizable con**: Etapa 6, Etapa 7.

#### T8.1 — Toggle en settings

**Archivo**: `kali-web/src/components/settings/` (buscar el componente de settings de avatar o crear uno si no existe)

Añadir un toggle "Mecanismo de emoción" con dos opciones:
- **LLM (default, activo)**: usa `LLMEmotionProvider`.
- **Modelo local (deshabilitado)**: usa `LocalModelEmotionProvider`. Tooltip: "Próximamente — inferencia local de emociones".

Persistir la elección en localStorage (junto con `AvatarConfig` o por separado). El `AvatarMoodEngine` lee esta config al instanciar el provider.

**Notas**:
- Como `LocalModelEmotionProvider` es stub (R3), activarlo no cambia el comportamiento visible. El toggle existe como placeholder arquitectural para la futura integración.

---

## Matriz de paralelización

```
Tiempo →   ──────────────────────────────────────────────────────────────►

Etapa 1 ████████                                              (kali-core, aislada)
Etapa 2 ████████                                              (kali-core, coordina runtime.py con Etapa 1)
          │
          ├─ Etapa 1 y 2 paralelas (archivos distintos, mismo paquete)
          │  Coordinar: no tocar runtime.py simultáneamente
          │
          ▼ (Etapa 2 completa → emotion_event WS listo)
          │
Etapa 3    ████████                                           (kali-web, protocol.ts + useChat.ts)
Etapa 5         ████████                                      (kali-web, avatarStateMachine + AvatarMoodEngine)
          │    ├─ Etapa 3 y 5 paralelas (archivos distintos)
          │    │  Etapa 5 depende de Etapa 4 → ver abajo
          │    │
          ▼    ▼
Etapa 4         ████████                                      (kali-web, EmotionProvider, depende de Etapa 3)
          │         │
          │         ▼ (Etapa 4 completa → EmotionProvider listo)
          │         │
          │    Etapa 5 puede empezar (necesita EmotionProvider)
          │
          ▼ (Etapa 3, 4, 5 completas)
          │
Etapa 6              ████████                                 (kali-web, DebugPad, depende de Etapa 5)
Etapa 7              ████████                                 (kali-web, CSS, depende de Etapa 5)
Etapa 8              ████████                                 (kali-web, settings toggle, depende de Etapa 4)
          │          ├─ Etapas 6, 7, 8 paralelas (archivos distintos)
          │          │
          ▼          ▼
Etapa 9                       ████████                        (tests finales + verificación manual)
```

### Resumen de dependencias

| Etapa | Depende de | Bloquea a | Paralelizable con |
|-------|------------|-----------|-------------------|
| 1 | — | 3 (indirectamente) | 2 |
| 2 | — | 3 | 1 |
| 3 | 2 | 4 | 5 |
| 4 | 3 | 5, 8 | — |
| 5 | 4 | 6, 7 | 3 |
| 6 | 5 | — | 7, 8 |
| 7 | 5 | — | 6, 8 |
| 8 | 4 | — | 6, 7 |

### Asignación sugerida de agentes

- **Agente A (backend)**: Etapa 1 → Etapa 2. Secuenciales dentro del mismo agente (comparten contexto de `kali-core`).
- **Agente B (frontend core)**: Espera a Etapa 2 → Etapa 3 → Etapa 4 → Etapa 5. Secuenciales (cada una depende de la anterior).
- **Agente C (frontend UI)**: Espera a Etapa 5 → Etapa 6 + Etapa 7 + Etapa 8 en paralelo (o un agente que las hace en secuencia, son chicas).
- **Agente D (tests)**: Etapa 9 después de que todo termine.

**Máximo paralelismo real**: 2 agentes simultáneos (Agente A en backend, Agente B en frontend core) una vez que Etapa 2 está completa. Antes de eso, solo Agente A trabaja.

---

## Archivos a tocar (resumen)

### `kali-core` (backend)

| Archivo | Etapa | Cambio |
|---------|-------|--------|
| `kali-core/kali_core/mind/emotion_catalog.json` (nuevo) | 1 | Catálogo compartido |
| `kali-core/kali_core/mind/emotion_prompt.py` (nuevo) | 1 | Constructor del fragmento del system prompt |
| `kali-core/kali_core/mind/llm/direct.py:193` | 1 | Inyectar fragmento en system prompt |
| `kali-core/tests/test_emotion_prompt.py` (nuevo) | 1 | Tests del system prompt |
| `kali-core/kali_core/mind/emotion_filter.py` (nuevo) | 2 | `EmotionStreamFilter` |
| `kali-core/kali_core/mind/llm/provider.py:35` | 2 | Nuevo `kind: "emotion"` en `StreamEvent` |
| `kali-core/kali_core/mind/runtime.py:291-394` | 2 | Integrar `EmotionStreamFilter` en el loop |
| `kali-core/kali_core/yarn/protocol.py:34` | 2 | Añadir `"emotion_event"` a `EventTypeOut` |
| `kali-core/kali_core/server.py:3063-3088` | 2 | Manejar `event.kind == "emotion"` → emitir WS |
| `kali-core/tests/test_emotion_filter.py` (nuevo) | 2 | Tests del parser |

### `kali-web` (frontend)

| Archivo | Etapa | Cambio |
|---------|-------|--------|
| `kali-web/src/lib/protocol.ts` | 3 | Tipo `EmotionEvent` |
| `kali-web/src/hooks/useChat.ts` | 3 | Estado `emotionEvents` + handler WS + reconciliación toolEvents |
| `kali-web/src/avatar/EmotionProvider.ts` (nuevo) | 4 | Interfaz + tipos |
| `kali-web/src/avatar/LLMEmotionProvider.ts` (nuevo) | 4 | Implementación LLM |
| `kali-web/src/avatar/LocalModelEmotionProvider.ts` (nuevo) | 4 | Stub para futuro |
| `kali-web/src/avatar/avatarConfig.ts:25-31` | 5 | + `concentrado`, `esperando` |
| `kali-web/src/avatar/avatarStateMachine.ts` (nuevo) | 5 | `deriveState`/`deriveEmotion` puras |
| `kali-web/src/avatar/avatarStateMachine.test.ts` (nuevo) | 5 | Tests |
| `kali-web/src/avatar/emotionConfig.ts` (nuevo) | 5 | Constantes configurables |
| `kali-web/src/avatar/AvatarMoodEngine.ts` | 5 | Refactor: humor persistente + timers + cleanup + stale timeout |
| `kali-web/src/stage/DebugPad.tsx:235-241` | 6 | + botones `Concentrado`, `Esperando` + sección "Emociones LLM" |
| `kali-web/src/hooks/useDebug.ts` | 6 | `simulateEmotion` |
| `kali-web/src/styles.css` | 7 | + reglas `concentrado`/`esperando`, keyframes, ajuste `hablando`, `.sr-only` |
| `kali-web/src/avatar/AvatarSVG.tsx` | 7 | `aria-live` oculto con debounce |
| `kali-web/src/components/settings/` | 8 | Toggle "Mecanismo de emoción" |

---

## Verificación

### Automática

1. **Backend**:
   ```bash
   cd kali-core && pytest tests/test_emotion_prompt.py tests/test_emotion_filter.py -v
   ```
2. **Frontend typecheck**:
   ```bash
   cd kali-web && npm run typecheck
   ```
3. **Frontend tests**:
   ```bash
   cd kali-web && npm run test
   ```
4. **Frontend lint**:
   ```bash
   cd kali-web && npm run lint
   ```

### Manual — DebugPad

Forzar cada emoción desde el DebugPad y dar ok visual:
- [ ] `normal` — cara neutra, parpadeo normal
- [ ] `enojado` — cejas fruncidas ±12°, boca fruncida, pupilas en rendija, orejas aplastadas
- [ ] `sorprendido` — ojos abiertos, cejas levantadas
- [ ] `ronroneando` — ojos cerrados, mejillas sonrosadas
- [ ] `feliz` — cejas levantadas, mejillas sonrosadas
- [ ] `confundido` — cabeza inclinada, cejas asimétricas
- [ ] `concentrado` (nueva) — cejas ±6°, boca neutral, respiración lenta, micro-animación de orejas
- [ ] `esperando` (nueva) — cejas levantadas, ojos abiertos, postura atenta

### Manual — 5 escenarios de validación (D18)

Validar cada escenario con el backend real + frontend real. Dar ok uno por uno.

| # | Acción | Estado esperado | Emoción esperada | OK |
|---|--------|-----------------|------------------|----|
| 1 | Pedir tarea compleja (tool running → success) | `idle` → `idle` → `idle` | `concentrado` → `feliz` (2s) → `normal` | [ ] |
| 2 | Agradecer ("gracias, quedó genial") + LLM emite `feliz` | `idle` → `hablando` → `idle` | `feliz` persiste durante `hablando` y después | [ ] |
| 3 | Insultar ("sos inútil") + LLM emite `enojado` | `idle` → `hablando` → `idle` | `enojado` persiste, y persiste al turno siguiente | [ ] |
| 4 | Tool falla sin emoción del LLM | `idle` → `idle` → `idle` | `concentrado` → `confundido` (persiste) | [ ] |
| 5 | LLM crea algo y emite `feliz` | `idle` → `hablando` → `idle` | `feliz` durante `hablando` y después | [ ] |

### Manual — texto del chat

- [ ] Verificar que el stream del chat **no** muestra `<emotion:.../>` en el texto visible en ningún escenario.

### Manual — stale tool running

- [ ] Iniciar una tarea larga, matar el backend a mitad, esperar 20s → el avatar vuelve a `currentMood` (no se queda en `concentrado` permanentemente).

---

## Definición de "terminado"

El plan está terminado cuando:

1. Todos los tests automáticos pasan (backend + frontend).
2. El typecheck y lint pasan sin errores.
3. Las 8 emociones se pueden forzar desde el DebugPad y se ven distintas (ok manual).
4. Los 5 escenarios de validación se comportan como se espera (ok manual uno por uno).
5. El texto del chat nunca muestra `<emotion:.../>`.
6. El stale tool running no deja al avatar pegado.

**Criterio fundamental (D11)**: el asistente puede utilizar el espectro de emociones disponibles dado el contexto — el LLM emite emociones que se reflejan en el avatar, y las emociones programáticas (`concentrado`, `esperando`) reemplazan al `enojado` sobrecargado.