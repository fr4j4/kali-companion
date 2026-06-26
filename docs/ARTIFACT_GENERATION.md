# Kali — Artifact Generation (kali-mind + kali-canvas)

This document explains the complete lifecycle of an **artifact** in Kali: how
the LLM produces one, how the backend streams it to the frontend, and how the
frontend renders it live. It covers both the text-marker path (for models that
emit `[BEGIN_ARTIFACT]` as plain text) and the native tool-call path (for
models like Qwen3.5 that use OpenAI-style function calling), plus how the
backend bridges native tool calls into live streaming.

---

## 1. What is an artifact?

An artifact is a **visual window on the canvas** that the LLM generates for the
user — a piece of HTML, a code snippet, a Mermaid diagram, a table, a document,
etc. Instead of dumping long content as plain chat text, the LLM produces a
structured artifact that floats as a draggable, resizable window the user can
interact with.

Each artifact has:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique id (`art_<12hex>`). |
| `type` | string | Domain type: `code`, `document`, `diff`, `html`, `mermaid`, `json`, `table`, `checklist`, `chart`, `quiz`. |
| `windowType` | string | Frontend window type (resolved from `type` via the canvas registry). |
| `title` | string | Window title. |
| `content` | string | The artifact payload. Raw text for streamable types; JSON string for structured types. |
| `update` | `"create"` \| `"update"` \| `"close"` | The action this event represents. |
| `phase` | `"streaming"` \| `"complete"` | Whether content is still growing or finalized. |

---

## 2. Streamable vs non-streamable types

The system classifies artifact types into two groups, because some content is
meaningful as it grows (you can watch HTML being written) while other content
needs to be complete to render (a half-finished JSON tree is useless).

**Streamable** (`kali_core/mind/artifact_stream.py`):

| Type | Description | Live render |
|---|---|---|
| `code` | Source code text | Line-numbered code grows live |
| `document` | Markdown text | Rendered markdown grows live |
| `diff` | Unified diff | Diff view grows live |
| `html` | Raw HTML | HTML source grows live; iframe preview renders on close |

**Non-streamable**:

| Type | Description | Live render |
|---|---|---|
| `mermaid` | Mermaid diagram syntax | Spinner during streaming; renders on close |
| `json` | JSON string (tree) | Spinner; renders on close |
| `table` | `{"rows": [...]}` JSON | Spinner; renders on close |
| `checklist` | `{"items": [...]}` JSON | Spinner; renders on close |
| `chart` | Chart JSON | Spinner; renders on close |
| `quiz` | Quiz JSON | Spinner; renders on close |

This distinction drives which generation path the backend uses (see §3).

---

## 3. The two generation paths

There are two ways the LLM can produce an artifact. Both end up emitting the
same WS `artifact` events to the frontend, but they differ in **when** the
content reaches the frontend.

### Path A — Text markers (streaming, live)

The LLM emits the markers `[BEGIN_ARTIFACT: <type>] {<header_json>}` and
`[END_ARTIFACT]` as **plain text** in `delta.content` (the main response
channel). Between the markers, the content is plain text (NOT escaped JSON).

```
[BEGIN_ARTIFACT: code] {"title": "Herencia Java"}
public class HerenciaYPolimorfismo {
    abstract class Animal { ... }
}
[END_ARTIFACT]
```

The backend's `ArtifactStreamProcessor` (`kali_core/mind/artifact_stream.py`)
parses these markers in real time as tokens arrive, and emits progressive
`artifact` events:

1. `create` (phase `streaming`) — when the BEGIN marker is detected.
2. `update` (phase `streaming`) — throttled (80ms) as content grows.
3. `close` (phase `complete`) — when the END marker is detected.

The frontend opens the window on `create`, watches it fill live on each
`update`, and finalizes on `close`.

**This is the preferred path** — the user sees the content being written in
real time.

### Path B — Tool call (batch)

The LLM invokes the `create_artifact` tool (either as a native API function
call via `delta.tool_calls`, or as a textual `[TOOL_CALL: create_artifact]
{...}` marker). The entire artifact content travels as a **single JSON
argument** (`{"artifact_type": "html", "title": "...", "content": "..."}`).

