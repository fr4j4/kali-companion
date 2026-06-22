# Kali — Components

This document specifies every component of Kali: its purpose, public
interface, subcomponents, dependencies, and origin (port vs. new). Module
folder names use the cat-themed nomenclature agreed in [GLOSSARY.md].

The cat-themed names exist for two reasons:

1. **Identity.** A project named after a cat deserves cat-themed subsystems.
   It makes the codebase memorable and gives the project personality.
2. **Portability.** Each name is a future standalone project name. If a
   module matures, it can be split into its own repo with zero rename cost.

## Component map

```
            ┌────────────────────────────────────────────┐
            │              kali-home  (Rust)              │
            │  ┌────────────────────────────────────────┐ │
            │  │            kali-web  (React)            │ │
            │  │   kali-canvas widgets · ConsentModal     │ │
            │  └────────────────────────────────────────┘ │
            │  Screen capture · launch apps · sidecar     │
            └──────────────────────┬──────────────────────┘
                                   │  WS (kali-yarn)
            ┌──────────────────────▼──────────────────────┐
            │              kali-core  (Python)              │
            │                                              │
            │  kali-mind ──── kali-claws ──── kali-collar  │
            │     │             │              │            │
            │     │     ┌────────┴────────┐   │            │
            │     ▼     ▼                   ▼   ▼            │
            │  LLM    fs/cmd/tests/git   permissions         │
            │  providers  web/screenshot/launch  consent    │
            │                                              │
            │  kali-voice (TTS)   kali-ear (STT)            │
            │  kali-gaze client  kali-canvas spec          │
            │  kali-nest (sessions)  kali-yarn (protocol)  │
            └──────────────────────────────────────────────┘
```

---

## kali-home — The Shell (Rust / Tauri 2)

**Purpose.** The native application container. Opens a window on the user's
OS, embeds a webview that renders `kali-web`, spawns and supervises the
Python sidecar (`kali-core`), and provides the only path to system-level
capabilities that Python cannot reach safely (screen capture, launching
apps, native file dialogs, tray, notifications).

**Design rule:** kali-home does not contain business logic. It is a thin,
heavily-commented bridge. Every Rust file should be readable by someone who
does not know Rust yet.

### Subcomponents

| File | Purpose |
|---|---|
| `src/main.rs` | Tauri app entrypoint, registers commands, sets up the sidecar. |
| `src/sidecar.rs` | Spawns `python -m kali_core` as a child process, waits for its WS to be ready, restarts on crash. |
| `src/ipc.rs` | Forwards events between the webview and the Python sidecar over a local WS. |
| `src/commands.rs` | Tauri commands exposed to the webview: `kali_capture_screen`, `kali_launch_app`, `kali_file_dialog`, etc. |
| `src/capture/mod.rs` | `ScreenCapture` trait + runtime backend selection. |
| `src/capture/wayland.rs` | Wayland backend via `xdg-desktop-portal`. Phase 3. |
| `src/capture/x11.rs` | X11 backend. Phase 5 (stub for now). |
| `tauri.conf.json` | Window config (fullscreen-capable), sidecar registration, permissions. |

### ScreenCapture trait

```rust
pub trait ScreenCapture: Send + Sync {
    fn available() -> bool where Self: Sized;
    async fn capture_full(&self) -> Result<Vec<u8>, CaptureError>;
    async fn capture_window(&self, id: WindowId) -> Result<Vec<u8>, CaptureError>;
    async fn capture_region(&self, rect: Rect) -> Result<Vec<u8>, CaptureError>;
    async fn list_windows(&self) -> Vec<WindowInfo>;
}
```

Selection rule at startup: if `$WAYLAND_DISPLAY` is set, use `WaylandPortal`;
else if `$DISPLAY` is set, use `X11Capture` (Phase 5); else on Windows/macOS
use the platform-specific impl (Phase 5). The active backend is exposed to
the webview via a command so the UI can show what is available.

### Dependencies (Rust)

- `tauri` 2.x (with the `shell` plugin for sidecar management).
- `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-notification`.
- `tokio` (async runtime for capture).
- Backend-specific crates added in their phase.

---

## kali-web — The Frontend (React + Vite + TypeScript)

