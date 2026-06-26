# Kali — AI Voice Companion: Plan del Proyecto

> Cat-themed, always-on desktop companion que vive en tu segundo monitor.
> Voz y texto como iguales. Local-first. No es un chatbot — es una presencia
> que investiga, renderiza y actúa por ti.

---

## Tabla de contenidos

1. [Visión](#1-visión)
2. [Arquitectura](#2-arquitectura)
3. [Roadmap por fases](#3-roadmap-por-fases)
4. [Estado actual por fase](#4-estado-actual-por-fase)
5. [Inventario completo de features](#5-inventario-completo-de-features)
6. [Módulos y archivos](#6-módulos-y-archivos)
7. [Protocolo WebSocket (kali-yarn)](#7-protocolo-websocket-kali-yarn)
8. [Pendientes y gaps](#8-pendientes-y-gaps)
9. [Métricas actuales](#9-métricas-actuales)

---

## 1. Visión

Kali es un asistente AI open-source que vive fullscreen en un segundo monitor,
siempre presente mientras programas, juegas o trabajas.

**Pilares de diseño:**

- **Always present, never intrusive** — espera a que la llames.
- **Capable, not just conversational** — ejecuta acciones reales (tests, worktrees, apps).
- **Voice and text as equals** — ninguno es ciudadano de segunda.
- **Render, don't just reply** — mockups, documentos, diffs, widgets.
- **Local-first and private** — STT offline, TTS local, LLM configurable.
- **Explicit consent** — toda acción sensible pide aprobación.

**Casos de uso objetivo:**

- **Desarrollo:** correr tests, crear worktrees paralelos, asistencia contextual.
- **Gaming:** builds de Dota 2, info de juegos sin spoilers.
- **Organización:** reorganizar carpetas con aprobación.
- **Asistencia general:** investigar, renderizar mockups, lanzar apps.

---

## 2. Arquitectura

### Modelo de tres capas

| Capa | Directorio | Lenguaje | Responsabilidad |
|---|---|---|---|
| Shell | `kali-home/` | Rust (Tauri 2) | Ventana nativa, captura de pantalla, lanzar apps, supervisar sidecar |
| Frontend | `kali-web/` | TypeScript (React + Vite) | UI: chat, canvas, consent, settings, voice input |
| Core | `kali-core/` | Python 3.12 (asyncio) | Agent runtime, tools, TTS, STT, permisos, sesiones |

### Flujo de datos

```
Usuario (texto o voz)
    │
    ▼
kali-web ── WS event "input" ──► kali-core
                                    │
                                    ▼
                              kali-mind (AgentRuntime)
                                    │
                         LLM provider (direct | nanobot)
                                    │
                         may call kali-claws tools
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
               kali-web ◄── "delta"        kali-voice (TTS)
               (streamed text)                  │
                                               ▼
                                    kali-web ◄── "tts_audio"
```

### Stack técnico

| Capa | Tech | Razón |
|---|---|---|
| Shell | Tauri 2 + Rust | Ligero, modular, multiplataforma |
| Frontend | React + Vite + TypeScript | Ecosistema canvas, i18n |
| Core | Python 3.12 + asyncio | Legible para aprender AI |
| Protocolo | WebSocket local (JSON) | Mismo patrón que el prototipo legacy |
| STT | Vosk (offline) | Ya funcionaba en el prototipo |
| TTS | Piper in-process + numpy effects | Local, sin ffmpeg |
| LLM | OpenAI-compatible + nanobot | Flexible |
| Captura | xdg-desktop-portal (Wayland) | Estándar, sin root |
| Permisos | JSON profiles + consent | Declarativo |
| i18n | react-i18next | Estándar, browser-friendly |

---

## 3. Roadmap por fases

| Fase | Scope | Entrega | Estado |
|---|---|---|---|
| **0 — Cimientos** | Tauri shell, WS, STT/TTS, DirectLLMProvider, frontend base | Companion funcional en mejor shell | ✅ Completo |
| **1 — Agente + tools básicas** | AgentRuntime single-step, `fs_read`/`fs_list`/`run_command`, PermissionGateway, consent modal, themes, profiles, syntax highlighting | Agente con tools y permisos | ✅ Completo |
| **2 — Dev use cases** | `run_tests`, `git_worktree`, `git_diff`, `launch_app`, `web_search`, `web_fetch`, multi-session, gaming/files profiles, Planner, Memory, NanobotLLMProvider, reasoning_delta | "Pídele correr tests / crear worktree" | ✅ Completo |
| **3 — Capture + render** | Wayland ScreenCapture, `screenshot` tool, Canvas artifacts (HTML/markdown/diff), vision provider, `organize_folder` | "Que vea mi pantalla y renderice un mockup" | ✅ Completo |
| **4 — Gaming** | Dota builds (OpenDota + scraping), anti-spoiler game info, per-game widgets, refined gaming profile, LLM vision multimodal | "Asistencia en partida" | ⬜ En progreso |
| **5 — Voz avanzada + portabilidad** | Wake word, intra-segment PCM streaming, X11/Windows/macOS capture, packaging (AppImage/.deb) | Release open-source pulido | ⬜ Pendiente |

---

## 4. Estado actual por fase

### Fase 0 — Cimientos ✅ Completo

| Feature | Estado | Archivo(s) |
|---|---|---|
| Tauri 2 shell con webview | ✅ | `kali-home/src/main.rs` |
| Sidecar supervisor (spawn + restart) | ✅ | `kali-home/src/sidecar.rs` |
| Tauri commands (port, capture, launch) | ✅ | `kali-home/src/commands.rs` |
| WebSocket server (FastAPI + uvicorn) | ✅ | `kali-core/kali_core/server.py` |
| Config typed (`config.toml` + env vars) | ✅ | `kali-core/kali_core/config.py` |
| DirectLLMProvider (OpenAI-compatible) | ✅ | `kali-core/kali_core/mind/llm/direct.py` |
| TTS Piper in-process + numpy effects | ✅ | `kali-core/kali_core/voice/` |
| STT Vosk offline | ✅ | `kali-core/kali_core/ear/` |
| Frontend React + Vite + TS | ✅ | `kali-web/src/` |
| i18n (en/es) con react-i18next | ✅ | `kali-web/src/locale/`, `kali-web/src/lib/i18n.ts` |
| WS client tipado con reconnect | ✅ | `kali-web/src/lib/wsClient.ts` |
| Protocolo WS documentado | ✅ | `docs/PROTOCOL.md`, `kali_core/yarn/protocol.py` |
| Themes (synthwave/midnight/sunset/forest) | ✅ | `kali-web/src/styles.css` |

### Fase 1 — Agente + tools básicas ✅ Completo

| Feature | Estado | Archivo(s) | Tests |
|---|---|---|---|
| AgentRuntime (single-step + multi-step loop) | ✅ | `kali-core/kali_core/mind/runtime.py` | `test_runtime.py` (1 test) |
| `LLMProvider` Protocol + `StreamEvent` | ✅ | `kali-core/kali_core/mind/llm/provider.py` | — |
| `fs_read` tool (safe) | ✅ | `kali-core/kali_core/claws/fs.py` | `test_tools.py` |
| `fs_list` tool (safe) | ✅ | `kali-core/kali_core/claws/fs.py` | `test_tools.py` |
| `fs_write` tool (sensitive) | ✅ | `kali-core/kali_core/claws/fs.py` | `test_tools.py` |
| `run_command` tool (dangerous, whitelist) | ✅ | `kali-core/kali_core/claws/command.py` | `test_tools.py` |
| PermissionGateway (safe/sensitive/dangerous) | ✅ | `kali-core/kali_core/collar/gateway.py` | `test_tools.py` (6 tests) |
| ConsentManager (consent_request + 60s timeout) | ✅ | `kali-core/kali_core/collar/consent.py` | `test_tools.py` (2 tests) |
| Executor (gateway + consent + tool_event) | ✅ | `kali-core/kali_core/mind/executor.py` | `test_tools.py` (3 tests) |
| Profiles JSON (dev, general) | ✅ | `kali-core/kali_core/collar/profiles/` | `test_server.py` |
| ConsentModal UI (allow/no_capture/cancel) | ✅ | `kali-web/src/components/ConsentModal.tsx` | — |
| ChatPanel + Message con syntax highlighting | ✅ | `kali-web/src/components/ChatPanel.tsx`, `Message.tsx` | — |
| Header (status, profile, model, settings) | ✅ | `kali-web/src/components/Header.tsx` | — |
| Sidebar (session list) | ✅ | `kali-web/src/components/Sidebar.tsx` | — |
| InputBar (text + send + PTT) | ✅ | `kali-web/src/components/InputBar.tsx` | — |
| PTTButton (push-to-talk) | ✅ | `kali-web/src/components/PTTButton.tsx` | — |
| AudioVisualizer (TTS playback) | ✅ | `kali-web/src/components/AudioVisualizer.tsx` | — |
| Canvas (artifact host) | ✅ | `kali-web/src/components/Canvas.tsx` | — |
| SettingsModal (voice, model, theme, etc.) | ✅ | `kali-web/src/components/SettingsModal.tsx` | — |
| useChat hook (WS state) | ✅ | `kali-web/src/hooks/useChat.ts` | — |
| useTTS hook (audio playback) | ✅ | `kali-web/src/hooks/useTTS.ts` | — |
| usePTT hook (voice input) | ✅ | `kali-web/src/hooks/usePTT.ts` | — |
| Activity widgets (WidgetGrid/Dashboard) | ⬜ **Pendiente** | — | — |

### Fase 2 — Dev use cases ✅ Completo

| Feature | Estado | Archivo(s) | Tests |
|---|---|---|---|
| `run_tests` tool (auto-detect pytest/jest/go/cargo) | ✅ | `kali-core/kali_core/claws/tests.py` | `test_phase2_tools.py` (2 tests) |
| `git_worktree` tool | ✅ | `kali-core/kali_core/claws/git.py` | `test_phase2_tools.py` (2 tests) |
| `git_diff` tool (+ diff artifact) | ✅ | `kali-core/kali_core/claws/git.py` | `test_phase2_tools.py` (2 tests) |
| `launch_app` tool (Python, XDG .desktop) | ✅ | `kali-core/kali_core/claws/launcher.py` | `test_phase2_tools.py` (1 test) |
| `launch_app` Tauri command (Rust) | ✅ | `kali-home/src/commands.rs` | — |
| `web_search` tool (SearXNG) | ✅ | `kali-core/kali_core/claws/web.py` | ⚠️ Solo registro |
| `web_fetch` tool (httpx + HTML extract) | ✅ | `kali-core/kali_core/claws/web.py` | ⚠️ Solo registro |
| Multi-session (SessionStore SQLite) | ✅ | `kali-core/kali_core/nest/store.py` | `test_nest.py` (8 tests) |
| Multi-session UI (Sidebar, attach, replay) | ✅ | `kali-web/src/components/Sidebar.tsx` | `test_server.py` |
| Planner (heuristic + LLM multi-step) | ✅ | `kali-core/kali_core/mind/planner.py` | `test_planner_memory.py` (5 tests) |
| Memory (sliding window + auto-summary) | ✅ | `kali-core/kali_core/nest/memory.py` | `test_planner_memory.py` (5 tests) |
| NanobotLLMProvider (WS protocol) | ✅ | `kali-core/kali_core/mind/llm/nanobot.py` | — |
| Reasoning panel end-to-end | ✅ | `runtime.py` → `server.py` → `useChat.ts` → `Message.tsx` | `test_server.py` (1 test) |
| Profile dev.json (con run_tests/git/launch) | ✅ | `kali-core/kali_core/collar/profiles/dev.json` | — |
| Profile general.json | ✅ | `kali-core/kali_core/collar/profiles/general.json` | — |
| Profile gaming.json (forward-decl) | ✅ | `kali-core/kali_core/collar/profiles/gaming.json` | — |
| Profile files.json (forward-decl) | ✅ | `kali-core/kali_core/collar/profiles/files.json` | — |
| Canvas helpers (html/markdown/diff/widget) | ✅ | `kali-core/kali_core/canvas/__init__.py` | — |
| Artifact renderers (Html/Markdown/Diff) | ✅ | `kali-web/src/components/artifacts/` | — |
| LICENSE (MIT) | ✅ | `LICENSE` | — |
| check-i18n.mjs (EN/ES parity) | ✅ | `scripts/check-i18n.mjs` | — |
| dev.sh (dev launcher) | ✅ | `scripts/dev.sh` | — |
| download-stt-models.sh | ✅ | `scripts/download-stt-models.sh` | — |
| download-voices.sh | ✅ | `scripts/download-voices.sh` | — |
| Docs (VISION, ARCHITECTURE, COMPONENTS, etc.) | ✅ | `docs/*.md` | — |
| `reasoning_delta` WS event type | ✅ | `kali_core/yarn/protocol.py`, `kali-web/src/lib/protocol.ts` | — |

### Fase 3 — Capture + render ✅ Completo

| Feature | Estado | Archivo(s) |
|---|---|---|
| Wayland ScreenCapture (xdg-desktop-portal) | ✅ | `kali-home/src/capture/wayland.rs` |
| ScreenCapture trait (Rust) | ✅ | `kali-home/src/capture/mod.rs` |
| `capture_full` Tauri command | ✅ | `kali-home/src/commands.rs` |
| `ipc.rs` WS bridge (Python ↔ Rust) | ✅ | `kali-home/src/ipc.rs` |
| GazeClient (Python WS client) | ✅ | `kali-core/kali_core/gaze/__init__.py` |
| `screenshot` tool | ✅ | `kali-core/kali_core/claws/screenshot.py` |
| `organize_folder` tool | ✅ | `kali-core/kali_core/claws/organize.py` |
| Vision processor (OCR + LLM multimodal) | ✅ | `kali-core/kali_core/mind/vision.py` |
| Canvas HTML/Markdown/Diff/Widget UI | ✅ | `kali-web/src/components/artifacts/` |
| Mermaid diagram rendering | ✅ | `kali-web/src/components/artifacts/MarkdownArtifact.tsx` |
| WidgetGrid activity cards | ✅ | `kali-web/src/components/artifacts/WidgetGrid.tsx` |

### Fase 4 — Gaming ⬜ En progreso

| Feature | Estado | Archivo(s) |
|---|---|---|
| `DotaBuildsTool` (OpenDota + scraping fallback) | ✅ | `kali-core/kali_core/claws/game/dota.py` |
| `GameInfoTool` (anti-spoiler) | ✅ | `kali-core/kali_core/claws/game/generic.py` + `spoiler_filter.py` |
| Visión LLM multimodal | ✅ | `kali-core/kali_core/mind/vision.py` (`_via_llm`) |
| Registro de game tools en server.py | ✅ | `kali-core/kali_core/server.py` |
| Gaming profile refinado (con screenshot) | ✅ | `kali-core/kali_core/collar/profiles/gaming.json` |
| DotaHeroCard widget | ✅ | `kali-web/src/components/artifacts/DotaHeroCard.tsx` |
| i18n keys para game tools | ✅ | `kali-web/src/locale/*/common.json` |

### Fase 5 — Voz avanzada + portabilidad ⬜ Pendiente

| Feature | Estado | Archivo(s) |
|---|---|---|
| Wake word detection | ✅ Implementado | `kali-core/kali_core/ear/manager.py` (`WakeWordDetector`) |
| Wake word UI (indicator + toggle) | ✅ | `kali-web/src/components/Header.tsx`, `SettingsModal.tsx` |
| Wake word mode en usePTT | ✅ | `kali-web/src/hooks/usePTT.ts` |
| Intra-segment PCM streaming | ⬜ | — |
| X11 capture backend | ⬜ | — |
| Windows capture backend | ⬜ | — |
| macOS capture backend | ⬜ | — |
| Packaging (AppImage/.deb) | ⬜ | — |

---

## 5. Inventario completo de features

### 5.1 Tools (kali-claws)

| Tool | Risk | Fase | Estado | Implementación | Tests |
|---|---|---|---|---|---|
| `fs_read` | safe | 1 | ✅ | `claws/fs.py` | ✅ |
| `fs_write` | sensitive | 1 | ✅ | `claws/fs.py` | ✅ |
| `fs_list` | safe | 1 | ✅ | `claws/fs.py` | ✅ |
| `run_command` | dangerous | 1 | ✅ | `claws/command.py` | ✅ |
| `run_tests` | sensitive | 2 | ✅ | `claws/tests.py` | ✅ |
| `git_worktree` | sensitive | 2 | ✅ | `claws/git.py` | ✅ |
| `git_diff` | safe | 2 | ✅ | `claws/git.py` | ✅ |
| `launch_app` | sensitive | 2 | ✅ | `claws/launcher.py` | ⚠️ negativo only |
| `web_search` | safe | 2 | ✅ | `claws/web.py` | ⚠️ registro only |
| `web_fetch` | safe | 2 | ✅ | `claws/web.py` | ⚠️ registro only |
| `screenshot` | sensitive | 3 | ✅ | `claws/screenshot.py` | ✅ |
| `organize_folder` | sensitive | 3 | ✅ | `claws/organize.py` | ✅ |
| `game_info` | safe | 4 | ✅ | `claws/game/generic.py` | ✅ |
| `game_dota_builds` | safe | 4 | ✅ | `claws/game/dota.py` | ✅ |

**Tools registrados en `server.py._register_tools()`:** 13 de 14
(`fs_read`, `fs_list`, `run_command`, `web_search`, `web_fetch`, `run_tests`,
`git_worktree`, `git_diff`, `launch_app`, `screenshot`, `organize_folder`,
`game_info`, `game_dota_builds`)

### 5.2 LLM Providers (kali-mind)

| Provider | Estado | Archivo | Descripción |
|---|---|---|---|
| `DirectLLMProvider` | ✅ | `mind/llm/direct.py` | OpenAI-compatible (Ollama, llama.cpp, OpenRouter, OpenAI). Streaming + function-calling. |
| `NanobotLLMProvider` | ✅ | `mind/llm/nanobot.py` | WS client para nanobot. Traduce delta/tool_call/reasoning/done a StreamEvents. |
| `LLMProvider` Protocol | ✅ | `mind/llm/provider.py` | Interfaz común. `StreamEvent` tagged union. |

### 5.3 Agent Runtime (kali-mind)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `AgentRuntime` | ✅ | `mind/runtime.py` | Loop principal: message → LLM → tools → respond. Multi-step (max 5). |
| `Planner` | ✅ | `mind/planner.py` | Heuristic simple/complex + LLM multi-step plans. |
| `Executor` | ✅ | `mind/executor.py` | Ejecuta tools via PermissionGateway + ConsentManager. |
| `Memory` | ✅ | `nest/memory.py` | Sliding window + auto-summarization. |

### 5.4 Voz (kali-voice + kali-ear)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `PiperEngine` | ✅ | `voice/engine.py` | Síntesis TTS in-process con Piper. |
| `TTSPipeline` | ✅ | `voice/pipeline.py` | filter → segment → synthesize → effects → stream. |
| `VoiceConfigManager` | ✅ | `voice/voice_config.py` | Carga/valida configs JSON por voz. |
| Audio effects (numpy) | ✅ | `voice/effects/__init__.py` | normal, whisper, robotic, radio, deep, processed. |
| `InProcTTSProvider` | ✅ | `voice/providers/inproc.py` | Piper + numpy effects. |
| `HTTPTTSProvider` | ✅ | `voice/providers/http.py` | Forward a TTS HTTP externo. |
| `StreamingSTT` | ✅ | `ear/vosk_engine.py` | Vosk streaming recognizer. |
| `STTManager` | ✅ | `ear/manager.py` | Session lifecycle + language hot-swap. |
| `WakeWordDetector` | ✅ | `ear/manager.py` | Keyword spotting con Vosk full-vocab. |

### 5.5 Permisos (kali-collar)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `PermissionGateway` | ✅ | `collar/gateway.py` | safe→allow, sensitive→profile check, dangerous→consent. |
| `ConsentManager` | ✅ | `collar/consent.py` | consent_request event + 60s timeout + future. |
| Profile `dev.json` | ✅ | `collar/profiles/dev.json` | fs, tests, git, launch + command whitelist. |
| Profile `general.json` | ✅ | `collar/profiles/general.json` | fs, web. |
| Profile `gaming.json` | ✅ | `collar/profiles/gaming.json` | web + game tools (forward-decl Phase 4). |
| Profile `files.json` | ✅ | `collar/profiles/files.json` | fs + organize_folder (forward-decl Phase 3). |

### 5.6 Sesiones (kali-nest)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `SessionStore` | ✅ | `nest/store.py` | SQLite async CRUD. create/list/add_message/get_messages. |
| `Memory` | ✅ | `nest/memory.py` | Working memory + long-term summaries. |

### 5.7 Frontend (kali-web)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `App.tsx` | ✅ | `src/App.tsx` | Root: layout, providers, state management. |
| `Header.tsx` | ✅ | `src/components/Header.tsx` | Status, profile, model, settings, language. |
| `Sidebar.tsx` | ✅ | `src/components/Sidebar.tsx` | Session list, new chat, attach. |
| `ChatPanel.tsx` | ✅ | `src/components/ChatPanel.tsx` | Message list, auto-scroll. |
| `Message.tsx` | ✅ | `src/components/Message.tsx` | Markdown render + reasoning panel + tool hints. |
| `InputBar.tsx` | ✅ | `src/components/InputBar.tsx` | Text input + send + PTT. |
| `PTTButton.tsx` | ✅ | `src/components/PTTButton.tsx` | Push-to-talk mic button. |
| `AudioVisualizer.tsx` | ✅ | `src/components/AudioVisualizer.tsx` | Canvas frequency bars during TTS. |
| `Canvas.tsx` | ✅ | `src/components/Canvas.tsx` | Artifact panel (tabs, collapsible). |
| `ConsentModal.tsx` | ✅ | `src/components/ConsentModal.tsx` | allow/no_capture/cancel + countdown. |
| `SettingsModal.tsx` | ✅ | `src/components/SettingsModal.tsx` | Voice, mode, model, STT, wake word, theme, profile. |
| `Modal.tsx` | ✅ | `src/components/ui/Modal.tsx` | Reusable modal (focus trap, scroll lock). |
| `Sheet.tsx` | ✅ | `src/components/ui/Sheet.tsx` | Reusable slide-in panel. |
| `HtmlArtifact.tsx` | ✅ | `src/components/artifacts/HtmlArtifact.tsx` | Sandboxed iframe. |
| `MarkdownArtifact.tsx` | ✅ | `src/components/artifacts/MarkdownArtifact.tsx` | Markdown + mermaid render. |
| `DiffArtifact.tsx` | ✅ | `src/components/artifacts/DiffArtifact.tsx` | Unified diff with syntax highlight. |
| `useChat.ts` | ✅ | `src/hooks/useChat.ts` | WS state, messages, sessions, artifacts, tools, consent. |
| `useTTS.ts` | ✅ | `src/hooks/useTTS.ts` | Audio playback + analyser. |
| `usePTT.ts` | ✅ | `src/hooks/usePTT.ts` | PTT/wake_word/continuous modes. |
| `useBreakpoint.ts` | ✅ | `src/hooks/useBreakpoint.ts` | Mobile/desktop/tablet detection. |
| `useMediaQuery.ts` | ✅ | `src/hooks/useMediaQuery.ts` | Generic matchMedia hook. |
| `useBodyScrollLock.ts` | ✅ | `src/hooks/useBodyScrollLock.ts` | Scroll lock for modals. |
| `useFocusTrap.ts` | ✅ | `src/hooks/useFocusTrap.ts` | Focus trap for modals. |
| `wsClient.ts` | ✅ | `src/lib/wsClient.ts` | Typed WS client + reconnect. |
| `protocol.ts` | ✅ | `src/lib/protocol.ts` | Event type definitions (mirror of Python). |
| `i18n.ts` | ✅ | `src/lib/i18n.ts` | i18next setup. |
| `WidgetGrid.tsx` | ✅ | `src/components/artifacts/WidgetGrid.tsx` | Activity cards con soporte widgetType. |
| `DotaHeroCard.tsx` | ✅ | `src/components/artifacts/DotaHeroCard.tsx` | Tarjeta de hero de Dota 2. |

### 5.8 Shell (kali-home)

| Componente | Estado | Archivo | Descripción |
|---|---|---|---|
| `main.rs` | ✅ | `kali-home/src/main.rs` | Tauri app entrypoint, plugins, commands. |
| `sidecar.rs` | ✅ | `kali-home/src/sidecar.rs` | Spawn + supervise python -m kali_core. |
| `commands.rs` | ✅ | `kali-home/src/commands.rs` | get_sidecar_port, capture_backend, capture_full, launch_app. |
| `build.rs` | ✅ | `kali-home/build.rs` | Tauri build script. |
| `tauri.conf.json` | ✅ | `kali-home/tauri.conf.json` | Window config, CSP, sidecar scope. |
| `ipc.rs` | ✅ | `kali-home/src/ipc.rs` | WS bridge Python ↔ Rust para captura de pantalla. |
| `capture/mod.rs` | ✅ | `kali-home/src/capture/mod.rs` | ScreenCapture trait + select_backend. |
| `capture/wayland.rs` | ✅ | `kali-home/src/capture/wayland.rs` | Wayland backend via xdg-desktop-portal. |
| `capture/x11.rs` | ⬜ | — | X11 backend (no existe, Fase 5). |

---

## 6. Módulos y archivos

### Estructura del repositorio

```
ai-voice-companion/
├── README.md
├── LICENSE                          ← MIT
├── .gitignore
├── docs/
│   ├── VISION.md                    ← Qué es Kali y por qué existe
│   ├── ARCHITECTURE.md              ← Modelo de 3 capas + data flow
│   ├── COMPONENTS.md                ← Spec de cada módulo
│   ├── GLOSSARY.md                  ← Nombres cat-themed
│   ├── PROTOCOL.md                  ← Catálogo de eventos WS
│   └── I18N.md                      ← Estrategia i18n
├── kali-home/                       ← Shell (Rust/Tauri)
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   ├── gen/schemas/
│   └── src/
│       ├── main.rs                  ← Entrypoint Tauri
│       ├── sidecar.rs                ← Supervisor del sidecar Python
│       ├── commands.rs               ← Tauri commands (port, capture, launch)
│       └── build.rs                  ← Build script
├── kali-web/                        ← Frontend (React/Vite/TS)
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css
│       ├── components/              ← 14 componentes .tsx
│       │   ├── Header.tsx
│       │   ├── Sidebar.tsx
│       │   ├── ChatPanel.tsx
│       │   ├── Message.tsx
│       │   ├── InputBar.tsx
│       │   ├── PTTButton.tsx
│       │   ├── AudioVisualizer.tsx
│       │   ├── Canvas.tsx
│       │   ├── ConsentModal.tsx
│       │   ├── SettingsModal.tsx
│       │   ├── ui/
│       │   │   ├── Modal.tsx
│       │   │   └── Sheet.tsx
│       │   └── artifacts/
│       │       ├── HtmlArtifact.tsx
│       │       ├── MarkdownArtifact.tsx
│       │       └── DiffArtifact.tsx
│       ├── hooks/                   ← 7 hooks
│       │   ├── useChat.ts
│       │   ├── useTTS.ts
│       │   ├── usePTT.ts
│       │   ├── useBreakpoint.ts
│       │   ├── useMediaQuery.ts
│       │   ├── useBodyScrollLock.ts
│       │   └── useFocusTrap.ts
│       ├── lib/
│       │   ├── wsClient.ts
│       │   ├── protocol.ts
│       │   └── i18n.ts
│       └── locale/
│           ├── en/common.json       ← 70 keys
│           └── es/common.json       ← 70 keys
├── kali-core/                       ← Sidecar (Python 3.12)
│   ├── pyproject.toml
│   └── kali_core/
│       ├── __init__.py
│       ├── __main__.py              ← CLI entrypoint
│       ├── server.py                ← FastAPI WS server (484 líneas)
│       ├── config.py                ← Settings typed
│       ├── voice/                   ← kali-voice (TTS)
│       │   ├── __init__.py
│       │   ├── engine.py            ← PiperEngine
│       │   ├── pipeline.py          ← TTSPipeline
│       │   ├── filter.py            ← filter_for_tts + segment_for_tts
│       │   ├── audio_utils.py       ← WAV↔numpy
│       │   ├── voice_config.py      ← VoiceConfigManager
│       │   ├── effects/
│       │   │   └── __init__.py       ← 6 efectos numpy
│       │   ├── providers/
│       │   │   ├── __init__.py
│       │   │   ├── base.py          ← TTSProvider Protocol
│       │   │   ├── inproc.py         ← InProcTTSProvider
│       │   │   └── http.py           ← HTTPTTSProvider
│       │   ├── voice_configs/       ← JSON configs por voz
│       │   └── voices/              ← Modelos .onnx (gitignored)
│       ├── ear/                     ← kali-ear (STT)
│       │   ├── __init__.py
│       │   ├── manager.py           ← STTManager + WakeWordDetector
│       │   ├── vosk_engine.py       ← StreamingSTT
│       │   └── models/              ← Modelos Vosk (gitignored)
│       ├── mind/                    ← kali-mind (agent)
│       │   ├── __init__.py
│       │   ├── runtime.py           ← AgentRuntime
│       │   ├── planner.py           ← Planner
│       │   ├── executor.py          ← Executor
│       │   └── llm/
│       │       ├── __init__.py
│       │       ├── provider.py      ← LLMProvider Protocol + StreamEvent
│       │       ├── direct.py        ← DirectLLMProvider
│       │       └── nanobot.py       ← NanobotLLMProvider
│       ├── claws/                   ← kali-claws (tools)
│       │   ├── __init__.py
│       │   ├── base.py              ← Tool Protocol + registry
│       │   ├── fs.py                ← fs_read, fs_write, fs_list
│       │   ├── command.py           ← run_command
│       │   ├── tests.py             ← run_tests
│       │   ├── git.py               ← git_worktree, git_diff
│       │   ├── web.py               ← web_search, web_fetch
│       │   ├── launcher.py          ← launch_app
│       │   ├── screenshot.py        ← Stub (Phase 3)
│       │   └── game/
│       │       ├── __init__.py
│       │       ├── dota.py          ← Stub (Phase 4)
│       │       └── generic.py       ← Stub (Phase 4)
│       ├── gaze/                    ← kali-gaze (capture client)
│       │   └── __init__.py          ← GazeClient stub (Phase 3)
│       ├── canvas/                  ← kali-canvas (artifact helpers)
│       │   └── __init__.py          ← html/markdown/diff/widget_artifact
│       ├── collar/                  ← kali-collar (permissions)
│       │   ├── __init__.py
│       │   ├── gateway.py           ← PermissionGateway
│       │   ├── consent.py           ← ConsentManager
│       │   └── profiles/
│       │       ├── dev.json
│       │       ├── general.json
│       │       ├── gaming.json
│       │       └── files.json
│       ├── nest/                    ← kali-nest (sessions + memory)
│       │   ├── __init__.py
│       │   ├── store.py            ← SessionStore (SQLite)
│       │   └── memory.py           ← Memory (sliding window + summaries)
│       └── yarn/                    ← kali-yarn (WS protocol)
│           ├── __init__.py
│           └── protocol.py        ← EventType + EventTypeOut
└── scripts/
    ├── dev.sh                       ← Dev launcher (venv + models + start)
    ├── check-i18n.mjs               ← EN/ES key parity check
    ├── download-stt-models.sh       ← Download Vosk models
    └── download-voices.sh          ← Download Piper voices
```

### Tests

```
kali-core/tests/
├── test_tools.py            ← 15 tests (fs, command, gateway, executor)
├── test_stt.py              ← 11 tests (STT manager, wake word)
├── test_planner_memory.py   ← 10 tests (Planner + Memory)
├── test_tts.py              ← 10 tests (filter, segment, effects, pipeline)
├── test_phase2_tools.py     ←  8 tests (run_tests, git, launch_app)
├── test_nest.py             ←  8 tests (SessionStore CRUD)
├── test_server.py           ←  5 tests (WS flow, attach, reasoning)
└── test_runtime.py          ←  1 test  (multi-step tool call loop)

Total: 68 test functions, todas pasando.
```

---

## 7. Protocolo WebSocket (kali-yarn)

### Eventos: web → core (10 tipos)

| Evento | Descripción | Fase |
|---|---|---|
| `hello` | Handshake inicial | 0 |
| `input` | Mensaje de usuario (text/voice) | 0 |
| `stop` | Cancelar generación | 0 |
| `new_session` | Crear nueva conversación | 2 |
| `attach_session` | Adjuntar a sesión existente | 2 |
| `list_sessions` | Solicitar lista de sesiones | 2 |
| `audio_start` | Iniciar grabación PTT | 0 |
| `audio_end` | Finalizar grabación PTT | 0 |
| `settings` | Actualizar configuración | 0 |
| `consent_response` | Responder a consent_request | 1 |

### Eventos: core → web (16 tipos)

| Evento | Descripción | Fase |
|---|---|---|
| `ready` | Respuesta a hello | 0 |
| `connected` | Sesión establecida | 0 |
| `delta` | Chunk de texto streaming | 0 |
| `reasoning_delta` | Chunk de razonamiento | 2 |
| `turn_end` | Turno terminado | 0 |
| `message` | Mensaje completo (replay) | 0 |
| `stt_partial` | Transcripción parcial | 0 |
| `stt_final` | Transcripción final | 0 |
| `wake_word` | Wake word detectada | 5 |
| `tts_audio` | Segmento de audio TTS (base64) | 0 |
| `tts_filtered` | Info de filtrado TTS | 0 |
| `artifact` | Canvas artifact (create/update/close) | 2 |
| `tool_event` | Tool started/progress/finished | 1 |
| `consent_request` | Pedir aprobación | 1 |
| `session_list` | Lista de sesiones | 2 |
| `error` | Error asíncrono | 0 |
| `status` | Status periódico | 0 |

### Endpoints HTTP

| Endpoint | Descripción |
|---|---|
| `GET /health` | Health check |
| `GET /voices` | Lista de voces TTS + modos |
| `GET /profiles` | Lista de profiles disponibles |

---

## 8. Pendientes y gaps

### Pendientes por fase

#### Fase 4 (en progreso, residual no crítico)

| Item | Prioridad | Descripción |
|---|---|---|
| Install tesseract-ocr + pytesseract | Baja | Opcional: mejora precisión de OCR. Script `scripts/install-vision-deps.sh` existente. |
| Tests de integración con web_search real | Baja | Los tests actuales mockean SearXNG. Sin test end-to-end. |
| `ruff check` pasando | Baja | Ejecutar ruff y corregir warnings si hay. |
| Avatar animado de Kali | Media | Rediseño del avatar central tomando como referencia el calico ilustrado compartido: cara expresiva, ojos verdes grandes, collar visible y silueta amable. Debe animarse por estado (`idle`, `sleep`, `listen`, `think`, `speak`, `look`, `judge`) con blink, eye-tracking, ear twitch, breathing, tail sway, mouth sync con TTS y glow reactivo. |

#### Fase 5 (parcialmente iniciada)

#### Fase 5 (parcialmente iniciada)

| Item | Prioridad | Descripción |
|---|---|---|
| ~~Wake word detection~~ | ✅ | Ya implementado (`WakeWordDetector`) |
| ~~Wake word UI~~ | ✅ | Ya implementado (Header + Settings) |
| ~~Wake word mode en usePTT~~ | ✅ | Ya implementado |
| Intra-segment PCM streaming | Baja | Streaming PCM dentro de un segmento Piper |
| X11 capture backend | Baja | `capture/x11.rs` |
| Windows capture backend | Baja | Graphics Capture API |
| macOS capture backend | Baja | ScreenCaptureKit |
| Packaging (AppImage/.deb) | Media | `tauri build` + pyinstaller |

### Gaps de tests (menores, no bloqueantes)

| Item | Descripción |
|---|---|
| `web_search` | Sin test conductual (solo assert de registro). Falta mock SearXNG. |
| `web_fetch` | Sin test conductual (solo assert de registro). Falta mock httpx. |
| `launch_app` | Solo test negativo (not found). Sin test positivo de launch. |
| `download-voices.sh` | Solo imprime instrucciones, no descarga automáticamente (a diferencia de STT) |

---

## 9. Métricas actuales

### Código

| Métrica | Valor |
|---|---|
| Archivos Python (kali_core) | ~38 |
| Archivos TypeScript/TSX (kali-web) | ~25 |
| Archivos Rust (kali-home) | 6 (+ build.rs) |
| Archivos de test | 10 |
| Funciones de test | 109 |
| Componentes React | 15 |
| Hooks React | 7 |
| Tools implementadas | 13 (de 14 planeadas) |
| Tools registradas en server | 13 |
| Profiles | 4 |
| Eventos WS (in/out) | 11 + 17 = 28 |
| Locales i18n | 2 (en, es) con 77 keys cada uno |
| Themes | 4 (synthwave, midnight, sunset, forest) |
| Voces TTS | 1 default (robot-es) + configurables |
| Modelos STT | 2 (es-0.42, en-us-0.15) |
| LLM providers | 2 (Direct, Nanobot) |
| Efectos de audio | 6 (normal, whisper, robotic, radio, deep, processed) |

### Verificación

| Check | Estado |
|---|---|
| `pytest tests/` | ✅ 109/112 passed (3 pre-existentes websockets) |
| `tsc --noEmit` | ✅ 0 errors |
| `node scripts/check-i18n.mjs` | ✅ i18n check passed |
| `cargo check` | ✅ (kali-home compila) |

### Resumen de completitud por fase

```
Fase 0: ████████████████████ 100% ✅
Fase 1: ████████████████████ 100% ✅
Fase 2: ████████████████████ 100% ✅
Fase 3: ████████████████████ 100% ✅
Fase 4: ████████████████░░░░  80% ⬜ (game tools implementados, falta instalación OCR y polish)
Fase 5: ██████░░░░░░░░░░░░░░  30% ⬜ (wake word hecho, resto pendiente)
```
