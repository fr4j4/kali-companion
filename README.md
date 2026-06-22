# Kali — AI Companion

A cat-themed, always-on desktop companion that lives on your second
monitor. Not a chatbot — a presence that researches, renders, and acts on
your behalf. Voice and text are first-class equals. Local-first by default.

> Status: **Phase 3 — complete.** Screen capture via Wayland portal,
> vision provider (LLM multimodal + OCR), organize_folder, WidgetGrid,
> Mermaid diagram rendering. **Phase 4 (gaming) — in progress.** Dota 2
> builds via OpenDota API, anti-spoiler game info search, DotaHeroCard
> widget, gaming profile.

## What Kali does

- Sits fullscreen on a second monitor (or a dedicated device), always
  present while you code, game, or work.
- Listens and speaks with parity: talk to it while your hands are busy, or
  type when you need precision.
- Goes beyond conversation: runs tests, creates git worktrees in parallel,
  launches apps, organizes folders, researches the web, renders mockups and
  documents, and looks at your screen — only when you allow it.
- Works with or without [nanobot](https://github.com/fr4j4/nanobot): a
  self-contained agent runtime is included, and nanobot is an optional LLM
  provider for those who already run it.
- Local-first: offline speech recognition (Vosk), local TTS (Piper + numpy
  effects, no ffmpeg required). The LLM is configurable (local or cloud).
- Internationalized from day one: English and Spanish, with room for more.

## Project name

Kali is named after the cat. Every module carries a cat-themed name to give
the project personality and to make each subsystem independently
identifiable — so that any of them can grow into its own project later with
zero rename cost. See [docs/GLOSSARY.md](docs/GLOSSARY.md) for the full
naming scheme.

## Repository layout

```
kali/
├── docs/                ← start here
│   ├── VISION.md
│   ├── ARCHITECTURE.md
│   ├── COMPONENTS.md
│   ├── GLOSSARY.md
│   ├── I18N.md
│   └── PROTOCOL.md
├── kali-home/           ← Tauri/Rust shell (the cat's home)
├── kali-web/            ← React + Vite frontend (the cat's face)
├── kali-core/           ← Python sidecar (the cat's body)
│   └── kali_core/
│       ├── voice/       ← kali-voice (TTS)
│       ├── ear/         ← kali-ear (STT)
│       ├── mind/        ← kali-mind (agent + LLM providers)
│       ├── claws/       ← kali-claws (tools)
│       ├── gaze/        ← kali-gaze client
│       ├── canvas/      ← kali-canvas artifact spec
│       ├── collar/      ← kali-collar (permissions)
│       ├── nest/        ← kali-nest (sessions + memory)
│       └── yarn/        ← kali-yarn (WS protocol)
└── scripts/
```

## Documentation

Read these in order:

1. [docs/VISION.md](docs/VISION.md) — what Kali is and why it exists.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the three-layer model and
   data flow.
3. [docs/COMPONENTS.md](docs/COMPONENTS.md) — every module, its interface,
   and its origin.
4. [docs/GLOSSARY.md](docs/GLOSSARY.md) — the cat-themed naming scheme.
5. [docs/PROTOCOL.md](docs/PROTOCOL.md) — the WebSocket event contract.
6. [docs/I18N.md](docs/I18N.md) — the internationalization strategy.

## Roadmap

| Phase | Scope | Delivers |
|---|---|---|
| **0 — Cimientos** | Tauri shell launches sidecar, WS, port STT/TTS/robot-es, frontend dashboard, DirectLLMProvider | A working companion = today's behavior on a better shell |
| **1 — Agente + tools básicas** | AgentRuntime single-step, tools `fs_*`, `run_command`, PermissionGateway with dev profile, consent modal UI, activity widgets, themes, profile switcher, syntax highlighting | ✅ Complete |
| **2 — Dev use cases** | `run_tests`, `git_worktree`, `git_diff`, `launch_app`, `web_search`, `web_fetch`, multi-session, gaming/files profiles | "Ask it to run tests / create a worktree" |
| **3 — Capture + render** | Wayland ScreenCapture, screenshot tool, Canvas artifacts (HTML/markdown/diff), vision provider, `organize_folder` | "Have it see my screen and render a mockup" |
| **4 — Gaming** | Dota builds, no-spoiler game info, per-game widgets, refined gaming profile | "In-match assistance" |
| **5 — Voz avanzada + portabilidad** | Wake word, intra-segment PCM streaming (optional), X11/Windows/macOS capture backends, packaging (AppImage/.deb) | Polished open-source release |

## Tech stack

| Layer | Tech | Why |
|---|---|---|
| Shell | Tauri 2 + Rust | Lightweight, modular, open source, multiplatform |
| Frontend | React + Vite + TypeScript | Canvas ecosystem, i18n ecosystem |
| Core | Python 3.12 + asyncio | Readable for someone learning AI; reuses existing code |
| Protocol | Local WebSocket | Same pattern as the legacy prototype |
| STT | Vosk (offline) | Already working in the prototype |
| TTS | Piper in-process + numpy effects | Local, no ffmpeg required |
| TTS external (optional) | Any HTTP TTS via config | For users who already run lapis-tts |
| LLM | OpenAI-compatible + nanobot | Flexible |
| Capture | xdg-desktop-portal (Wayland) | Standard, no root |
| Tools | subprocess + whitelist | Auditable |
| Permissions | JSON profiles + consent | Declarative |
| i18n | react-i18next | Standard, browser-friendly |
| Build | `tauri build` + `pyinstaller` | Open-source packaging |

## License

MIT. See `LICENSE`.

## Status

This is a personal project with open-source intent. Phase 1 is complete
(text + voice I/O, agent with tools, permissions + consent, themes, profile
switcher, syntax highlighting). Phase 2 is complete (dev tools, web tools,
multi-session, Planner, Memory, NanobotLLMProvider, reasoning panel).
Phase 3 (capture + render) is pending. Contributions are not yet open while the
core shapes stabilize, but issues and discussions are welcome once the
repo goes public.