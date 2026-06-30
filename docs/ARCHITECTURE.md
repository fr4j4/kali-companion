# Kali — Architecture

This document describes the high-level architecture of Kali, the data flow
between its layers, and the key technical decisions.

## Big-picture flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER (developer / gamer / learner)            │
│                   ┌──────────────┐    ┌──────────────┐               │
│                   │  Text input  │    │  Voice input │               │
│                   │  (keyboard)  │    │  (mic → PTT) │               │
│                   └──────┬───────┘    └──────┬───────┘               │
│                          │                   │                       │
└──────────────────────────┼───────────────────┼───────────────────────┘
                           │                   │
                    ┌──────▼───────────────────▼──────┐
                    │       kali-web  (React + Vite)   │
                    │  ┌───────────────────────────┐   │
                    │  │ SpotlightInput + VoiceBar  │   │
                    │  └───────────┬───────────────┘   │
                    │              │ WS event          │
                    │  ┌───────────▼───────────────┐   │
                    │  │  Kali interface:          │   │
                    │  │  · Chat thread (text)     │   │
                    │  │  · NeuralCanvas (artif.)  │   │
                    │  │  · Stage (avatar, HUD)    │   │
                    │  │  · ConsentModal           │   │
                    │  │  · WidgetGrid (live)      │   │
                    │  └───────────┬───────────────┘   │
                    └──────────────┼───────────────────┘
                                   │ WS / kali-yarn protocol
                    ┌──────────────▼───────────────────┐
                    │       kali-core  (Python sidecar) │
                    │                                   │
                    │  ┌──────────┐  ┌───────────────┐  │
                    │  │ kali-ear │  │  kali-mind     │  │
                    │  │ (STT)    │─►│  AgentRuntime  │──┼──► LLM provider
                    │  └──────────┘  │  + Planner     │  │    (Direct | nanobot)
                    │                │  + Executor    │  │
                    │  ┌──────────┐  │  + Memory      │  │
                    │  │kali-voice│◄─│  + Vision      │  │
                    │  │ (TTS)    │  └───────┬───────┘  │
                    │  └──────────┘          │           │
                    │              ┌─────────▼────────┐ │
                    │              │   kali-claws      │ │
                    │              │   (Tools)         │ │
                    │              │                   │ │
                    │              │  fs_*  command    │ │
                    │              │  git_*  web_*     │ │
                    │              │  screenshot  game │ │
                    │              │  create_artifact  │ │
                    │              └──┬────┬────┬─────┘ │
                    │                 │    │    │        │
                    │  ┌──────────────▼────▼────▼─────┐ │
                    │  │    kali-collar (Permissions)  │ │
                    │  │    · Profile check            │ │
                    │  │    · Consent request          │ │
                    │  └──────────────┬────────────────┘ │
                    │                 │                   │
                    │  ┌──────────────▼────────────────┐  │
                    │  │  System actions:              │  │
                    │  │  · Filesystem  · Shell        │  │
                    │  │  · Git        · Web           │  │
                    │  │  · Display    · Screen cap    │  │
                    │  │  · GPU (Qwen) · Games (API)   │  │
                    │  └───────────────────────────────┘  │
                    └─────────────────────────────────────┘