**Purpose.** The visible UI rendered inside the kali-home webview. Shows the
dashboard, chat thread, live activity widgets, content canvas, consent
modal, and the voice/text input bar. Talks to kali-core over WebSocket using
the kali-yarn protocol.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Header: profile · status · model · settings              │
├──────────┬─────────────────────────┬───────────────────┤
│ Sidebar  │  Chat / focus activity   │  kali-canvas      │
│ sessions │  + activity widgets      │  (artifacts)      │
│          │                           │                   │
├──────────┴─────────────────────────┴───────────────────┤
│ Input: [🎤 PTT] [text…] [send]                          │
└─────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose |
|---|---|
| `App.tsx` | Root, layout, providers (i18n, theme, WS client). |
| `components/Sidebar.tsx` | Session list, new chat button. |
| `components/ChatPanel.tsx` | Message list with syntax highlighting, streaming deltas, reasoning panel, tool hints. |
| `components/Canvas.tsx` | Artifact renderer host. |
| `components/artifacts/HtmlArtifact.tsx` | Sandboxed iframe for HTML/CSS/JS mockups (Gemini Canvas style). |
| `components/artifacts/MarkdownArtifact.tsx` | Rendered markdown + mermaid diagrams. |
| `components/artifacts/DiffArtifact.tsx` | Code diff with syntax highlighting. |
| `components/ConsentModal.tsx` | Permission modal: `allow`, `no_capture` (implemented), `cancel`. |
| `components/SettingsModal.tsx` | Voice, mode, LLM provider, profile and theme selectors, language. |
| `components/AudioVisualizer.tsx` | Canvas viz during TTS playback. |
| `components/PTTButton.tsx` | Push-to-talk button + status. |
| `hooks/useChat.ts` | WebSocket connection, auto-reconnect, event dispatch, reasoning + delta state. |
| `lib/wsClient.ts` | Typed WS client implementing kali-yarn. |
| `lib/i18n.ts` | react-i18next setup, loads `locale/{en,es}`. |

> Dashboard and WidgetGrid are planned for Phase 4 (multi-tool agentic flows).

### Sandboxing HTML artifacts

`HtmlArtifact` mounts an `<iframe sandbox="allow-scripts">` (without
`allow-same-origin`) with a strict CSP. Generated mockups cannot reach Kali's
origin, cookies, or localStorage.

### i18n

`react-i18next` + `i18next-browser-languagedetector`. Locale catalogues live
in `src/locale/{en,es}/`. The default language follows the OS locale; the
user can override in Settings. See [I18N.md](./I18N.md).

### Dependencies (JS)

- `react`, `react-dom`, `react-i18next`, `i18next`.
- `marked`, `marked-highlight`, `highlight.js` (markdown render + syntax highlighting, ported from legacy frontend).
- `mermaid` (diagrams, Phase 3).
- Vite + TypeScript.

---

## kali-core — The Body (Python 3.12 sidecar)

**Purpose.** The orchestration layer. Hosts the agent runtime, tools, voice
IO, permissions, sessions, and the WebSocket server that kali-web connects
to. Imports each cat-themed module as a subpackage.

### Top-level files

| File | Purpose |
|---|---|
| `kali_core/__main__.py` | CLI entrypoint: parses config, starts WS server. |
| `kali_core/server.py` | The WS server (kali-yarn host), routes events. |
| `kali_core/config.py` | Loads `~/.config/kali/config.toml`, exposes typed settings. |

---

## kali-voice — TTS Engine

**Folder:** `kali-core/kali_core/voice/`

**Purpose.** Convert text into playable audio, with `robot-es` (GLaDOS-like,
no copyright) as the default voice. Customizable via JSON voice configs.

**Architecture: hybrid.**
- `InProcTTSProvider` (default): runs Piper in-process. Lowest latency, no
  extra service.
- `HTTPTTSProvider` (optional): points at an external TTS HTTP service via
  config. For users who already run lapis-tts or similar.

Both implement the `TTSProvider` interface, so the rest of Kali is agnostic.

### Subcomponents

