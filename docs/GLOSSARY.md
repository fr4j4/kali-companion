# Kali — Glossary

Kali is named after the cat. Every module carries a cat-themed name to give
the project personality and to make each subsystem independently
identifiable — so that any of them can grow into its own project later with
zero rename cost.

This document is the single source of truth for module names. If you write
code, docs, or issues, use these names exactly.

## Module names

| Name | Metaphor | Layer | Role |
|---|---|---|---|
| **kali-home** | The cat's home | Shell (Rust / Tauri) | Native window, system access, spawns and supervises the sidecar. |
| **kali-web** | The cat's face | Frontend (React + Vite) | UI rendered in the webview: dashboard, chat, widgets, canvas. |
| **kali-core** | The cat's body | Orchestration (Python) | The sidecar that ties every module together. |
| **kali-voice** | The cat's voice | TTS (Python, in kali-core) | Text → audio. Piper in-process, numpy effects, `robot-es` default. |
| **kali-ear** | The cat's ears | STT (Python, in kali-core) | Voice → text. Vosk offline, multi-language, optional wake word. |
| **kali-mind** | The cat's mind | Agent runtime (Python, in kali-core) | Plans, decides, iterates. Houses LLM providers. |
| **kali-claws** | The cat's claws | Tools (Python, in kali-core) | Actions that touch the world: fs, commands, tests, git, web, launch. |
| **kali-gaze** | The cat's gaze | Screen capture (Rust in kali-home, client in kali-core) | Looks at the screen, with consent. |
| **kali-canvas** | The cat's canvas | Render / artifacts (spec in kali-core, UI in kali-web) | Renders mockups, documents, diffs, widgets. |
| **kali-collar** | The cat's collar | Permissions & consent (Python, in kali-core) | Profile-based allow-lists + per-action approval. |
| **kali-nest** | The cat's nest | Sessions & memory (Python, in kali-core) | Stores conversations and memory. |
| **kali-yarn** | The cat's yarn ball | IO protocol (Python, in kali-core) | The WebSocket event contract between web and core. |

## How to use these names

- **Folder names.** Inside `kali-core/kali_core/`, modules live in folders
  with their cat-themed name (e.g. `voice/`, `ear/`, `mind/`). kali-home and
  kali-web are top-level directories.
- **Import paths.** `from kali_core.voice import PiperEngine`,
  `from kali_core.mind import AgentRuntime`, etc.
- **Docs and issues.** Use the cat-themed name, not a generic one. Write
  "kali-claws" rather than "the tools module".
- **Future split.** If a module matures, the folder name is already a valid
  project name. Spinning it out is a `git filter-repo` away, no rename.

## Why cat-themed?

Two reasons, in order of importance:

1. **Portability.** Each name is a future standalone project name. Naming
   them now means a later split costs nothing.
2. **Identity.** A project named after a cat deserves cat-themed
   subsystems. It makes the codebase memorable, gives contributors a shared
   vocabulary, and makes the project feel like a coherent thing rather than
   a pile of modules.

## What is *not* cat-themed

These are internals that do not get their own cat name, because they do not
make sense on their own:

- LLM providers (`direct`, `nanobot`) — implementations of `kali-mind`'s
  `LLMProvider` interface.
- Planner, executor, formatter — submodules of `kali-mind`.
- Consent manager — part of `kali-collar`.
- Config — internal to `kali-core`.
- Rust capture backends — implementations of `kali-gaze`'s trait.

If a future internal grows into something reusable on its own, it earns a
cat name at that point. Naming is cheap; renaming is expensive.