```

### Reading the diagram

1. **User** talks or types → **kali-web** captures the input.
2. If voice: **kali-web** → WS binary → **kali-ear** (offline Vosk STT) →
   transcript.
3. The transcript or text is sent via **kali-yarn** WS protocol to **kali-mind**
   (AgentRuntime).
4. **kali-mind** decides: answer directly, or call a **kali-claws** tool.
5. Every tool call passes through **kali-collar** (permissions) — safe tools
   run freely, sensitive/dangerous ones require profile whitelist or user
   consent.
6. Tool results flow back through **kali-claws** → **kali-mind** → second LLM
   turn (if needed).
7. Response text streams back to **kali-web** as deltas **and** (if enabled)
   through **kali-voice** TTS pipeline → base64 PCM → **kali-web** plays it.
8. If the LLM produces an artifact (HTML, diagram, diff), it is rendered live
   on the **NeuralCanvas** in **kali-web**.

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  kali-shell  (Electron / TypeScript)          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  kali-web  (Frontend: React + Vite + TypeScript)       │  │
│  │  Dashboard · Chat · Widgets · Canvas · Consent modal   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Electron IPC → system capabilities:                         │
│    - Window management, system tray                          │
│    - Spawns and supervises the Python sidecar                │
│                                                              │
│  Sidecar launcher: spawns + supervises the Python process    │
└───────────────────────┬─────────────────────────────────────┘
                         │  Local WebSocket (JSON) + stdio
┌───────────────────────▼─────────────────────────────────────┐
│                 kali-core  (Python sidecar)                    │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐   │
│  │ kali-mind    │  │ kali-claws  │  │ kali-voice / kali-ear │  │
│  │ Agent runtime│  │ Tools with  │  │ TTS (Piper/Qwen/numpy)│  │
│  │ + LLM        │  │ permissions │  │ STT (Vosk offline)   │   │
│  │ providers    │  │             │  │                      │   │
│  └─────────────┘  └─────────────┘  └──────────────────────┘   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  kali-collar (permissions) · kali-nest (sessions)        │ │
│  │  kali-gaze (capture client) · kali-canvas (artifact spec)│ │
│  │  kali-yarn (WS protocol)                                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Three-layer model

Kali is split into three layers, each in its own top-level directory:

| Layer | Directory | Language | Responsibility |
|---|---|---|---|
| Shell | `kali-shell/` | TypeScript (Electron) | Native window, system tray, spawns the Python sidecar |
| Frontend | `kali-web/` | TypeScript (React + Vite) | UI rendered in the webview: dashboard, chat, widgets, canvas |
| Core | `kali-core/` | Python 3.12 (asyncio) | Agent runtime, tools, voice, permissions, sessions |

### Why this split?

- **Python carries the brain.** The user is learning AI and wants to iterate on
  agent logic, tools, and prompts. Python is the most readable surface for
  that work.
- **Electron is minimal.** The shell only does what Python cannot:
  open a native window, manage system tray, spawn and supervise the sidecar
  process. The Electron shell is lightweight and cross-platform.
- **The frontend is framework-agnostic to the core.** It talks to the core
  over a local WebSocket using a documented event protocol
  ([PROTOCOL.md](./PROTOCOL.md)). It does not import `kali_core` directly,
  which keeps the door open for swapping the frontend (or running it in a
  plain browser during development).

## Data flow

### A user message (text)

```
user types in chat
   │
   ▼
kali-web  ── WS event "input" { content, source: "text", session_id } ──►  kali-core
                                                                          │
                                                                          ▼
                                                                   kali-yarn (router)
                                                                          │
                                                                          ▼
                                                                   kali-mind (AgentRuntime)
                                                                          │
                                                            LLM provider (direct | nanobot)
                                                                          │
                                                            may call kali-claws tools
                                                                          │
                                                   ┌──────────────────────┴──────────┐
                                                   ▼                                   ▼
                                          kali-web  ◄── "delta" events ──┐      kali-voice (TTS pipeline)
                                          (streamed text)                  │           │
                                                                           │           ▼
                                                                  kali-web ◄── "tts_audio" events
                                                                  (audio playback)
```

### A user message (voice)

```
user holds PTT button (or wake word triggers)
   │
   ▼
kali-web captures mic → resamples to 16 kHz PCM
   │
   ├── WS "audio_start" ─────────► kali-core ── kali-ear (StreamingSTT.start)
   │
   ├── WS binary frames (PCM) ──► kali-core ── kali-ear.accept(chunk) ── partial/final
   │                                                            │
   │                                                            ▼
   │                                            kali-web ◄── "stt_partial"/"stt_final"
   │
   └── WS "audio_end" ──────────► kali-core ── kali-ear.finish()
                                          │
                                          ▼
                                  final transcript
                                          │
                                          ▼
                                  (same path as text input above)
```

### A tool call with consent

```
kali-mind decides to call a sensitive tool (e.g. run_command)
   │
   ▼