Historically this was **batch only**: the backend accumulated the full JSON
across all streaming chunks, executed the tool once the stream completed, and
emitted a single `artifact` event with the complete content. The user saw
nothing until the very end.

**Path B is now also streamed live** for streamable types — see §5 for the
bridge that converts a native tool call into live streaming.

---

## 4. Path A in detail: text markers

### 4.1 The system prompt

The system prompt (`kali_core/config.py`) instructs the LLM to use the
streaming format for streamable types:

```
STREAMING FORMAT — for 'code', 'document', 'diff', 'html' (text
that is meaningful as it grows). The user watches the content
being written live. Use this format:
  [BEGIN_ARTIFACT: code] {"title": "Herencia Java"}
  public class HerenciaYPolimorfismo { ... }
  [END_ARTIFACT]
```

For non-streamable types, the prompt tells the LLM to use the classic
`[TOOL_CALL: create_artifact]` format instead.

### 4.2 The streaming processor

`ArtifactStreamProcessor` (`kali_core/mind/artifact_stream.py`) is a
character-stream state machine. The runtime feeds it each `delta` chunk:

```
runtime.py (respond loop)
  └─ delta_filter (MarkerSuppressor for [TOOL_CALL:])   ── removes tool-call markers
  └─ artifact_processor.feed(safe_text)
       ├─ chat_text      ──► yielded as kind="delta" to frontend
       └─ artifact_events ──► _emit_artifact_event ──► WS "artifact" event
```

The processor has two modes:

- **Normal mode**: passes text through as `chat_text`, holding back enough
  chars to detect a `[BEGIN_ARTIFACT:` marker that spans a chunk boundary.
- **Artifact mode**: when a BEGIN marker is parsed, it captures content into
  an internal buffer. For streamable types, it emits throttled `update`
  events as content grows. For non-streamable types, it accumulates silently
  and only emits on `close`.

On `[END_ARTIFACT]`, it emits a `close` event with phase `complete`. If the
stream ends without an END marker, `flush()` closes the artifact with whatever
partial content was accumulated.

### 4.3 Why this gives live streaming

Because the processor emits `update` events **as content arrives** (not just
on close), the frontend sees the window fill progressively. The 80ms throttle
prevents flooding the WS with one event per token.

---

## 5. Path B in detail: native tool calls

### 5.1 The problem

When the LLM uses **native OpenAI-style function calling** (the `tools` param
in the Chat Completions API), the artifact content lives inside the JSON
`arguments` of `delta.tool_calls[0].function.arguments` — NOT in
`delta.content`. The `ArtifactStreamProcessor` only reads `delta.content`, so
it never sees the content.

With reasoning models like Qwen3.5, this was especially bad: the model would
spend 2+ minutes reasoning (filling `reasoning_content`), then emit the entire
HTML as a native tool call, and finally emit a 36-char text summary in
`delta.content`. The user saw only the thinking cloud for 2 minutes, then the
artifact appeared fully formed at the end. No live streaming.

### 5.2 The bridge: re-streaming native tool calls

To fix this, `DirectLLMProvider` (`kali_core/mind/llm/direct.py`) now
**re-streams** the content of a native `create_artifact` tool call as
synthetic `delta` events, as if the model had emitted the text markers
directly.

The flow:

```
LLM emits delta.tool_calls (native create_artifact, JSON args)
  └─ direct.py: StreamingArtifactArgParser.feed(arguments_chunk)
       ├─ Field("artifact_type", "html")    ──► is it streamable?
       ├─ Field("title", "...")              ──► save for create event
       ├─ ContentChunk("<!DOCTYPE html>...")  ──► yield synthetic delta:
       │       ┌─ first chunk: [BEGIN_ARTIFACT: html] {"title":"..."} 
       │       └─ subsequent:  raw unescaped HTML content
       ├─ ContentDone()                       ──► yield synthetic delta: [END_ARTIFACT]
       └─ JsonDone()                          ──► mark as streamed (skip batch tool_call)
  └─ runtime.py: ArtifactStreamProcessor processes synthetic deltas normally
       └─ WS "artifact" create → update (live) → close
```

