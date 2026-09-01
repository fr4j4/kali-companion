# SPEC — TTS Realtime para kali-companion

> Estado: **Propuesta validada contra el código** (auditoría 2026-09-01, rama `feature/ui3d-mvp`).
> Objetivo: eliminar la demora percibida entre la respuesta del LLM y la voz, y eliminar los
> artefactos ("habla raro") reportados en uso con Qwen3-TTS.
> Autor: elaborada con Hermes a partir de benchmarks medidos (Audio8 SGLang/ONNX, Qwen3 0.6B/1.7B)
> y auditoría del código de `kali-core/kali_core/server.py`, `voice/pipeline.py`, `voice/filter.py`,
> `kali-web/src/hooks/useTTS.ts`, `kali-web/src/lib/protocol.ts`.

---

## 1. Problema (verificado en código)

### 1.1 Demora en el audio
`server.py:_synthesize_tts` se invoca **solo en `turn_end`** (`server.py:3148`,
desde `:3146-3148`), con el texto **completo acumulado** (`accumulated`,
línea 3087). El flujo actual es **estrictamente serial**:

```
[usuario habla] → [LLM genera TODO] → [turn_end] → [filter] → [segment]
→ [synthesize segmento 1..N secuencial] → [tts_audio x N] → [front reproduce]
```

Latencia percibida = `LLM completo + TTS completo`, aunque ambos pasos por
separado sean rápidos (Qwen3 0.6B: RTF 0.21 medido → 4.6s de audio en ~1s;
Piper: instantáneo). La demora NO es del motor TTS: es del punto de disparo.

### 1.2 Artefactos de voz ("habla raro")
Tres causas identificadas en código:
1. `filter_for_tts` (`filter.py:56-122`) cubre código/URLs/markdown/emojis,
   pero deja pasar símbolos residuales (`*`, `_`, `>`, `#` sueltos),
   puntuación repetida (`!!!`, `...`) y marcadores de cita (`[1]`, `【】`)
   que los LLMs emiten y algunos motores pronuncian o truncan mal.
2. `segment_for_tts` con `max_chunk=500` (pipeline.py:34) produce bloques de
   ~30s de audio: cortes de entonación entre segmentos perceptibles al
   encadenarse y mayor espera por segmento.
3. El front reproduce segmentos en cola rígida (`useTTS.ts`, `queueRef` +
   `src.onended → playNext`): cualquier jitter de red/decode produce huecos
   audibles (falta buffer de tolerancia).

### 1.3 No es un problema del motor TTS
Mismos síntomas con Qwen3 (0.6B/1.7B) y (en menor grado) cualquier provider —
el disparador en `turn_end` es común a todos. Cambiar de motor NO resuelve.

---

## 2. Qué ya existe (reutilizable sin cambios)

| Componente | Archivo | Listo para |
|---|---|---|
| Filtrado de texto para speech | `voice/filter.py:filter_for_tts` | ✅ (extender en P4) |
| Segmentación por oración ≤ max_chunk | `voice/filter.py:segment_for_tts` (`re.split(r"(?<=[.!?])\s+")`) | ✅ (bajar default en P1) |
| Síntesis por segmento (async provider) | `voice/pipeline.py:synthesize_stream` | ✅ reutilizar per-segmento |
| Reproducción ordenada por `segment` | `kali-web/src/hooks/useTTS.ts` (cola + `src.onended`) | ✅ ya soporta out-of-order arrival |
| Evento WS `tts_audio` con `segment`/`total_segments` | `kali-web/src/lib/protocol.ts:266-273` | ✅ (usar índices reales) |
| Provider HTTP genérico | `voice/providers/http.py` vía `KALI_TTS_PROVIDER=http` | ✅ para Audio8-SGLang sin código |
| Métricas | `turn_stats` con `first_token_latency` (`server.py:3138-3144`) | ✅ añadir métrica TTS |

---

## 3. Diseño objetivo

### 3.1 Flujo nuevo (P0)

```
LLM delta ──► buffer de frase
   │                └─(detecta [.!?…]\n)──► dispatch segmento → cola TTS
   │                                              │
   │ (el LLM SIGUE fluyendo)             synthesize en background
   ▼                                              ▼
turn_end (resto pendiente)  ────────►  tts_audio (seg k, idx real)
```

- El TTS corre **en paralelo** con la generación del LLM (fire-and-forget por
  frase, no `await` dentro del bucle del stream).
- El orden de emisiión de `tts_audio` lo garantiza una cola async
  (`asyncio.Queue` con worker dedicado), no el orden de finalización.

### 3.2 Invariantes (no negociables)

1. **Orden de reproducción**: los `tts_audio` llegan al front con `segment`
   creciente por turno; el front ya encola por índice — mantener promesa.
2. **No bloquear el stream del LLM**: ninguna `await` de TTS dentro del
   `async for` de `agent.respond`.
3. **Cancelación**: si el usuario cancela el turno (`CancelledError`,
   `server.py:3110-3129`), cancelar también las tareas TTS pendientes y vaciar
   la cola; enviar `tts_audio` con flag o `tts_cancel` al front.
