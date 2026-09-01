# Recomendaciones de mejora TTS↔LLM realtime para kali-companion — basadas en el código real audited
# server.py: _synthesize_tts corre en turn_end (texto completo)
# pipeline.py: synthesize_stream ya segmenta (max_chunk=500) pero SIN streaming del LLM
# useTTS.ts: el front ya reproduce tts_audio POR SEGMENTO (segment index) — soporta cola!

## PLAN DE 3 NIVELES (de menor a mayor impacto / complejidad)

### P0 — Streaming frase-a-frase desde el LLM (CAMBIO PRINCIPAL, ~1-2h)
Impacto esperado: 1ª palabra audible DURANTE la generación del LLM
En server.py, en el bucle `async for event in agent.respond(...)` (línea ~3087):
- Cambio: acumular texto y CADA VEZ que el delta contiene un fin de frase
  (punto, ?, !, \n\n), extraer la frase pendiente y despachar TTS inmediato:
  · Tarea nueva: asyncio.create_task(self._synthesize_tts_segment(sentence, session_id))
    EN PARALELO con el resto del stream (no await — el LLM sigue fluyendo).
  - Cola ordenada (asyncio.Queue) para emitir tts_audio en orden de frase.
- Al done: despachar el resto pendiente y mantener ordering.
Requisito front: useTTS.ts ya reproduce por segmento (tts_audio con index) —
solo hace falta enviar segment índice real (no -1) y dejar el front encolar.
Riesgo: bajo. El pipeline ya funciona por segmentos; solo cambia el trigger.

### P1 — Sentence-boundary splitter mejorado (30 min)
max_chunk=500 es GRANDE (≈ 30s de audio): para realtime, frases de ≤150-200
chars se sintetizan en 0.5-1s cada una con qwen_cpp (RTF 0.21) → primera frase
en <1s desde su emisión. Bajar default max_chunk a ~200 + cortar SOLO en
fronteras de oración (ya lo hace: re.split en [.!?]).

### P2 — Prefetch de audio mientras suena el anterior
Pipeline sequential (await cada segmento): pipelining con asyncio.Queue de
depth=2: mientras suena el segmento N, el N+1 ya se sintetiza en background.
Elimina los "huecos" entre segmentos largos.

### P3 — Buffer jitter en el front (~20 min)
useTTS.ts: reproducir con min-buffer de ~150ms antes de iniciar playback,
para tolerar jitter de red/decodificación (evita los cortes tipo "habla raro").

### P4 — Text normalization hardening (mitiga los "ruidos/artefactos")
filter_for_tts ya cubre code/URL/markdown/emoji. Añadir:
- normalizar símbolos residuales: *, _, >, <, |, # simples sueltos
- colapsar espacios múltiples y puntuación repetida (!!!, ...) que los LLMs
  generan y algunos TTS pronuncian mal
- strip de citation markers tipo【】 o [1] si el LLM usa fuentes

### P5 — Config de motor (elección por hardware, sin tocar el flujo)
- GPU única conversación:   qwen3 0.6B (RTF 0.21, 3.7GB) + streaming segmentos
- Voz clonada del usuario:  audio8 SGLang (RTF 0.30, 6.8GB) — provider nuevo
  o vía KALI_TTS_HTTP_URL apuntando al server SGLang (:8010) — YA EXISTE el
  provider http en kali-core: KALI_TTS_PROVIDER=http KALI_TTS_HTTP_URL=http://
  127.0.0.1:8010 — sin código nuevo.
- CPU-only: piper (0 VRAM).

### P5 — Métrcas para validar
turn_stats ya incluye first_token_latency; añadir "tts_first_audio_latency"
en el front para medir percepción (tiempo turn_end → primer tts_audio).

## LO QUE NO HARÍA
- Cambiar de motor TTS no soluciona la demora percibida (el flujo es secuencial).
- Reemplazar el pipeline por streaming PCM bruto (WebRTC etc.) — alta complejidad
  para una mejora marginal frente al P0+P2+P3.