kali-claws (Tool.run) ──► kali-collar (PermissionGateway.check)
                                    │
                          safe?     │    in profile + constraints met?
                             │              │ yes → allow
                             │ no           │
                             │              ▼
                             │      kali-yarn: emit "consent_request"
                             │              │
                             │              ▼
                             │      kali-web: shows ConsentModal
                             │              │
                             │              ▼ user picks
                             │      "consent_response" { allow | no_capture | cancel }
                             │              │
                             ▼              ▼
                          execute        or abort
```

### A screen capture

```
kali-mind decides to call a "screenshot" tool
    │
    ▼
kali-claws/screenshot ──► kali-collar (consent: "Kali wants to see your screen…")
    │ allowed
    ▼
kali-core/gaze/local.py ──► mss library captures screen
                                     │  selects backend at runtime:
                                     │    Wayland → mss (via xdg-desktop-portal)
                                     │    X11    → mss (via Xlib)
                                     │    Windows → mss (GDI)
                                     ▼
                               PNG bytes returned
                                     │
                                     ▼
                          kali-mind sends PNG to vision-capable LLM
```

## Key technical decisions

### 1. Hybrid TTS (in-process, HTTP, or Qwen3-TTS C++ server)

- **Default:** `kali-voice` runs in-process inside `kali-core` using Piper
  directly. No HTTP hop, lowest latency, no extra service to manage.
- **Qwen3-TTS (optional):** A C++ server (`qwen_cpp/`) that provides high-quality
  neural TTS. Requires building the C++ server and downloading Qwen models.
- **HTTP (optional):** a config flag can point Kali at an external TTS HTTP service
  (e.g. lapis-tts or anything else exposing a compatible endpoint). Useful for
  people who already run a TTS server.

All three paths implement the same `TTSProvider` interface, so the rest of Kali is
agnostic to which one is active.

### 2. Hybrid LLM (Direct or Nanobot)

- **`DirectLLMProvider`:** talks OpenAI-compatible streaming Chat Completions.
  Works with local Ollama, llama.cpp server, OpenRouter, OpenAI, etc.
- **`NanobotLLMProvider`:** wraps nanobot's WebSocket protocol (already
  implemented in the legacy `ai-voice-companion` project). Inherits nanobot's
  tools, reasoning events, and session management.
- Both implement `LLMProvider`. Config picks one. Kali runs without nanobot
  installed; if nanobot is present, the user can opt into it.

### 3. Streaming model

Voice output streams **per segment**, the same way the legacy
`ai-voice-companion` already does: `filter_for_tts` strips code/URLs/markdown,
`segment_for_tts` splits into ≤500-char chunks, each chunk is synthesized and
shipped to the frontend as a `tts_audio` event. The browser plays them in
order. Inter-segment gaps are natural speech pauses, so the experience is
fluid. Intra-segment PCM streaming is a Phase 5 stretch goal.

### 4. Permissions: profiles + per-action override

Profiles are JSON files in `kali-core/kali_core/collar/profiles/`. Each
profile whitelists tools and constraints (working dirs, command prefixes).
Tools declare a `risk_level` of `safe | sensitive | dangerous`. The
`PermissionGateway` allows safe tools unconditionally, allows sensitive tools
if they are whitelisted by the active profile and satisfy its constraints,
and always asks for consent on dangerous tools — regardless of profile. The
user can override per action via the ConsentModal (`allow`, `no_capture`,
`cancel`).

### 5. Screen capture as a Python module

```python
class GazeClient:
    async def capture_full() -> bytes: ...
    async def capture_region(rect: Rect) -> bytes: ...
