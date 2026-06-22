# Kali — AI Companion: Vision

> A cat-themed, always-on desktop companion that lives on your second monitor.
> Not a chatbot. A presence that researches, renders, and acts on your behalf.

## What is Kali?

Kali is an open-source AI assistant designed to live fullscreen on a second
monitor (or a dedicated device), always present while you code, game, or work.
It speaks and listens with parity — voice and text are first-class equals — and
goes far beyond answering questions: it can run tests, create git worktrees in
parallel, launch applications, organize your folders, research topics on the
web, render mockups and documents, and even look at your screen when you allow
it to.

The project is named after **Kali**, the cat. Every module carries a cat-themed
name to give the project personality and to make each subsystem independently
identifiable — so that any of them can grow into its own project in the future.

## Vision statement

Build a companion that feels like a cat sitting beside you on the desk:

- **Always present, never intrusive.** It does not interrupt your flow; it
  waits for you to call, and it watches (only when you allow it to).
- **Capable, not just conversational.** It executes real actions on your
  system — runs tests, creates worktrees, launches apps, organizes files —
  always with explicit consent for anything sensitive.
- **Voice and text as equals.** Neither is a second-class citizen. You can
  talk to it while your hands are busy, or type when you need precision.
- **Render, don't just reply.** It can produce and display mockups, documents,
  diffs, and live activity widgets — content, not just chat bubbles.
- **Local-first and private.** Speech recognition runs offline. The TTS engine
  is local. Your data does not leave your machine unless you choose a cloud
  LLM provider.

## Mission

Construct an open-source, modular, and portable companion (Linux/Wayland first,
X11/Windows/macOS later) that:

1. Lives fullscreen on a second monitor as its primary interface, with
   activity widgets and a content canvas alongside the conversation.
2. Powers an agent capable of planning, using tools, and executing real
   actions, governed by a profile-based permission system with per-action
   approval.
3. Treats voice and text as equivalent input channels.
4. Works with or without [nanobot](https://github.com/fr4j4/nanobot): a
   self-contained agent runtime is included, and nanobot can be used as an
   optional LLM/tool provider for those who already run it.
5. Is readable and modifiable for people learning AI and Rust: the agent
   logic lives in Python (easy to iterate on), while the native shell is
   minimal Rust, heavily commented.

## Design principles

1. **Modularity first.** Every capability is a module with a defined
   interface. Any module can be replaced without touching the rest.
2. **Explicit consent.** Every sensitive action announces itself, explains
   why, and offers three choices: allow, allow-without-capture, or cancel.
3. **Voice/text parity.** No feature is designed for only one channel.
4. **Platform abstraction.** Screen capture, command execution, and file
   access go through traits with per-OS/display-server backends.
5. **Learnable.** Python carries the agent logic (sidecar), Rust is minimal
   and commented for the shell. Documentation lives per module.
6. **Local-first by default.** STT offline, TTS local. The LLM is configurable
   (local or cloud).
7. **No heavy mandatory dependencies.** TTS effects use numpy (no ffmpeg
   required). ffmpeg is optional, used only when available.

## Target use cases

### Development
- **Run tests:** ask Kali to run a project's test suite and report results.
- **Parallel worktree:** create a git worktree, implement a feature in
  parallel, and leave the branch ready for you to review and merge locally.
- **Contextual assistance:** answer questions about the project currently in
  focus, using the actual code on disk.

### Gaming
- **Dota 2:** real-time build and strategy recommendations, coordination
  with teammates.
- **Other games:** game data, orientation when lost — strictly without
  spoilers, via a dedicated "no-spoiler" prompt mode.

### Files and organization
- **Organize a folder:** hand Kali a directory and have it propose (and, with
  approval, execute) a reorganization structure.

### General assistance
- Research topics and deliver rendered summaries or documents.
- Render website mockups (Gemini-Canvas style).
- Draft and render documents.
- Launch applications and run system commands.

## Non-goals (for now)

- Mobile app. Kali is a desktop companion.
- Always-listening, ambient surveillance. Screen capture is on-demand only,
  with per-task consent.
- Cloud-only operation. Local-first is a hard requirement; the cloud is an
  optional accelerator for the LLM.

## Open questions

See [COMPONENTS.md](./COMPONENTS.md#9-open-questions) for technical decisions
that remain to be settled before implementation proceeds past Phase 0.