# Kali — AI Companion: The Vision

> A cat-themed, always-on desktop companion that lives on your second monitor.
> Not a chatbot. A presence that researches, renders, and acts on your behalf.

## 🐱 Why "Kali"?

Kali is named after my cat. She is a calico — tricolor (black, orange, white),
a pattern that appears almost exclusively in females. Her name comes from
Kālī (काली), the Hindu goddess of time and change, partly because "calico"
sounds like "Kali-ko" and partly because the name carries weight.

The app inherits the name, and the feline theme runs through every module:
kali-mind, kali-claws, kali-ear, kali-gaze, kali-whiskers… It gives the
project personality and makes each subsystem independently identifiable —
so any of them can grow into its own open-source project later with zero
rename cost.

The cat is also a metaphor for how the app behaves:

- **A cat sits beside you without demanding attention.** Kali lives on your
  second monitor, always present, never intrusive. It does not interrupt
  your flow — it waits for you to call.
- **A cat watches everything you do.** Kali can see your screen, but only
  when you explicitly allow it. Observant by nature, never by stealth.
- **A cat occasionally reaches out a paw.** Kali waits for your command,
  then acts. And when it does something sensitive, it asks for permission
  first — like a cat that taps your arm before settling on your keyboard.
- **A cat purrs, meows, flicks its tail.** Kali responds with voice (local
  TTS), shows its state through visual presence, and renders content on its
  canvas — it communicates in more ways than text.

## ⚡ What makes Kali different

Kali is not trying to replace ChatGPT, Copilot, or Siri. It addresses a
different use case — check the trade-offs:

| | ChatGPT / Claude | GitHub Copilot | Siri / Alexa | **Kali** |
|---|---|---|---|---|
| **Where it lives** | Browser tab | Inside the editor | Phone / speaker | Second monitor, always visible |
| **What it does** | Converses | Completes code | Simple tasks (timer, weather) | Executes: tests, git, apps, file organization, screen capture |
| **Voice** | Input only (app) | None | Native but limited | Full parity: offline STT + local TTS |
| **Privacy** | Cloud (your data leaves your machine) | Cloud | Cloud | Local-first: STT/TTS offline, LLM configurable (local or cloud) |
| **Permissions** | Blind trust | Blind trust | Blind trust | Profile-based + per-action consent (allow / no-capture / cancel) |
| **Renders** | Text | Inline suggestions | Text only | Visual artifacts: HTML, diagrams, diffs, widgets, charts |
| **Open source** | No | Partial | No | Yes (MIT) |

Every row is a design choice, not a competition. Kali needs a second monitor
and Python 3.12 — ChatGPT works in any browser. Kali's STT runs offline —
Siri needs a network. The point is not "better", it's **different**: built
for a specific kind of use.

## 🎯 Who this is for

**Developers** who want an assistant that touches real code — runs test
suites, creates git worktrees in parallel, reads your project structure,
launches apps, and researches documentation while you keep your hands on
the keyboard.

**Gamers** who want in-match assistance (Dota 2 builds, live match data)
and game info searches that are strictly spoiler-free — a dedicated
no-spoiler prompt mode filters out plot reveals.

**AI learners** who want to read and modify the agent's code. The agent
logic lives in Python, the shell is minimal TypeScript. The LLM provider is
a ~60-line interface. You can swap models, change prompts, and add tools
without touching the frontend.

## 🧭 Design north stars

These are the principles that guide every decision in Kali. They are not
marketing — they are constraints we actually enforce in code.

**Always present, never intrusive.**
Kali lives on a second monitor full-time. It does not pop up, ping, or
demand attention. It waits for you to initiate. The stage (avatar + HUD)
shows its state at a glance — thinking, listening, speaking, idle.

**Capable, not just conversational.**
Kali executes real actions on your system: runs test suites, creates git
worktrees, launches applications, organizes folders, captures screenshots.
Every action goes through a permission gateway that checks the active
profile and requests consent when needed.

**Voice and text as equals.**
Neither channel is a second-class citizen. You can talk to Kali while your
hands are busy, or type when you need precision. The same agent loop
processes both — voice is transcribed by offline Vosk, text is read from
the input bar. The response comes back as text (streamed) and as speech
(synthesized by local Piper or Qwen3-TTS).

**Render, don't just reply.**
Kali can produce and display HTML mockups, documents, diagrams (Mermaid),
diffs, charts, quizzes, tables, checklists, and live activity widgets —
all as draggable windows on a canvas. The user watches content being
written live during streaming. This is not a chatbot bubble — it's a
visual workspace.

**Local-first and private.**
Speech recognition runs offline (Vosk). Text-to-speech runs locally (Piper
in-process, or optional Qwen3-TTS C++ server). The LLM is configurable:
local (Ollama, llama.cpp) or cloud (OpenAI, OpenRouter). Your data stays
on your machine unless you deliberately choose a cloud provider. No
telemetry, no accounts, no data collection.

**Explicit consent for every sensitive action.**
Tools declare a risk level (safe / sensitive / dangerous). The permission
gateway checks the active profile. If an action is not whitelisted, Kali
asks — and the user can allow, allow-without-capture, or cancel. Consent
reasons are i18n keys, so the user always sees them in their UI language.

## 🚫 What Kali is not (yet)

- **A mobile app.** Kali is a desktop companion for a second monitor or
  dedicated device. Voice/text parity and local-first operation make it
  technically feasible, but the UI is not designed for small screens.
- **Always-listening ambient surveillance.** Screen capture is on-demand
  only, with per-task consent. Wake word detection exists but is opt-in.
  Kali does not record or stream audio without explicit PTT or wake word.
- **Cloud-only.** Local-first is a hard requirement. Cloud LLMs are an
  optional accelerator, not the default.
- **A finished product.** This is an open-source project under active
  development. Phases 1–4 are complete (agent, tools, capture, gaming).
  Phase 5 (advanced voice, packaging, multi-platform capture) is in
  progress. APIs and architectures may change before 1.0.
