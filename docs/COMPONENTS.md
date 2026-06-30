# Kali — Components

This document specifies every component of Kali: its purpose, public
interface, subcomponents, dependencies, and origin (port vs. new). Module
folder names use the cat-themed nomenclature agreed in [GLOSSARY.md].

The cat-themed names exist for two reasons:

1. **Identity.** A project named after a cat deserves cat-themed subsystems.
   It makes the codebase memorable and gives the project personality.
2. **Portability.** Each name is a future standalone project name. If a
   module matures, it can be split into its own repo with zero rename cost.

## New to the codebase? Start here.

This document is a reference — you do not need to read it from top to bottom.

**If you want to understand how Kali works end-to-end:**

1. Read [VISION.md](./VISION.md) first (3 minutes) — what Kali is and why.
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) (5 minutes) — the three layers and
   the data flow diagram.
3. Come back here only when you need to understand a specific component.

**If you want to modify a specific part:**

- **Agent logic, prompts, planning** → `kali-core/kali_core/mind/`
  (especially `runtime.py`, `planner.py`, `llm/`).
- **Tools** → `kali-core/kali_core/claws/` (each tool is one file).
- **Permissions** → `kali-core/kali_core/collar/`.
- **Voice (TTS)** → `kali-core/kali_core/voice/`.
- **Speech-to-text** → `kali-core/kali_core/ear/`.
- **Screen capture** → `kali-core/kali_core/gaze/`.
- **Frontend components** → `kali-web/src/stage/` and `kali-web/src/components/`.
- **Widgets** → `kali-web/src/components/widgets/`.
- **WebSocket protocol** → `kali-core/kali_core/yarn/` (Python) and
  `kali-web/src/lib/` (TypeScript).

Any directory with a cat name (`kali-*`) is a future standalone project — if
you need to extract it later, the rename cost is zero.

## Component map

```
            ┌────────────────────────────────────────────┐
            │              kali-shell  (Electron)           │
            │  ┌────────────────────────────────────────┐ │
            │  │            kali-web  (React)            │ │
            │  │   Stage · Workspace · Widgets          │ │
            │  └────────────────────────────────────────┘ │
            │  System tray · window management · sidecar  │
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
            │  providers  web/screenshot/launch/game      │
            │                                              │
            │  kali-voice (TTS)   kali-ear (STT)            │
            │  kali-gaze client  kali-canvas spec          │
            │  kali-nest (sessions)  kali-yarn (protocol)  │
            └──────────────────────────────────────────────┘
```

---

## kali-shell — The Shell (Electron / TypeScript)

**Purpose.** The native application container. Opens a window on the user's
OS, embeds a webview that renders `kali-web`, spawns and supervises the
Python sidecar (`kali-core`), and provides system-level capabilities
(system tray, window management, notifications).

**Design rule:** kali-shell does not contain business logic. It is a thin
bridge in TypeScript that manages the Electron window lifecycle.

### Subcomponents

| File | Purpose |
|---|---|
| `src/main.ts` | Electron app entrypoint, creates window, sets up IPC. |
| `src/sidecar.ts` | Spawns `python -m kali_core` as a child process, waits for its WS to be ready, restarts on crash. |
| `src/preload.ts` | Exposes safe IPC methods to the renderer process. |
| `electron-builder.yml` | Electron Builder config for AppImage/.deb packaging. |
| `package.json` | Electron 33.x + TypeScript 5.x dependencies. |

### Dependencies (TypeScript)

- `electron` 33.x
- `electron-builder` 25.x
- `typescript` 5.x
- `@types/node` 20.x

---

## kali-web — The Frontend (React + Vite + TypeScript)

