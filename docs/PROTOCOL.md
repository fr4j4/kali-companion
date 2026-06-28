# Kali — Protocol (kali-yarn)

The WebSocket protocol between **kali-web** (frontend) and **kali-core**
(Python sidecar). All events are JSON text frames, except audio chunks which
are binary frames.

This is the contract both sides develop against. The Python host lives in
`kali_core/yarn/`.

## Framing

- **Text frames:** JSON objects with an `event` field.
- **Binary frames:** raw 16 kHz 16-bit mono PCM audio from the browser mic.

Every text event has:

| Field | Type | Notes |
|---|---|---|
| `event` | string | Event type. |
| `id` | string? | Optional correlation id for requests. |
| `session_id` | string? | Session the event belongs to, when relevant. |

## Events: web → core

### `hello`

First message after the WS connects. The core responds with `ready`.

```json
{ "event": "hello", "client": "kali-web", "version": "0.1.0" }
```

### `input`

A user message, either text or transcribed voice.

```json
{
  "event": "input",
  "session_id": "sess_abc",
  "content": "Run the tests in this project",
  "source": "text"
}
```

`source` ∈ `{"text", "voice"}`. The core treats both identically.

### `stop`

Cancel the current generation.

```json
{ "event": "stop", "session_id": "sess_abc" }
```

### `new_session`

Start a new conversation.

```json
{ "event": "new_session" }
```

### `attach_session`

Resume an existing session by id.

```json
{ "event": "attach_session", "session_id": "sess_abc" }
```

### `list_sessions`

Request the session list. Core replies with `session_list`.

```json
{ "event": "list_sessions" }
```

### `audio_start`

Begin a push-to-talk recording session. The core initializes kali-ear.

```json
{ "event": "audio_start" }
```

### `audio_chunk` (binary)

Raw PCM bytes (16 kHz, 16-bit signed, mono, little-endian). Sent as binary
WS frames. No JSON wrapper.

### `audio_end`

End the recording. The core finalizes kali-ear and emits `stt_final`.

```json
{ "event": "audio_end" }
```

### `settings`

Update user settings.

```json
{
  "event": "settings",
  "voice": "robot-es",
  "tts_mode": "robotic",
  "auto_tts": true,
  "llm_model": "glm-5.1",
  "profile": "dev",
  "language": "es"
}
```

All fields optional; only present fields are applied.

### `consent_response`

Reply to a `consent_request` from the core.

```json
{
  "event": "consent_response",
  "id": "req_abc",
  "decision": "allow"
}
```

`decision` ∈ `{"allow", "no_capture", "cancel"}`.

### `console_request`

Backend → frontend: the agent requests the runtime console logs of an
HTML/renderer artifact. The frontend responds with `console_response`.

```json
{
  "event": "console_request",
  "id": "console_abc123",
  "artifact_id": "art_xyz",
  "limit": 200
}
```

`id` is a unique request identifier (the frontend echoes it back in the
response). `artifact_id` is the artifact whose console logs to retrieve.
`limit` caps the number of most recent log entries to return (max 500).

### `console_response`

Frontend → backend: reply to a `console_request`. The frontend reads the
current console logs from the open HtmlWidget (if any) and sends them back.
If no widget is open for the given `artifact_id`, `logs` is `null`.

```json
{
  "event": "console_response",
  "id": "console_abc123",
  "logs": [
    { "level": "error", "message": "Uncaught TypeError: ...", "timestamp": 1719000000000 },
    { "level": "log", "message": "App initialized", "timestamp": 1719000001000 }
  ]
}
```

`level` ∈ `{"log", "warn", "error", "info", "debug"}`. `timestamp` is
`Date.now()` at the moment the log was captured. The backend awaits the
response with a 5-second timeout; if the frontend does not respond in time
or the artifact is not rendered, `logs` is `null`.

### `capture_request` (via Tauri command, not WS)

Screen capture is done by asking kali-home directly via a Tauri command
(`kali_capture_screen`), not through this WS protocol. kali-core's
`gaze/client.py` invokes it through the same WS bridge by sending a
`system_command` event that kali-home intercepts. See `system_command`
below.

### `system_command`

A request that kali-home should handle (it requires OS access the core
does not have). The core is the one that sends these when a tool needs them;
the web side does not initiate them.

```json
{
  "event": "system_command",
  "id": "cmd_001",
  "command": "capture_screen",
  "params": { "target": "full" }
}
```

kali-home performs the action and returns the result via `system_result`.

## Events: core → web

### `ready`

Sent in response to `hello`. Indicates the core is ready to accept input.

```json
{ "event": "ready", "session_id": "sess_abc", "version": "0.1.0" }
```

### `connected`

Session established (after `new_session` or `attach_session`).

```json
{ "event": "connected", "session_id": "sess_abc" }
```

### `delta`

Streaming text chunk from the agent.

```json
{ "event": "delta", "session_id": "sess_abc", "text": "Runni" }
```

### `reasoning_delta`

Streaming reasoning text (shown in the collapsible reasoning panel).