| File | Purpose | Origin |
|---|---|---|
| `engine.py` — `PiperEngine` | Loads Piper `.onnx` models, synthesizes text → WAV bytes. | Port of `lapis-tts/src/tts/engine.py` |
| `pipeline.py` — `TTSPipeline` | Orchestrates: filter → segment → synthesize → effects → emit. | Based on legacy `nanobot.py:_process_tts` |
| `filter.py` | `filter_for_tts` + `segment_for_tts`. | Direct port of `app/tts_filter.py` |
| `effects/__init__.py` | Audio effects implemented with numpy/scipy (no ffmpeg). | **New.** |
| `voice_configs/` | Per-voice JSON configs (params, modes). | Inspired by lapis-tts configs, simplified. |
| `voice_configs/robot-es.json` | Default voice config. | New, derived from lapis-tts `robot-es.json`. |
| `voices/` | Piper `.onnx` model files. Gitignored, downloaded by `scripts/download-voices.sh`. | — |
| `providers/base.py` | `TTSProvider` ABC. | New. |
| `providers/inproc.py` | `InProcTTSProvider`. | New. |
| `providers/http.py` | `HTTPTTSProvider`. | New. |

### Audio effects (numpy, no ffmpeg)

Each effect is a function
`apply(audio: np.ndarray, sr: int, params: dict) -> np.ndarray`. Effects are
declared in JSON (same shape as lapis-tts effect files, but `type: "numpy"`).

| Effect | Numpy implementation |
|---|---|
| `normal` | passthrough. |
| `whisper` | pitch shift up + volume reduction + low-pass filter. |
| `robotic` | ring modulation + slight pitch down. |
| `radio` | bandpass 500–3500 Hz + simple compressor. |
| `deep` | pitch shift down + light reverb (delay feedback). |
| `processed` | low-pass filter + light distortion (tanh). |

### Default voice: robot-es

```json
{
  "voice_id": "robot-es",
  "name": "Robot ES (Kali default)",
  "description": "Robotic Spanish voice, GLaDOS-inspired, no copyright.",
  "model": "es_ES-davefx-medium",
  "active": true,
  "params": {
    "length_scale": 0.95,
    "noise_scale": 0.5,
    "noise_w_scale": 0.6
  },
  "segment_silence": 0.2,
  "default_mode": "robotic",
  "modes": {
    "normal":    { "effects": [] },
    "whisper":   { "effects": ["whisper"] },
    "robotic":   { "effects": ["robotic"] },
    "radio":     { "effects": ["radio"] },
    "deep":      { "effects": ["deep"] }
  }
}
```

### Synthesis flow

```
raw LLM text
   │
   ▼
filter_for_tts()          strips code/URLs/markdown
   │
   ▼
segment_for_tts()         splits into ≤500-char chunks
   │
   ▼ per segment:
   ├─ PiperEngine.synthesize(model, segment, params) → WAV bytes
   ├─ numpy: WAV → ndarray
   ├─ apply mode effects (e.g. robotic)
   ├─ numpy: ndarray → WAV bytes
   └─ emit "tts_audio" event (base64) to kali-web
   ▼
browser plays each segment as it arrives
```

### Streaming model

**Phase 1:** per-segment streaming (already proven in the legacy project).
Each segment is shipped and played in order. Inter-segment gaps are natural
speech pauses, so playback feels fluid.

**Phase 5 (stretch):** intra-segment PCM streaming using Piper's iterable
synthesis output. Requires effects that support streaming; complicated and
not blocking. Documented as a future improvement.

### Customization

- Switch voice: pick another `voice_id` in config.
- Switch mode: `normal | whisper | robotic | radio | deep`, per session or
  global.
- Create a new voice: drop a JSON in `voice_configs/` + an `.onnx` model in
  `voices/`.
- Override synthesis params: `length_scale` (speed), `noise_scale`
  (expressiveness), `noise_w_scale` (jitter) via UI/config.
- Annotated text: support inline tags like `<whisper>text</whisper>` to
  change mode mid-message (port of lapis-tts `utils/text.py`).

### Dependencies

`piper` (Piper Python package), `numpy`, `scipy`. No ffmpeg required. Python
3.12.

### Relationship to lapis-tts