4. **Persistencia**: el texto grabado en `session_store` sigue siendo el
   `accumulated` completo (el TTS no altera el historial).
5. **Compatibilidad**: si `auto_tts` false o provider `null`, comportamiento
   idéntico al actual.

### 3.3 Cambio de contrato WS

`TtsAudioEvent.total_segments` hoy es `-1` (desconocido) y el front lo tolera.
Novedades de protocolo (backward-compatible):

```ts
// protocol.ts — sin breaking changes
{
  event: "tts_audio",
  audio: string,          // base64 WAV (sin cambio)
  segment: number,        // índice real por frase (antes siempre -1)
  total_segments: number, // -1 sigue siendo válido en streaming
  text: string,           // texto del segmento (para captions/debug)
  duration: number,
  first: boolean          // NUEVO: true en el primer segmento del turno
                          // (el front lo usa para métricas y buffer)
}
```

Además, nuevo evento informativo (opcional, P5): `{"event":"tts_first_audio",
"session_id":..., "latency_ms":...}` emitido por el core para el `turn_stats`
extendido — sirve para medir la mejora real (ver §9).

---

## 4. Implementación por fases

### P0 — Streaming TTS frase-a-frase desde el LLM  *(core: `server.py`)*

**Cambios:**
1. Nuevo helper `_sentence_splitter_stream()` — acumula deltas y cede frases
   completas cuando detecta `[.!?…](\s|$)` + mínimo de ~20 chars para evitar
   micro-frases ("Sr.", "etc.").
2. En el bucle del stream (server.py:3083-3131), reemplazar la acumulación
   pasiva por: `sentence_q: asyncio.Queue[str|None]` — productor en el bucle
   (`put_nowait(sentence)`), consumidor como task paralela que por cada frase
   llama `pipeline.synthesize_stream(sentence)` y emite `tts_audio` con
   `segment` incremental (sin conocer total → `-1`, igual que hoy).
3. En `done`/cancel/error: `put(None)` para cerrar consumidor + `cancel()` de
   tareas TTS vivas.
4. `_synthesize_tts` se renombra `_synthesize_tts_stream(queue_reader)` o se
   mantiene con nuevo modo `live=True`.

**Criterios de aceptación (validación):**
- AC1: con respuesta de LLM de 3 oraciones, el primer `tts_audio` llega al front
  **antes** de `turn_end` (verificable por timestamp de WS log).
- AC2: los segmentos se reproducen en orden (front encola por segment).
- AC3: cancelar a mitad de respuesta no deja audio huérfano sonando.
- AC4: con `auto_tts=false`, cero regresiones.
- AC5: suite `kali-core/tests/` verde (regression gates).

### P1 — Max_chunk 500 → 200 *(core: `voice/pipeline.py:34`)*

Frases de ~150-200 chars ≈ 9-12s de audio se sintetizan en ~0.5-1s (Qwen
RTF 0.21; Audio8 SGLang 0.30) → cada bloque llega rápido desde su emisión.
**Motivo del 150-200:** reporte oficial Audio8 recomienda ≤150; Qwen estable
hasta ~500. 200 es el compromiso (pocos cortes por frase en español).
AC: los segmentos máximos contienen ≥2 oraciones completas (no parte de frase).

### P2 — Pipelining de síntesis (core: `pipeline.py`)

Hoy: `await provider.synthesize(seg)` secuencial → hueco entre segmentos.
Cambio: `asyncio.Queue(maxsize=2)` de futuros de síntesis — mientras el
consumidor emite el audio del segmento N, el N+1 ya se sintetiza.
Cola con backpressure (depth 2) para no disparar N síntesis en ráfaga.

### P3 — Anti-jitter en el front (web: `useTTS.ts`)

Buffer mínimo: al recibir el primer segmento, esperar ~150ms (o hasta que haya
2º segmento en cola) antes del primer `src.start()`. Evita que un jitter de red
corte la reproducción (síntoma "habla cortado/extraño").

### P4 — `filter_for_tts` anti-ruido *(core: `voice/filter.py`)*

Añadir al pipeline de regex (antes del split):
- Símbolos decorativos sueltos: `^[*_>#~\-•·]+$` (líneas de solo formato)
- Backticks residuales, `>` citación markdown
- Puntuación repetida: `!{2,}` → `!`, `\?{2,}` → `?`, `\.{4,}` → `…`
- Citas de fuentes: `\[\d+\]`, `【.*?】`, `〔.*?〕`
- `+/-` y `≈` con espacios → palabras ("más/menos/aprox") si `mode != robotic`
Tests unitarios nuevos por cada caso en `kali-core/tests/test_voice_filter.py`.

### P5 — Métrica de latencia TTS *(front + core)*

- Core: en la emisión del primer `tts_audio` de un turno, incluir
  `latency_ms = now - turn_start_ts` dentro del evento.
- Front: registrar en `turn_stats` (ya existe el evento) → telemetría simple
  para validar la mejora percibida con datos, no a oído.

### P6 — Provider Audio8-SGLang como opción documentada *(config)*