```json
{ "event": "reasoning_delta", "session_id": "sess_abc", "text": "The user wants…" }
```

### `turn_end`

The agent's turn finished.

```json
{ "event": "turn_end", "session_id": "sess_abc" }
```

### `message`

A complete (non-streamed) message.

```json
{ "event": "message", "session_id": "sess_abc", "role": "assistant", "text": "Done." }
```

### `stt_partial`

Partial transcription while the user is speaking.

```json
{ "event": "stt_partial", "text": "corre los test" }
```

### `stt_final`

Final transcription.

```json
{ "event": "stt_final", "text": "corre los tests por favor" }
```

### `tts_audio`

A synthesized audio segment, base64-encoded WAV.

```json
{
  "event": "tts_audio",
  "audio": "<base64>",
  "segment": 0,
  "total_segments": 3,
  "text": "Corriendo los tests…",
  "duration": 1.8
}
```

### `tts_filtered`

Notifies the UI about TTS filtering (raw vs. spoken text length).

```json
{
  "event": "tts_filtered",
  "raw_length": 240,
  "filtered_length": 90,
  "filtered_text": "Corriendo los tests…"
}
```

### `artifact`

A canvas artifact create/update/close.

```json
{
  "event": "artifact",
  "id": "art_001",
  "type": "html",
  "title": "Site mockup",
  "content": "<html>…</html>",
  "update": "create"
}
```

`type` ∈ `{"html", "markdown", "diff", "widget"}`.
`update` ∈ `{"create", "update", "close"}`.
`content` holds the full payload during live streaming and `update_artifact`
re-emits. On session (re)attach the backend replays the session's artifacts as
**metadata-only** `create` events: `content` is `null` and a short `preview`
string (HTML stripped, ~200 chars) is included instead. The frontend keeps
only this metadata in memory for closed artifacts and fetches the full content
on demand via `GET /sessions/{session_id}/artifacts/{artifact_id}` when the
user reopens one.

Optional fields: `preview` (string, metadata-only replays), `language`
(string), `phase` (`"streaming" | "complete"`, streaming lifecycle).

### `tool_event`

A tool started, progressed, or finished. Drives the activity widgets.

```json
{
  "event": "tool_event",
  "session_id": "sess_abc",
  "tool": "run_tests",
  "status": "running",
  "params": { "framework": "pytest" },
  "output": null
}
```

`status` ∈ `{"running", "success", "error", "cancelled"}`. `output` is
tool-specific; present on `success`/`error`.

### `consent_request`

Asks the user to approve a sensitive action. The UI shows a ConsentModal.

```json
{
  "event": "consent_request",
  "id": "req_abc",
  "tool": "run_command",
  "risk": "sensitive",
  "reason_key": "consent.reason.run_tests",
  "reason_params": { "command": "pytest" },
  "summary_key": "consent.summary.run_tests"
}
```

The frontend looks up `reason_key` in the active i18n catalogue and
interpolates `reason_params`.

### `session_list`

Reply to `list_sessions`.

```json
{
  "event": "session_list",
  "sessions": [
    { "id": "sess_abc", "title": "Run tests", "updated": "2026-06-20T12:00:00Z" }
  ]
}
```

### `system_result`

Reply to a `system_command` the core sent to kali-home.

```json
{
  "event": "system_result",
  "id": "cmd_001",
  "ok": true,
  "data": { "image_b64": "<base64 png>" }
}
```

On failure: `{ "ok": false, "error": "Wayland portal denied" }`.

### `error`

Asynchronous error from the core.

```json
{ "event": "error", "detail": "TTS synthesis failed: no voice loaded" }
```

`detail` is a developer-facing English string, not user-facing. User-facing
errors are emitted as i18n keys in a future `user_error` event.

### `status`

Periodic status update (LLM provider connected, capture backend available,
etc.).

```json
{
  "event": "status",
  "llm_provider": "direct",
  "llm_model": "glm-5.1",
  "tts_provider": "inproc",
  "voice": "robot-es",
  "capture_backend": "wayland",
  "profile": "dev",
  "available_profiles": ["dev", "gaming", "files", "general"]
}
```

## HTTP endpoints

In addition to the WebSocket protocol, kali-core exposes a few HTTP endpoints for querying state:

| Endpoint | Description |
|---|---|
| `GET /health` | Health check. Returns `200 OK` if the sidecar is alive. |
| `GET /voices` | Returns the list of available TTS voices and modes. |
| `GET /profiles` | Returns the list of available permission profiles (name + id) for the profile selector in the UI. |

## Versioning

The protocol is versioned via the `version` field in `hello`/`ready`.
Until 1.0, breaking changes bump the minor version. After 1.0, breaking
changes bump the major version and require a migration note in this file.

## Validation

`kali_core/yarn/protocol.py` defines typed schemas (Pydantic models or
dataclasses) for every event and validates incoming frames. The frontend
has a matching TypeScript type file (`kali-web/src/lib/protocol.ts`). CI
should enforce that both sides stay in sync.