kali-voice is a new module, inspired by lapis-tts's architecture (Piper
engine, JSON voice configs, effect registry, segmented synthesis) but
reimplemented in-process and simplified. lapis-tts remains an independent
project; kali-voice does not import it. Users who want to keep using
lapis-tts can point Kali at it via the optional `HTTPTTSProvider`.

---

## kali-ear — STT Engine

**Folder:** `kali-core/kali_core/ear/`

**Purpose.** Real-time offline speech-to-text with multi-language support.

### Subcomponents

| File | Purpose | Origin |
|---|---|---|
| `vosk_engine.py` — `StreamingSTT` | Vosk streaming recognizer. | Direct port of `app/stt.py` |
| `manager.py` — `STTManager` | Manages recognition sessions, hot-swap model/language. | New. |
| `models/` | Vosk model directories. Gitignored, downloaded by script. | — |

> Wake word detection lives in `manager.py` as an optional feature (Phase 5).

### Config

| Key | Default | Notes |
|---|---|---|
| `stt.model` | `vosk-model-small-es-0.42` | Model directory name. |
| `stt.language` | `es` | Active language. |
| `stt.wake_word.enabled` | `false` | Push-to-talk by default. |
| `stt.wake_word.phrase` | `kali` | Wake phrase. |

### Flow

browser mic → 16 kHz PCM → WS binary → `StreamingSTT.accept(chunk)` →
partial/final transcript → text → `kali-mind`.

---

## kali-mind — Agent Runtime

**Folder:** `kali-core/kali_core/mind/`

**Purpose.** The agentic loop: receive a message (text or transcribed voice),
plan, call tools, observe, and respond. Supports single-step (Phase 1) and
multi-step (Phase 2+) planning.

### LLM providers (pluggable)

| Provider | Description | Origin |
|---|---|---|
| `direct.py` — `DirectLLMProvider` | OpenAI-compatible (local Ollama, llama.cpp, OpenRouter, OpenAI). Streaming. | Port of `app/llm.py` |
| `nanobot.py` — `NanobotLLMProvider` | Wraps nanobot's WS protocol (tools, reasoning, sessions). | Port of `app/nanobot.py` |
| `provider.py` — `LLMProvider` (Protocol) | Common interface. | New. |

```python
class LLMProvider(Protocol):
    async def stream(
        self, messages: list[dict], tools: list[ToolDef]
    ) -> AsyncIterator[StreamEvent]: ...
    async def complete(
        self, messages: list[dict], tools: list[ToolDef]
    ) -> dict: ...
```

`StreamEvent` is a tagged union: `Delta | ToolCall | Reasoning | Done`.

### Subcomponents

| File | Purpose |
|---|---|
| `runtime.py` — `AgentRuntime` | Main loop: message → plan → act → observe → respond. |
| `planner.py` | Decides single-step (one tool) vs. multi-step (plan with several). |
| `executor.py` | Executes tools through kali-collar, collects observations. |
| `llm/provider.py` | `LLMProvider` Protocol. |
| `llm/direct.py` | `DirectLLMProvider`. |
| `llm/nanobot.py` | `NanobotLLMProvider`. |

### Agent modes

- **Simple (Phase 1):** one LLM turn, tools via function-calling, one
  response. Easiest to reason about; good baseline.
- **Agentic (Phase 2+):** LLM proposes a plan, executor runs tools
  sequentially, observes, iterates until the plan is done or the user
  cancels.

> For the learner: `kali-mind` is where you will experiment with planning,
> memory, and reflection. The `LLMProvider` interface isolates you from the
> specific backend, so you can iterate on agent logic with any model.

---

## kali-claws — Tools

**Folder:** `kali-core/kali_core/claws/`

**Purpose.** The set of actions Kali can perform in your system. Each tool
has a schema, a risk level, and goes through kali-collar for permission
checks.

### Tool interface

```python
class Tool(Protocol):
    name: str
    description: str          # shown to the LLM
    schema: dict              # JSON schema for params
    risk_level: str           # "safe" | "sensitive" | "dangerous"
    async def run(self, params: dict, ctx: ToolContext) -> ToolResult: ...
```