El provider `http` ya existente + server SGLang en `:8010` (validado en esta
sesión, RTF 0.30-0.32):

```bash
KALI_TTS_PROVIDER=http
KALI_TTS_HTTP_URL=http://127.0.0.1:8010
```

Casos de uso: voz clonada de una persona real (única capacidad que Qwen no
ofrece). Trade-offs medidos: RTF 0.30-0.41 vs 0.21; 6.8GB vs 3.7GB VRAM;
calidad sujeta al acento del dataset del checkpoint (caribeño — no configurable).

---

## 5. Matriz de riesgo

| Riesgo | Mitigación |
|---|---|
| TTS lento bloquea el stream del LLM | consumidor en task aparte + Queue; nunca sync en el producer |
| Orden de segmentos roto | cola por índice creciente; front ya ordena por `segment` |
| LLM cancelado con TTS en vuelo | cancelar tareas hijas + `tts_queue` flush |
| Providers sin soporte de streaming interno (http/piper sync) | el pipeline ya es async por segmento; cada segmento es una llamada HTTP corta — el paralelismo viene de P0, no del provider |
| Regresión en modo no-TTS | `auto_tts=false` corta el camino temprano (pipeline.py:67-68) |
| Front reproduce audio "viejo" tras cancel | flag `stopRef` + vaciado de `queueRef` ya existe en useTTS (stop()) — invocar desde evento `turn_end (cancelled)` |

---

## 6. Plan de pruebas

**Unit (kali-core/tests/):**
- `test_tts_stream_live`: con LLM fake de 4 oraciones → assert 4 eventos
  tts_audio emitidos ANTES del turn_end + en orden.
- `test_tts_cancel`: cancel mid-stream → no quedan tareas TTS pendientes.
- `test_filter_artifacts`: casos con `!!!`, `*solo*`, `[1]`, `【x】` → limpio.
- `test_segment_max200`: oraciones completas, ninguna truncada.

**Manual (validación humana en LAN):**
1. Preguntar algo con respuesta larga (párrafo + lista) → la voz arranca
   mientras el texto se sigue escribiendo en pantalla.
2. Interceptar el turno (botón stop) a mitad → audio corta limpio, sin cola fantasma.
3. Pregunta con respuesta con código y emojis → cero lectura de símbolos.
4. Comparar percepción: flujo actual vs P0 — anotar `tts_first_audio_latency`.

**Latencia objetivo:** primera palabra audible < 2s desde el inicio del turno
con respuesta corta (LLM ~1s + TTS ~0.7s), vs hoy `LLM full + TTS` (4-10s+).

---

## 7. Rollout

1. Rama `feature/tts-realtime` desde `development`.
2. P0 (server) + AC1-AC3 tests → PR.
3. P1-P3 en el mismo PR (chicos, mismos módulos).
4. P4 con tests unitarios separados (no bloquea el P0).
5. P5 métrica + doc `docs/rt-tts.md` (cómo medir percepción).
6. Merge a `development` tras validación con Qwen3 (regresión por definición:
   pipeline/provider no cambian — solo el disparo y los tamaños).

## 8. Fuera de alcance (declarado)

- WebRTC/PCM binario por WS (streaming de bajo nivel) — no necesario: los WAV
  base64 por segmento bastan a la latencia objetivo.
- Cambio de protocolo del evento `tts_audio` (rompería el front).
- Fine-tuning LoRA de Audio8 para acento (proyecto separado, ya documentado en
  `/mnt/data2/tmp-venv/OPTIMIZACION_AUDIO8.md` — Anexo del experimento).

## 9. Métricas objetivo post-implementación

| Métrica | Hoy | Objetivo |
|---|---|---|
| 1er audio (respuesta corta) | LLM full + 1-2s | < 2s desde 1er delta del LLM |
| 1er audio (respuesta larga) | 10-30s+ | < 2.5s (independiente del largo total) |
| Huecos entre segmentos | perceptibles a veces | imperceptibles (+pipelining) |
| Artefactos de lectura | ocasionales | cero con P4 |

## 10. Anexo — Evidencia medida en RTX 3060 (2026-08-31/09-01)

| Motor | RTF | VRAM | 1ª frase | Nota |
|---|---|---|---|---|
| Qwen3 0.6B (kali-core provider) | 0.21 | 3.7GB | 2.64s | mejor motor |
| Qwen3 1.7B VoiceDesign | 0.22 | 4.3GB | 1.46s | estilos reales |
| Audio8 SGLang Omni | 0.30-0.32 | 6.8GB | 1.45s | cloning real |
| Audio8 ONNX lean | 0.73-0.88 | 1.06GB | — | sin GPU pesada |
| Audio8 ONNX CPU | 2.4-2.9 | (RAM) | 16s+ | no conversacional |
| Piper | ~0.24 | 0 GPU | <1s | más liviano, robótico |

Docs raw de la investigación: `/mnt/data2/tmp-venv/OPTIMIZACION_AUDIO8.md`,
`/mnt/data2/tmp-venv/audio8_capacidades.md`, `/mnt/data2/tmp-venv/BENCHMARK_TTS.md`.