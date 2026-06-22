# Kali — Architecture

This document describes the high-level architecture of Kali, the data flow
between its layers, and the key technical decisions.

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  kali-home  (Tauri / Rust)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  kali-web  (Frontend: React + Vite + TypeScript)       │  │
│  │  Dashboard · Chat · Widgets · Canvas · Consent modal   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Tauri commands (IPC) → system capabilities:                 │
│    - Screen capture  (Wayland portal / X11 / Win / macOS)    │
│    - Launch apps, file dialogs, notifications, tray          │
│                                                              │
│  Sidecar launcher: spawns + supervises the Python process    │
└───────────────────────┬─────────────────────────────────────┘
                        │  Local WebSocket (JSON) + stdio
┌───────────────────────▼─────────────────────────────────────┐
│                 kali-core  (Python sidecar)                    │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐   │
│  │ kali-mind    │  │ kali-claws  │  │ kali-voice / kali-ear │  │
│  │ Agent runtime│  │ Tools with  │  │ TTS (Piper + numpy)  │   │
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
| Shell | `kali-home/` | Rust (Tauri 2) | Native window, system access, spawns the Python sidecar |
| Frontend | `kali-web/` | TypeScript (React + Vite) | UI rendered in the webview: dashboard, chat, widgets, canvas |
| Core | `kali-core/` | Python 3.12 (asyncio) | Agent runtime, tools, voice, permissions, sessions |

### Why this split?

- **Python carries the brain.** The user is learning AI and wants to iterate on
  agent logic, tools, and prompts. Python is the most readable surface for
  that work; Rust would slow that loop down.
- **Rust is minimal and commented.** The shell only does what Python cannot:
  open a native window, talk to Wayland/X11 for screen capture, launch apps
  via desktop entries, and supervise the sidecar process. Every Rust file is
  small and commented so it can be read without prior Rust experience.
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
kali-mind calls the "screenshot" tool
   │
   ▼
kali-claws/screenshot ──► kali-collar (consent: "Kali wants to see your screen…")
   │ allowed
   ▼
kali-core/gaze/client ──► Tauri command "kali_capture_screen"
                                    │
                                    ▼
                            kali-home/src/capture (Rust)
                                    │  selects backend at runtime:
                                    │    Wayland → xdg-desktop-portal
                                    │    X11    → (Phase 5)
                                    │    Win    → (Phase 5)
                                    ▼
                              PNG bytes back through IPC
                                    │
                                    ▼
                         kali-mind sends PNG to vision-capable LLM
```

## Key technical decisions

### 1. Hybrid TTS (in-process by default, HTTP optional)

- **Default:** `kali-voice` runs in-process inside `kali-core` using Piper
  directly. No HTTP hop, lowest latency, no extra service to manage.
- **Optional:** a config flag can point Kali at an external TTS HTTP service
  (e.g. lapis-tts or anything else exposing a compatible endpoint). Useful for
  people who already run a TTS server.

Both paths implement the same `TTSProvider` interface, so the rest of Kali is
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

### 5. Screen capture as a Rust trait

```rust
trait ScreenCapture {
    fn available() -> bool;
    async fn capture_full() -> Result<Vec<u8>>;
    async fn capture_window(id: WindowId) -> Result<Vec<u8>>;
    async fn capture_region(rect: Rect) -> Result<Vec<u8>>;
    async fn list_windows() -> Vec<WindowInfo>;
}
```

Implementation selection happens at runtime based on environment detection
(`$WAYLAND_DISPLAY`, `$DISPLAY`, OS). Phase 3 ships Wayland; X11/Windows/macOS
are Phase 5.

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

See [I18N.md](./I18N.md) for the full strategy.

## Process lifecycle

```
user starts kali-home (Tauri app)
   │
   ▼
kali-home/main.rs:
   1. build Tauri app, register commands
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
   - kali-home only intervenes when kali-core asks for system access
     (capture, launch app, file dialog) via Tauri commands
```

If the sidecar crashes, `kali-home` detects the WS drop and restarts it,
preserving the frontend session.

## Repository layout

```
kali/
├── README.md
├── docs/                  ← you are here
├── kali-home/             ← Rust/Tauri shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── sidecar.rs     ← spawns + supervises kali-core
│       ├── ipc.rs         ← bridges webview ↔ core over WS
│       ├── commands.rs    ← Tauri commands exposed to webview
│       └── capture/       ← ScreenCapture trait + backends
├── kali-web/              ← Frontend
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       └── locale/{en,es}/ ← i18n catalogues
├── kali-core/             ← Python sidecar
│   ├── pyproject.toml
│   └── kali_core/
│       ├── __main__.py
│       ├── server.py      ← WS server (kali-yarn host)
│       ├── config.py
│       ├── voice/         ← kali-voice (TTS)
│       ├── ear/           ← kali-ear (STT)
│       ├── mind/          ← kali-mind (agent + LLM providers)
│       ├── claws/         ← kali-claws (tools)
│       ├── gaze/          ← kali-gaze client (talks to Rust)
│       ├── canvas/        ← kali-canvas (artifact specs)
│       ├── collar/        ← kali-collar (permissions)
│       ├── nest/          ← kali-nest (sessions + memory)
│       └── yarn/          ← kali-yarn (WS protocol schemas)
└── scripts/
    ├── download-voices.sh
    └── dev.sh
```

See [COMPONENTS.md](./COMPONENTS.md) for per-module detail and
[PROTOCOL.md](./PROTOCOL.md) for the event schemas.