```

Implementation selection happens at runtime based on environment detection
(`$WAYLAND_DISPLAY`, `$DISPLAY`, OS). Uses the `mss` Python library which
automatically selects the best backend (Wayland/X11/Windows). Screen capture
requires consent per-task.

### 6. Single repo, thematic module folders

Everything lives in one `kali/` repo. Inside `kali-core/kali_core/`, modules
use their cat-themed names as folder names (`voice/`, `ear/`, `mind/`, …).
If a module matures enough to spin out as its own repo/package later, the
folder name is already the project name — zero rename cost.

### 7. i18n from day one

- Frontend: `react-i18next` with locale files under `kali-web/src/locale/`.
  Shipped locales: `en`, `es`.
- Core: error messages and tool descriptions are passed to the frontend as
  i18n keys, not pre-translated strings. The frontend translates.
- Consent prompts: the *reason* text is an i18n key, so the user always sees
  them in their UI language regardless of which tool generated the request.
- Language normalization: `lang_map.py` maps regional language codes (e.g.
  `es-ES` → `es`) to internal codes for STT model selection.

See [I18N.md](./I18N.md) for the full strategy.

### 8. Artifact streaming with console retrieval

Artifacts (HTML, code, diffs, etc.) stream live to the frontend:

- **Text markers path:** LLM emits `[BEGIN_ARTIFACT:type] {json}` as text;
  backend parses and streams content live.
- **Tool call path:** Native OpenAI function calls are re-streamed as
  synthetic deltas for live preview.
- **Console retrieval:** Agents can request console logs from rendered HTML
  artifacts via `console_request`/`console_response` events.

See [ARTIFACT_GENERATION.md](./ARTIFACT_GENERATION.md) for details.

## Process lifecycle

```
user starts kali-shell (Electron app)
    │
    ▼
kali-shell/main.ts:
    1. build Electron app
    2. spawn sidecar: python -m kali_core  (env: KALI_WS_PORT=…)
    3. wait for sidecar WS to be listening
    4. load kali-web index.html in the webview
    │
    ▼
kali-web boots in webview:
    - connects to ws://127.0.0.1:<port>
    - subscribes to events
    - sends "hello" → core replies "ready"
    │
    ▼
steady state:
    - user interactions flow over WS to kali-core
    - kali-core streams back deltas, TTS, artifacts, consent prompts
    - kali-shell supervises the sidecar process, restarts on crash
```

If the sidecar crashes, `kali-shell` detects the WS drop and restarts it,
preserving the frontend session.

## Repository layout

```
ai-voice-companion/
├── README.md
├── docs/                  ← you are here
├── kali-shell/            ← Electron/TypeScript shell
│   ├── package.json
│   ├── electron-builder.yml
│   └── src/
│       ├── main.ts        ← Electron entrypoint
│       ├── sidecar.ts     ← spawns + supervises kali-core
│       └── preload.ts    ← IPC bridge
├── kali-web/              ← Frontend
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── stage/         ← Main stage components
│       ├── workspace/     ← Window management
│       ├── components/   ← UI components
│       ├── hooks/
│       ├── lib/
│       ├── locale/{en,es}/ ← i18n catalogues
│       └── components/widgets/ ← 20+ widget types
├── kali-core/             ← Python sidecar
│   ├── pyproject.toml
│   └── kali_core/
│       ├── __main__.py
│       ├── server.py      ← WS server (kali-yarn host)
│       ├── config.py
│       ├── voice/         ← kali-voice (TTS: Piper/Qwen/HTTP)
│       │   └── qwen_cpp/  ← Qwen3-TTS C++ server
│       ├── ear/           ← kali-ear (STT)
│       ├── mind/          ← kali-mind (agent + LLM providers)
│       │   ├── llm/       ← Direct + Nanobot providers
│       │   ├── artifact_stream.py
│       │   ├── json_stream_extractor.py
│       │   └── vision.py
│       ├── claws/         ← kali-claws (tools)
│       │   ├── game/      ← Gaming tools
│       │   └── create_artifact.py
│       ├── gaze/          ← kali-gaze client (screen capture)
│       ├── canvas/        ← kali-canvas (artifact specs + registry)
│       ├── collar/        ← kali-collar (permissions)
│       ├── nest/          ← kali-nest (sessions + memory)
│       └── yarn/          ← kali-yarn (WS protocol schemas)
└── scripts/
    ├── dev.sh
    ├── prod.sh
    ├── download-voices.sh
    ├── download-stt-models.sh
    ├── download-qwen-models.sh
    ├── build-qwen-cpp.sh
    ├── dev-qwen.sh / prod-qwen.sh
    └── dev-qwen-vd.sh / prod-qwen-vd.sh
```

See [COMPONENTS.md](./COMPONENTS.md) for per-module detail and
[PROTOCOL.md](./PROTOCOL.md) for the event schemas.