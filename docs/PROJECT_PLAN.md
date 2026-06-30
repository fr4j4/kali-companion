# Kali — AI Voice Companion: Project Plan

> Cat-themed, always-on desktop companion that lives on your second monitor.
> Voice and text as equals. Local-first. Not just a chatbot — a presence
> that researches, renders, and acts on your behalf.

---

## Table of Contents

1. [Vision](#1-vision)
2. [Architecture](#2-architecture)
3. [Roadmap by Phase](#3-roadmap-by-phase)
4. [Current Status by Phase](#4-current-status-by-phase)
5. [Feature Inventory](#5-feature-inventory)
6. [Modules and Files](#6-modules-and-files)
7. [WebSocket Protocol (kali-yarn)](#7-websocket-protocol-kali-yarn)
8. [Pending and Gaps](#8-pending-and-gaps)
9. [Current Metrics](#9-current-metrics)

---

## 1. Vision

Kali is an open-source AI assistant designed to live fullscreen on a second monitor,
always present while you code, game, or work.

**Design Pillars:**

- **Always present, never intrusive** — waits for you to call.
- **Capable, not just conversational** — executes real actions (tests, worktrees, apps).
- **Voice and text as equals** — neither is a second-class citizen.
- **Render, don't just reply** — mockups, documents, diffs, widgets.
- **Local-first and private** — offline STT, local TTS, configurable LLM.
- **Explicit consent** — every sensitive action requires approval.

---

## 2. Architecture

### Three-Layer Model

| Layer | Directory | Language | Responsibility |
|---|---|---|---|
| Shell | `kali-shell/` | TypeScript (Electron) | Native window, system tray, frontend host, sidecar supervisor |
| Frontend | `kali-web/` | TypeScript (React + Vite) | UI: stage, workspace, widgets, consent, settings, voice input |
| Core | `kali-core/` | Python 3.12 (asyncio) | Agent runtime, tools, TTS, STT, permissions, sessions |

### Tech Stack

| Layer | Tech | Reason |
|---|---|---|
| Shell | Electron + TypeScript | Multiplatform, mature, native tray support |
| Frontend | React + Vite + TypeScript | Canvas ecosystem, i18n support |
| Core | Python 3.12 + asyncio | Readable, reuses existing AI libraries |
| Protocol | Local WebSocket (JSON) | Low latency, documented contract |
| STT | Vosk (offline) | Offline, supports multiple languages |
| TTS | Piper + Qwen3-TTS + HTTP | Local, high quality, modular |
| LLM | OpenAI-compatible + nanobot | Flexible, works with Ollama/Cloud |
| Capture | mss (Python) | Automatic platform detection (Wayland/X11/Win) |

---

## 3. Roadmap by Phase

| Phase | Scope | Status |
|---|---|---|
| **0 — Foundations** | Electron shell, WS, STT/TTS, DirectLLMProvider, base frontend | ✅ Complete |
| **1 — Agent + Tools** | AgentRuntime, `fs_*`, `run_command`, PermissionGateway, consent UI, themes, profiles | ✅ Complete |
| **2 — Dev Cases** | `run_tests`, `git_*`, `launch_app`, `web_search`, `web_fetch`, multi-session, Planner, Memory | ✅ Complete |
| **3 — Capture + Render** | ScreenCapture, `screenshot` tool, Canvas artifacts, vision provider, `organize_folder` | ✅ Complete |
| **4 — Gaming** | Dota builds, anti-spoiler info, per-game widgets, refined profile, LLM vision | ✅ Complete |
| **5 — Advanced Voice** | Wake word, intra-segment PCM, multi-platform capture, packaging | ⬜ In Progress |

---

## 4. Current Status by Phase

### Phase 4 — Gaming ✅ Complete

| Feature | Status | File(s) |
|---|---|---|
| `DotaBuildsTool` (OpenDota + scraping) | ✅ | `claws/game/dota.py` |
| `DotaLiveTool` (live match data) | ✅ | `claws/game/dota_live.py` |
| `GameInfoTool` (anti-spoiler) | ✅ | `claws/game/generic.py` |
| Multimodal LLM Vision | ✅ | `mind/vision.py` |
| Game widgets (HeroCard, Image, etc.) | ✅ | `src/components/artifacts/Game*.tsx` |

### Phase 5 — Advanced Voice ⬜ In Progress

| Feature | Status | File(s) |
|---|---|---|
| Wake word detection | ✅ | `ear/manager.py` |
| Wake word UI | ✅ | `src/components/Header.tsx` |
| Intra-segment PCM streaming | ⬜ | — |
| Windows/macOS capture backends | ⬜ | — |
| Packaging (AppImage/.deb) | ⬜ | — |

---

## 9. Current Metrics

### Code

| Metric | Value |
|---|---|
| Python files (kali_core) | ~50+ |
| TypeScript/TSX files (kali-web) | ~60+ |
| Test files | 23 |
| **Test functions** | **299** |
| React components (stage) | 18 |
| React components (widgets) | 25+ |
| Implemented tools | 18+ |
| WS Event types | 45 |
| Languages | 2 (en, es) |
| Themes | 5 |

### Summary of Completion

```
Phase 0: ████████████████████ 100% ✅
Phase 1: ████████████████████ 100% ✅
Phase 2: ████████████████████ 100% ✅
Phase 3: ████████████████████ 100% ✅
Phase 4: ████████████████████ 100% ✅
Phase 5: ██████░░░░░░░░░░░░░░  30% ⬜
```