**Purpose.** The visible UI rendered inside the kali-shell webview. Shows the
chat thread, live activity widgets, content canvas, consent modal, stage
with avatar and dock, and the voice/text input bar. Talks to kali-core over
WebSocket using the kali-yarn protocol.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Stage: avatar · mood · presence · HUD                    │
├─────────────────────────┬───────────────────────────────┤
│ Spotlight Input         │  NeuralCanvas / Artifacts    │
│ (voice + text input)    │  (draggable windows)         │
│                         │                               │
├─────────────────────────┴───────────────────────────────┤
│ VoiceBar: waveform · playback status                     │
├─────────────────────────────────────────────────────────┤
│ Settings: modular sections (Provider/Appearance/       │
│            Behavior/Voice/Generation)                  │
└─────────────────────────────────────────────────────────┘
```

### Stage Components (src/stage/)

| Component | Purpose |
|---|---|
| `StageProvider.tsx` | Main stage context, session state, artifact state. |
| `NeuralCanvas.tsx` | Artifact canvas hosting draggable windows. |
| `NeuralDock.tsx` | Dock with overflow menu, avatar, minimize button. |
| `MinimizeDock.tsx` | Minimize dock for collapsed state. |
| `SpotlightInput.tsx` | Combined voice + text input with auto-scroll. |
| `VoiceBar.tsx` | Audio waveform and playback status. |
| `HUD.tsx` | Model stats, tokens, latency, connection status. |
| `PresenceLayer.tsx` | Avatar mood and presence indicators. |
| `SessionDrawer.tsx` | Session list drawer from the side. |
| `ConversationModal.tsx` | Full conversation modal. |
| `ArtifactWindow.tsx` | Individual artifact window wrapper. |
| `ArtifactModal.tsx` | Modal view for artifacts. |
| `DebugPad.tsx` | Debug panel for development. |
| `CustomizerDrawer.tsx` | Avatar customization drawer. |
| `TetherLayer.tsx` | Tether animation layer. |
| `WindowContentRouter.tsx` | Routes content type to widget. |

### UI Components (src/components/)

| Component | Purpose |
|---|---|
| `SettingsModal.tsx` | Main settings modal with modular sections. |
| `settings/ProviderSection.tsx` | LLM provider selection and config. |
| `settings/AppearanceSection.tsx` | Theme, avatar, UI scale. |
| `settings/BehaviorSection.tsx` | Auto-TTS, wake word, diff preview. |
| `settings/VoiceSection.tsx` | Voice, mode, STT language. |
| `settings/GenerationSection.tsx` | Max tokens, temperature. |
| `settings/VoiceDesignControls.tsx` | Custom voice design (Qwen). |
| `settings/VoicePreviewButton.tsx` | Preview button for TTS voices. |
| `settings/fields.tsx` | Reusable form field components. |
| `ConsentModal.tsx` | Permission modal: `allow`, `no_capture`, `cancel`. |
| `ErrorBoundary.tsx` | Error boundary for component tree. |
| `JobsPanel.tsx` | Background jobs panel. |
| `ui/Overlay.tsx` | Reusable overlay component. |
| `ui/Button.tsx`, `IconButton.tsx`, `Modal.tsx`, `Sheet.tsx` | UI primitives. |
| `hooks/useChat.ts` | WebSocket connection, auto-reconnect, event dispatch. |
| `hooks/useTTS.ts` | Audio playback + analyser. |
| `hooks/usePTT.ts` | Push-to-talk / wake-word modes. |
| `hooks/useUIScale.ts` | UI scale factor. |
| `hooks/useDebug.ts` | Debug mode toggle. |
| `lib/wsClient.ts` | Typed WS client implementing kali-yarn. |
| `lib/protocol.ts` | TypeScript event type definitions. |
| `lib/i18n.ts` | react-i18next setup, loads `locale/{en,es}`. |

### Widgets (src/components/widgets/)

25+ widget types including: HtmlWidget, MarkdownWidget, CodeWidget, DiffWidget,
DocumentWidget, TableWidget, ChartWidget, ChecklistWidget, JsonTreeWidget,
MermaidWidget, QuizWidget, EntityCardWidget, ResourceCardWidget, GameImage,
and more.

### Sandboxing HTML artifacts

`HtmlWidget` mounts an `<iframe sandbox="allow-scripts">` (without
`allow-same-origin`) with a strict CSP. Generated mockups cannot reach Kali's
origin, cookies, or localStorage. Console logs can be retrieved via the
`console_request`/`console_response` protocol.

### i18n

`react-i18next` + `i18next-browser-languagedetector`. Locale catalogues live
in `src/locale/{en,es}/`. The default language follows the OS locale; the
user can override in Settings. See [I18N.md](./I18N.md).

### Dependencies (JS)

- `react` 18.x, `react-dom`, `react-i18next`, `i18next`.
- `marked`, `marked-highlight`, `highlight.js` (markdown render + syntax highlighting).
- `mermaid` (diagrams).
- `recharts` (charts).
- Vite + TypeScript + Tailwind CSS.

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

**Architecture: three providers.**
- `InProcTTSProvider` (default): runs Piper in-process. Lowest latency, no
  extra service.
- `QwenTTSProvider` (optional): high-quality neural TTS via local C++ server
  (`qwen_cpp/`). Requires building the server and downloading Qwen models.
- `HTTPTTSProvider` (optional): points at an external TTS HTTP service via
  config. For users who already run lapis-tts or similar.

All implement the `TTSProvider` interface, so the rest of Kali is agnostic.

### Subcomponents

| File | Purpose | Origin |
|---|---|---|
| `engine.py` — `PiperEngine` | Loads Piper `.onnx` models, synthesizes text → WAV bytes. | Port of `lapis-tts/src/tts/engine.py` |
| `pipeline.py` — `TTSPipeline` | Orchestrates: filter → segment → synthesize → effects → emit. | Based on legacy `nanobot.py:_process_tts` |
| `filter.py` | `filter_for_tts` + `segment_for_tts`. | Direct port of `app/tts_filter.py` |
| `effects/__init__.py` | Audio effects implemented with numpy/scipy (no ffmpeg). | **New.** |
| `voice_configs/` | Per-voice JSON configs (params, modes). | Inspired by lapis-tts configs, simplified. |
| `voice_configs/robot-es.json` | Default voice config. | New, derived from lapis-tts `robot-es.json`. |
| `voice_configs/glados-es.json` | GLaDOS-style voice config. | New. |
| `voices/` | Piper `.onnx` model files. Gitignored, downloaded by `scripts/download-voices.sh`. | — |
| `qwen_cpp/` | Qwen3-TTS C++ server. Requires building + model download. | New submodule |
| `providers/base.py` | `TTSProvider` ABC. | New. |
| `providers/inproc.py` | `InProcTTSProvider` (Piper). | New. |
| `providers/qwen.py` | `QwenTTSProvider` (Qwen3-TTS C++ server). | New. |
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

### Qwen3-TTS C++ Server

The `qwen_cpp/` directory contains a C++ server that provides high-quality
neural TTS using Qwen3 models:

- Build: `scripts/build-qwen-cpp.sh`
- Download models: `scripts/download-qwen-models.sh`
- Dev: `scripts/dev-qwen.sh`
- Prod: `scripts/prod-qwen.sh`
- Voice design: `scripts/dev-qwen-vd.sh`, `scripts/prod-qwen-vd.sh`

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
| `manager.py` — `STTManager` | Manages recognition sessions, hot-swap model/language, wake word. | New. |
| `models/` | Vosk model directories. Gitignored, downloaded by script. | — |
| `lang_map.py` | Language code normalization (`es-ES` → `es`). | New. |
| `claws/stt_corrector.py` | Post-process STT output for common corrections. | New. |

### Language Normalization

`lang_map.py` normalizes regional language codes to internal codes:

- `es-ES`, `es-MX`, `es-AR` → `es`
- `en-US`, `en-GB`, `en-AU` → `en`

This allows users to set their OS locale (e.g., `es-ES`) while the system
uses the correct Vosk model (`vosk-model-small-es-0.42`).

### Config

| Key | Default | Notes |
|---|---|---|
| `stt.model` | `vosk-model-small-es-0.42` | Model directory name. |
| `stt.language` | `es` | Active language (normalized from locale). |
| `stt.wake_word.enabled` | `false` | Push-to-talk by default. |
| `stt.wake_word.phrase` | `kali` | Wake phrase. |

### Flow

browser mic → 16 kHz PCM → WS binary → `StreamingSTT.accept(chunk)` →
partial/final transcript → `lang_map` normalization → `stt_corrector`
(optional corrections) → text → `kali-mind`.

---

## kali-mind — Agent Runtime

**Folder:** `kali-core/kali_core/mind/`

**Purpose.** The agentic loop: receive a message (text or transcribed voice),
plan, call tools, observe, and respond. Supports single-step and multi-step
planning. Handles artifact streaming and console retrieval.

### LLM providers (pluggable)

| Provider | Description | Origin |
|---|---|---|
| `direct.py` — `DirectLLMProvider` | OpenAI-compatible (local Ollama, llama.cpp, OpenRouter, OpenAI). Streaming + function-calling. Bridges native tool calls to artifact streaming. | Port of `app/llm.py` |
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
| `runtime.py` — `AgentRuntime` | Main loop: message → plan → act → observe → respond. Handles artifact streaming. |
| `planner.py` | Decides single-step (one tool) vs. multi-step (plan with several). |
| `executor.py` | Executes tools through kali-collar, collects observations. |
| `artifact_stream.py` | `ArtifactStreamProcessor` — parses `[BEGIN/END_ARTIFACT]` markers, emits create/update/close events. |
| `json_stream_extractor.py` | `StreamingArtifactArgParser` — incremental JSON parser for native tool-call args. |
| `marker_suppressor.py` | `MarkerSuppressor` — strips `[TOOL_CALL:]` markers from deltas in real time. |
| `console_requester.py` | Requests console logs from rendered HTML artifacts. |
| `vision.py` | Vision processor: sends screenshots to vision-capable LLM. |
| `ai_config.py` | AI configuration loader (system prompt, tools, etc.). |
| `jobs.py` | Background job tracking. |
| `llm/provider.py` | `LLMProvider` Protocol. |
| `llm/direct.py` | `DirectLLMProvider`. |
| `llm/nanobot.py` | `NanobotLLMProvider`. |

### Artifact Streaming

The runtime supports two artifact generation paths:

1. **Text markers:** LLM emits `[BEGIN_ARTIFACT:type] {json}` as text; backend
   parses and streams content live.
2. **Tool call path:** Native OpenAI function calls (`create_artifact` tool)
   are re-streamed as synthetic deltas for live preview.

See [ARTIFACT_GENERATION.md](./ARTIFACT_GENERATION.md) for details.

### Agent modes

- **Simple:** one LLM turn, tools via function-calling, one response.
- **Agentic:** LLM proposes a plan, executor runs tools sequentially, observes,
  iterates until the plan is done or the user cancels.

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
| `create_artifact` | safe | 3 | Create HTML/code/markdown artifacts on canvas. |
| `manage_artifacts` | safe | 3 | Get, close, or update existing artifacts. |
| `get_artifact_console` | safe | 3 | Retrieve console logs from HTML artifacts. |
| `game/dota_builds` | safe | 4 | Dota build recommendations via OpenDota API. |
| `game/dota_live` | safe | 4 | Live Dota match data (anti-spoiler). |
| `game/game_info` | safe | 4 | Game data (web_fetch + no-spoiler filter). |
| `list_monitors` | safe | 5 | List available displays/monitors. |
| `stt_corrector` | safe | 1 | Post-process STT output for corrections. |

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
| `organize.py` | `organize_folder`. |
| `create_artifact.py` | `create_artifact` tool. |
| `manage_artifacts.py` | `manage_artifacts`, `get_artifact_console`. |
| `list_monitors.py` | `list_monitors`. |
| `stt_corrector.py` | `stt_corrector`. |
| `game/dota.py` | Dota builds via OpenDota. |
| `game/dota_live.py` | Live Dota match data. |
| `game/generic.py` | Generic game info with no-spoiler mode. |
| `game/spoiler_filter.py` | Spoiler filter for game info. |
| `game/image_cache.py` | Image caching for game resources. |
| `game/fetch_resource.py` | Fetch and cache game hero/item images. |
| `game/adapter.py` | Generic game data adapter. |

---

## kali-gaze — Screen Capture

**Folder:** `kali-core/kali_core/gaze/`

**Purpose.** Non-intrusive screen capture with per-task consent. Uses the
Python `mss` library which automatically selects the best backend for the
current platform (Wayland/X11/Windows).

### Consent flow

1. Agent decides a screenshot is needed for the task.
2. The `screenshot` tool asks kali-collar for consent: "Kali wants to see
   your screen for [reason]. Allow?"
3. ConsentModal in kali-web shows three choices: `allow`, `no_capture`,
   `cancel`.
4. If `allow`: kali-core calls `mss` to capture → PNG bytes returned →
   kali-mind sends the PNG to a vision-capable LLM as context.
5. If `no_capture`: the agent continues without vision.
6. If `cancel`: the task is aborted.

### Backends

The `mss` library automatically selects:

| Backend | Platform | Notes |
|---|---|---|
| Wayland | Linux / Wayland | Via xdg-desktop-portal Screencast |
| X11 | Linux / X11 | Via Xlib |
| Windows | Windows | Via GDI |

Backend detection at runtime: `mss` detects `$WAYLAND_DISPLAY` vs `$DISPLAY`,
or uses `platform.system()` on Windows.

### Python client

| File | Purpose |
|---|---|
| `gaze/__init__.py` — `GazeClient` | Uses `mss` library for screen capture. Returns PNG bytes. |
| `gaze/local.py` | Local capture implementation using `mss`. |

---

## kali-canvas — Render / Artifacts

**Folder:** Spec in `kali-core/kali_core/canvas/`, UI in `kali-web/src/components/artifacts/`.

**Purpose.** Render content the agent generates: HTML mockups, documents,
diagrams, code diffs, activity widgets, charts, quizzes, and more.

### Artifact types

| Type | Description | Streamable |
|---|---|---|
| `html` | Raw HTML | Yes |
| `code` | Source code | Yes |
| `document` | Markdown | Yes |
| `diff` | Unified diff | Yes |
| `mermaid` | Mermaid diagram | No |
| `json` | JSON tree | No |
| `table` | Tabular data | No |
| `checklist` | Checklist | No |
| `chart` | Chart (recharts) | No |
| `quiz` | Quiz | No |

**Streamable** types update live as content arrives. **Non-streamable** types
show a spinner during streaming and render on close.

### Artifact protocol

The agent emits `artifact` events over WS:

```json
{
  "event": "artifact",
  "id": "uuid",
  "type": "html" | "markdown" | "code" | "diff" | "widget",
  "title": "Site mockup",
  "content": "<html>…</html>",
  "update": "create" | "update" | "close",
  "phase": "streaming" | "complete",
  "language": "html"
}
```

### UI components

| Component | Purpose |
|---|---|
| `NeuralCanvas.tsx` | Hosts multiple artifact windows. |
| `ArtifactWindow.tsx` | Individual draggable window. |
| `artifacts/HtmlArtifact.tsx` | Sandboxed iframe with strict CSP. |
| `artifacts/MarkdownArtifact.tsx` | Rendered markdown + mermaid. |
| `artifacts/DiffArtifact.tsx` | Diff view with syntax highlight. |
| `artifacts/WidgetGrid.tsx` | Grid of activity cards. |
| `widgets/` | 25+ widget types (HtmlWidget, CodeWidget, etc.). |

### Python side

| File | Purpose |
|---|---|
| `canvas/__init__.py` | Helpers for building artifact events (`html_artifact`, `markdown_artifact`, `diff_artifact`, `widget_artifact`). |
| `canvas/registry.py` | Resolves domain `type` → frontend `windowType`. |
| `canvas/streamer.py` | Streaming utilities for canvas updates. |

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

## Resolved Design Decisions

The following questions from early design have been resolved:

1. **Frontend framework:** React + Vite + TypeScript selected.
2. **Shell:** Electron (not Tauri/Rust) - cross-platform, easier to maintain.
3. **Nanobot:** Available as optional LLM provider, not required.
4. **Wake word:** Implemented in Phase 5 (optional feature).
5. **GLaDOS voice:** Added `glados-es.json` voice config.
6. **Vision:** Screenshots sent to vision-capable LLM (qwen-vl, gpt-4o, etc.).
7. **Artifact system:** Full streaming support with console retrieval.
8. **Session management:** Full CRUD via SQLite, including delete operations.