The synthetic deltas flow through the **existing** `ArtifactStreamProcessor`
in the runtime, which parses the `[BEGIN_ARTIFACT]` / `[END_ARTIFACT]` markers
and emits the usual `create` → `update` → `close` WS events. The runtime and
frontend are completely unaware that the deltas came from a native tool call
rather than plain text.

### 5.3 The incremental JSON parser

`StreamingArtifactArgParser` (`kali_core/mind/json_stream_extractor.py`) is a
character-stream state machine that parses the `arguments` JSON incrementally
as it arrives in chunks. It:

- Tracks JSON string/escape/brace state (inspired by `MarkerSuppressor`).
- Emits `Field` events when short fields (`artifact_type`, `title`) complete,
  so the caller knows whether the artifact is streamable **before** the long
  `content` arrives.
- Emits `ContentChunk` events with **unescaped** text from the `content`
  string, live as it arrives. Handles JSON escapes (`\n`, `\"`, `\\`, `\uXXXX`)
  including UTF-16 surrogate pairs (emoji like 🌟 = `\uD83C\uDF1F`).
- Emits `ContentDone` when the content string closes.
- Preserves the full `raw_json` for fallback.
- Sets `failed = True` if the JSON is malformed; the caller then falls back to
  the batch tool-call path.

### 5.4 Streamable vs non-streamable in Path B

The bridge only activates for **streamable** types (`code`, `document`, `diff`,
`html`). For non-streamable types (`table`, `mermaid`, `json`, `checklist`,
`chart`, `quiz`), the native tool call follows the **batch** path: the JSON is
accumulated, the tool is executed at stream end, and a single `artifact` event
with the complete content is emitted. This is correct — a half-finished table
JSON cannot be rendered meaningfully.

### 5.5 Fallback safety

If the incremental parser fails (malformed JSON, unexpected structure), the
bridge is a no-op and the tool call falls back to the original batch path.
The full `raw_json` is always accumulated regardless, so the batch parse at
stream end still works.

---

## 6. The runtime loop

`AgentRuntime.respond()` (`kali_core/mind/runtime.py`) is the central loop.
For each turn, it can iterate up to 5 steps (the LLM may call tools, get
results, and call more tools):

```
for _step in range(max_steps):
    yield StreamEvent(kind="step", step=_step+1)   ──► WS "step_start"
    
    delta_filter = MarkerSuppressor("[TOOL_CALL:")     ── removes textual tool-call markers
    reasoning_filter = MarkerSuppressor("[TOOL_CALL:") ─ same for reasoning channel
    artifact_processor = ArtifactStreamProcessor()    ─ detects [BEGIN/END_ARTIFACT]
    
    async for event in llm.stream(history, tools):
        if event.kind == "delta":
            safe = delta_filter.feed(event.text)        ─ strip [TOOL_CALL:] markers
            result = artifact_processor.feed(safe)
            yield kind="delta" result.chat_text         ─► WS "delta"
            for art_evt in result.artifact_events:
                await _emit_artifact_event(art_evt)     ─► WS "artifact" (create/update/close)
        
        elif event.kind == "reasoning":
            safe = reasoning_filter.feed(event.text)
            yield kind="reasoning" safe                 ─► WS "reasoning_delta"
        
        elif event.kind == "tool_call":
            ─ execute the tool via Executor
            ─ append tool call + result to history
            ─ loop continues (next step may use the result)
    
    ─ flush filters + artifact_processor (closes any open artifact)
    ─ parse accumulated text for textual [TOOL_CALL:] markers (fallback)
    ─ if tool calls were made, loop for next step; else break
```

Key points:

- `ArtifactStreamProcessor` only sees the `delta` channel (not `reasoning`).
  The synthetic deltas from Path B flow through here normally.
- The `reasoning` channel is forwarded to the frontend as `reasoning_delta`
  events (shown in the thinking cloud), after stripping any `[TOOL_CALL:]`
  markers.
- Tool calls (native or textual) are executed via the `Executor`, which
  handles permissions, consent, and persistence.

---

## 7. Persistence (surviving page refresh)

Artifacts are persisted to the SQLite session store
(`kali_core/nest/store.py`) so they survive a page refresh.

There are **two** persistence paths, both idempotent:

1. **Executor path** (batch tool calls): when `create_artifact` runs via the
   `Executor` (`kali_core/mind/executor.py:167-178`), it calls
   `session_store.add_artifact(...)` before emitting the WS event.