`ToolContext` carries: active profile, permissions, working dir, consent
callback. `ToolResult` is `{ "output": str | dict | artifact, "error": str | None }`.

### Tools by phase

| Tool | Risk | Phase | Description |
|---|---|---|---|
| `fs_read` | safe | 1 | Read a file (within working dir). |
| `fs_write` | sensitive | 1 | Write/edit a file (with consent). |
| `fs_list` | safe | 1 | List a directory. |
| `run_command` | dangerous | 1 | Run a shell command (whitelist + consent). |
| `run_tests` | sensitive | 2 | Detect framework (pytest/jest/go) and run tests. |
| `git_worktree` | sensitive | 2 | Create a worktree + branch to implement in parallel. |
| `git_diff` | safe | 2 | Show diff of a branch/worktree. |
| `launch_app` | sensitive | 2 | Launch an app via XDG desktop entry (Linux). |
| `web_search` | safe | 2 | Web search (DuckDuckGo/Searx, no API key). |
| `web_fetch` | safe | 2 | Fetch + extract text from a URL. |
| `screenshot` | sensitive | 3 | Screen capture (via kali-gaze). |
| `organize_folder` | sensitive | 3 | Propose + execute folder reorg (consent per file). |
| `game/dota_builds` | safe | 4 | Dota build recommendations via public API. |
| `game/game_info` | safe | 4 | Game data (web_fetch + no-spoiler filter). |

### Subcomponents

| File | Purpose |
|---|---|
| `base.py` | `Tool` Protocol, `ToolContext`, `ToolResult`, registry. |
| `fs.py` | `fs_read`, `fs_write`, `fs_list`. |
| `command.py` | `run_command`. |
| `tests.py` | `run_tests`. |
| `git.py` | `git_worktree`, `git_diff`. |
| `web.py` | `web_search`, `web_fetch`. |
| `screenshot.py` | `screenshot` (calls kali-gaze). |
| `launcher.py` | `launch_app`. |
| `game/dota.py` | Dota builds. |
| `game/generic.py` | Generic game info with no-spoiler mode. |

---

## kali-gaze — Screen Capture

**Folder:** Rust side in `kali-home/src/capture/`, Python client in
`kali-core/kali_core/gaze/`.

**Purpose.** Non-intrusive screen capture with per-task consent. The Rust
side implements the `ScreenCapture` trait; the Python side is a thin client
that asks kali-home to do the actual capture via a Tauri command.

### Consent flow

1. Agent decides a screenshot is needed for the task.
2. The `screenshot` tool asks kali-collar for consent: "Kali wants to see
   your screen for [reason]. Allow?"
3. ConsentModal in kali-web shows three choices: `allow`, `no_capture`,
   `cancel`.
4. If `allow`: kali-core asks kali-home to capture → PNG bytes come back →
   kali-mind sends the PNG to a vision-capable LLM as context.
5. If `no_capture`: the agent continues without vision.
6. If `cancel`: the task is aborted.

### Backends

| Backend | Platform | Phase | Notes |
|---|---|---|---|
| `WaylandPortal` | Linux / Wayland | 3 | xdg-desktop-portal Screencast, no root, asks the first time. |
| `X11Capture` | Linux / X11 | 5 | XGetImage / xwd. |
| `WindowsCapture` | Windows | 5 | Graphics Capture API. |
| `MacOSCapture` | macOS | 5 | ScreenCaptureKit (Screen Recording permission). |

Backend selection at runtime: kali-home detects `$WAYLAND_DISPLAY` vs
`$DISPLAY`, picks the right backend, and exposes its availability to the
core via a Tauri command.

### Python client

| File | Purpose |
|---|---|
| `gaze/__init__.py` — `GazeClient` | Calls the `kali_capture_screen` Tauri command via the WS bridge. Returns PNG bytes. |

---

## kali-canvas — Render / Artifacts

**Folder:** Spec in `kali-core/kali_core/canvas/`, UI in `kali-web/src/components/artifacts/`.

**Purpose.** Render content the agent generates: HTML mockups, documents,
diagrams, code diffs, activity widgets.

### Artifact protocol

The agent emits `artifact` events over WS:

```json
{
  "event": "artifact",
  "id": "uuid",
  "type": "html" | "markdown" | "diff" | "widget",
  "title": "Site mockup",
  "content": "<html>…</html>",
  "update": "create" | "update" | "close"
}
```

### UI components

| Component | Purpose |
|---|---|
| `Canvas.tsx` | Hosts multiple artifacts. |
| `HtmlArtifact.tsx` | Sandboxed iframe with strict CSP. |
| `MarkdownArtifact.tsx` | Rendered markdown + mermaid. |
| `DiffArtifact.tsx` | Diff view with syntax highlight. |

> `WidgetGrid` is planned for Phase 4 (activity cards for multi-step agentic flows).

### Python side

| File | Purpose |
|---|---|
| `canvas/__init__.py` | Helpers for building artifact events from tool output (`html_artifact`, `markdown_artifact`, `diff_artifact`, `widget_artifact`). |

---

## kali-collar — Permissions & Consent

**Folder:** `kali-core/kali_core/collar/`

**Purpose.** Control sensitive actions with profiles + per-action override.

### Model: approval + modes

Profiles are JSON files in `profiles/`. Each profile whitelists tools and
constraints (working dirs, command prefixes).

```json
{
  "id": "dev",
  "name": "Development",
  "allowed_tools": ["fs_read", "fs_list", "run_tests", "git_worktree", "git_diff"],
  "working_dirs": ["~/projects/**"],
  "command_whitelist": ["pytest", "npm test", "go test", "git *"]
}
```

### Flow

1. Each `Tool` declares `risk_level: safe | sensitive | dangerous`.
2. `PermissionGateway.check(tool, params, ctx)`:
   - `safe` → allow.
   - `sensitive` → if listed in `profile.allowed_tools` and params satisfy
     the profile constraints → allow; else → request consent.
   - `dangerous` → always request consent, regardless of profile.
3. Consent flows via `consent_request` → ConsentModal → `consent_response`.
4. The active profile is switchable at runtime from the UI header.

### Subcomponents

| File | Purpose |
|---|---|
| `gateway.py` — `PermissionGateway` | Decides if a tool needs consent. |
| `consent.py` — `ConsentManager` | Issues `consent_request`, awaits response. |
| `profiles/dev.json` | Dev profile. |
| `profiles/gaming.json` | Gaming profile. |
| `profiles/files.json` | Files profile. |
| `profiles/general.json` | General profile. |

---

## kali-nest — Sessions & Memory

**Folder:** `kali-core/kali_core/nest/`

**Purpose.** Multi-conversation support, per-session context, persistent
history.

### Subcomponents

| File | Purpose |
|---|---|
| `store.py` — `SessionStore` | CRUD over a local SQLite database. |
| `memory.py` | Working memory (last N messages) + long-term memory (summaries). |

### Schema

- `Session { id, title, created, updated, profile, messages[] }`
- `Message { id, session_id, role, content, tool_events[] }`

---

## kali-yarn — IO Protocol

**Folder:** `kali-core/kali_core/yarn/`

**Purpose.** The WebSocket protocol between kali-web and kali-core. Defines
typed event schemas so both sides can be developed against a contract.

### Subcomponents

| File | Purpose |
|---|---|
| `protocol.py` | Event type definitions. |
| `router.py` | Dispatches incoming events to the right handler. |

The full event catalogue is in [PROTOCOL.md](./PROTOCOL.md).

---

## 9. Open questions

1. **Frontend framework.** React recommended (canvas ecosystem, familiy).
   Confirm or pick Svelte (simpler curve).
2. **Nanobot as a soft dependency.** The README will say Kali works without
   nanobot; if you have it, you can opt in. Confirm.
3. **Wake word.** Scheduled for Phase 5. Confirm.
4. **Dedicated GLaDOS model.** For now `robot-es` (davefx + robotic effects).
   If a community Piper GLaDOS `.onnx` appears later, drop it in
   `voice/voices/` and add a `glados.json` config pointing at it. Should the
   README document this?
5. **Vision provider.** In Phase 3, screenshots get sent to the LLM. Do you
   have a vision-capable model available (qwen-vl, gpt-4o, gemini), or do we
   OCR with tesseract and pass the text? Depends on the LLM you run.