2. **Runtime path** (streamed artifacts): when `AgentRuntime._emit_artifact_event`
   fires a `close` event, it calls `session_store.add_artifact(...)` as well
   (`kali_core/mind/runtime.py:213-227`).

Both use `INSERT OR REPLACE` (`kali_core/nest/store.py:151`), so if both paths
fire for the same artifact (e.g. an artifact that was both streamed AND went
through the executor), the second write cleanly overwrites the first with
identical content. No duplication, no error.

The runtime path was added specifically for Path B streamed artifacts: when a
native tool call is re-streamed, the `Executor` never runs (the `tool_call`
event is skipped in `direct.py`), so the runtime's persistence on `close` is
the **only** persistence path. Without it, streamed artifacts would vanish on
refresh.

---

## 8. The frontend pipeline

The frontend receives `artifact` WS events and renders them as draggable
windows on the canvas. The pipeline:

```
WS "artifact" event
  └─ useChat.ts: client.on("artifact") (line ~326)
       └─ setArtifacts(prev → new Map; upsert by id)    ─ replaces entry on each event
  └─ NeuralCanvas.tsx: useEffect on chat.artifacts (line ~158)
       └─ for each [id, event]: api.syncArtifact(event)
  └─ useWorkspace.ts: syncArtifact (line ~240)
       ├─ create  ─► createWindow(...)      ─ new window on canvas
       ├─ update  ─► setWindows(...)        ─ replace window.content
       └─ close   ─► if phase!="complete": mark closed; else: replace content (final)
  └─ WindowContentRouter.tsx ─► widget by windowType
       └─ HtmlWidget / CodeWidget / DocumentWidget / TableWidget / ...
```

Key behaviors:

- **Each `update` event replaces the whole content** (the frontend does NOT
  concatenate deltas). The backend must send full accumulated content on each
  update — which `ArtifactStreamProcessor` does (it tracks `content` from the
  start of the artifact).
- **HTML artifacts**: the "HTML" source tab updates live during streaming; the
  "Preview" iframe tab shows a spinner ("Generando HTML…") while
  `phase === "streaming"` and mounts the iframe only on `complete`
  (`kali-web/src/components/widgets/HtmlWidget.tsx:77-81`). This is by design —
  a half-finished HTML document is not a valid iframe document.
- **Code/Document widgets**: update live during streaming, with auto-scroll
  to bottom.
- **Non-streamable widgets** (table/mermaid/json/checklist/chart/quiz): show
  a spinner during streaming, render on `close`.

---

## 9. End-to-end timeline (Qwen3.5 example)

With the bridge in place, the user asking "haz un html inspirado en starwars,
episodio 3" sees:

```
t=0          POST /chat/completions 200 OK (stream opened with tools)
t=0..120s    reasoning_content: thinking cloud fills (planning the HTML)
t=120s       model starts delta.tool_calls with args={"artifact_type":"html",...}
             └─ parser detects artifact_type=html (streamable)
             └─ synthetic delta: [BEGIN_ARTIFACT: html] {"title":"Episodio III"} 
             └─ runtime → ArtifactStreamProcessor → WS: artifact create phase=streaming
             └─ frontend: HTML window opens
t=120s..     more content chunks: parser unescapes & emits synthetic deltas
             └─ WS: artifact update phase=streaming content_len=N (growing)
             └─ frontend: HTML source tab fills live
t=135s       content_done: synthetic delta [END_ARTIFACT]
             └─ WS: artifact close phase=complete (full HTML)
             └─ runtime persists to session_store
             └─ frontend: Preview tab mounts iframe
t=135s..     model emits delta.content with complementary text (511 chars)
             └─ WS: delta (normal chat)
t=136s       turn_end
```

Compare to **before the fix** (same model, same prompt):

```
t=0..126s    reasoning cloud fills (no artifact visible)
t=126s       stream completes → batch tool_call → execute create_artifact
t=126s       WS: single artifact event with full HTML (no streaming)
t=126s..     second LLM call for complementary text
t=136s       turn_end
```

The user experience goes from "stare at thinking cloud for 2 minutes, then
artifact appears fully formed" to "thinking cloud, then watch the HTML write
itself live in the artifact window."

---

## 10. File reference

| File | Role |
|---|---|
| `kali_core/config.py` | System prompt with artifact format instructions. |
| `kali_core/mind/artifact_stream.py` | `ArtifactStreamProcessor` — parses `[BEGIN/END_ARTIFACT]` markers, emits create/update/close events. |
| `kali_core/mind/json_stream_extractor.py` | `StreamingArtifactArgParser` — incremental JSON parser for native tool-call args, emits live content chunks. |
| `kali_core/mind/marker_suppressor.py` | `MarkerSuppressor` — strips `[TOOL_CALL:]` markers from delta/reasoning in real time. |
| `kali_core/mind/llm/direct.py` | `DirectLLMProvider` — OpenAI-compatible streaming; bridges native `create_artifact` tool calls to synthetic deltas. |
| `kali_core/mind/llm/provider.py` | `StreamEvent` / `LLMProvider` protocol. |
| `kali_core/mind/runtime.py` | `AgentRuntime` — the multi-step loop; feeds deltas through processors; persists artifacts on close. |
| `kali_core/mind/executor.py` | `Executor` — runs tools with permissions/consent; persists batch artifacts. |
| `kali_core/claws/create_artifact.py` | `CreateArtifactTool` — the `create_artifact` tool definition + envelope builder. |
| `kali_core/canvas/registry.py` | Resolves domain `type` → frontend `windowType`. |
| `kali_core/nest/store.py` | `SessionStore.add_artifact` — SQLite persistence (idempotent via `INSERT OR REPLACE`). |
| `kali_core/server.py` | Wires `session_store` into `AgentRuntime`; defines WS event handlers. |
| `kali-web/src/hooks/useChat.ts` | WS `artifact` event handler → `artifacts` Map state. |
| `kali-web/src/stage/NeuralCanvas.tsx` | Syncs `chat.artifacts` → workspace windows. |
| `kali-web/src/workspace/useWorkspace.ts` | `syncArtifact` — create/update/close windows. |
| `kali-web/src/components/widgets/HtmlWidget.tsx` | HTML widget — live source tab, iframe on complete. |

---

## 11. Testing

- `tests/test_json_stream_extractor.py` — 21 unit tests for the incremental
  JSON parser (field extraction, content streaming, escapes, surrogate pairs,
  chunk boundaries, malformed JSON, fallback).
- `tests/test_artifact_streaming.py` — tests for `ArtifactStreamProcessor` +
  runtime integration + native tool-call re-streaming (streamable live,
  non-streamable batch) + persistence on close.
- `tests/test_server.py` — end-to-end WS flow tests (delta streaming,
  reasoning, TTS).

Run with:

```bash
cd kali-core
python -m pytest tests/test_artifact_streaming.py tests/test_json_stream_extractor.py -v
```

---

## 12. Design notes

**Why re-stream as synthetic deltas instead of emitting artifact events
directly from `direct.py`?**

The runtime's `ArtifactStreamProcessor` already handles all the complexity:
marker detection, throttling, content accumulation, close-on-end, flush. By
re-streaming native tool calls as synthetic deltas shaped like the text
markers, we reuse all of that logic without duplicating it. `direct.py` stays
a thin adapter; the runtime stays the single place that emits `artifact` WS
events.

**Why not just disable native tool calling for reasoning models?**

That was considered (force the model to use text markers). It would work but
has two downsides: (1) it loses native tool calling for all other tools
(web_search, run_command, etc.) with that model, and (2) it depends on the
model obeying the system prompt — small quantized models like Qwen3.5-9B often
don't. The bridge approach works regardless of which channel the model
chooses.

**Why persist on `close` in the runtime AND in the executor?**

The executor path covers batch tool calls. The runtime path covers streamed
artifacts (where the executor never runs). `INSERT OR REPLACE` makes them
idempotent — if both fire, the second cleanly overwrites the first with
identical content. This avoids needing a flag to track "already persisted."

**Why a 80ms throttle on `update` events?**

Without throttling, the backend would emit one `update` per token (dozens per
second), flooding the WS and causing excessive React re-renders. 80ms gives
~12 updates/second, smooth enough to feel live without overwhelming the
frontend.