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

### `delete_session`

Delete a session by ID.

```json
{
  "event": "delete_session",
  "session_id": "sess_abc"
}
```

### `delete_all_sessions`

Delete all sessions.

```json
{
  "event": "delete_all_sessions"
}
```

### `get_artifact_content`

Request the full content of an artifact (for metadata-only replays).

```json
{
  "event": "get_artifact_content",
  "artifact_id": "art_xyz"
}
```

### `get_artifact_console`

Request console logs from an HTML artifact.

```json
{
  "event": "get_artifact_console",
  "artifact_id": "art_xyz",
  "limit": 200
}
```

### `close_artifact`

Close an artifact window.

```json
{
  "event": "close_artifact",
  "artifact_id": "art_xyz"
}
```

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

### `capture_request`

Screen capture is initiated by the core via `kali-gaze`, which uses the `mss` library to select the best backend (Wayland/X11/Windows). No external shell command is required for the capture itself, though the Wayland portal may prompt the user for permission.

### `system_command`

A request that kali-shell should handle (it requires OS access the core
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

kali-shell performs the action and returns the result via `system_result`.

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
  "update": "create",
  "phase": "streaming",
  "language": "html"
}
```

`type` ∈ `{"html", "markdown", "code", "diff", "mermaid", "json", "table", "checklist", "chart", "quiz", "widget"}`.
`update` ∈ `{"create", "update", "close"}`.
`phase` ∈ `{"streaming", "complete"}`.
`content` holds the full payload during live streaming and `update_artifact`
re-emits. On session (re)attach the backend replays the session's artifacts as
**metadata-only** `create` events: `content` is `null` and a short `preview`
string (HTML stripped, ~200 chars) is included instead. The frontend keeps
only this metadata in memory for closed artifacts and fetches the full content
on demand via `GET /sessions/{session_id}/artifacts/{artifact_id}` when the
user reopens one.

Optional fields: `preview` (string, metadata-only replays), `language`
(string, programming language for code/diff artifacts).

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

Periodic status update (LLM provider connected, capture backend available, etc.).

```json
{
  "event": "status",
  "llm_provider": "direct",
  "llm_model": "glm-5.1",
  "llm_max_tokens": 4096,
  "stt_enabled": true,
  "stt_provider": "vosk",
  "stt_loaded": true,
  "stt_language": "es",
  "tts_enabled": true,
  "tts_provider": "qwen",
  "voice": "robot-es",
  "capture_backend": "wayland",
  "profile": "dev",
  "input_mode": "ptt",
  "available_profiles": ["dev", "gaming", "files", "general"],
  "config_warnings": []
}
```

### `session_deleted`

Confirm session deletion.

```json
{
  "event": "session_deleted",
  "session_id": "sess_abc"
}
```

### `step_start`

Agent started a new step in multi-turn execution.

```json
{
  "event": "step_start",
  "session_id": "sess_abc",
  "step": 2
}
```

### `model_stats`

Streaming model statistics.

```json
{
  "event": "model_stats",
  "session_id": "sess_abc",
  "prompt_tokens": 1200,
  "completion_tokens": 350,
  "total_tokens": 1550
}
```

### `voice_config`

Voice configuration loaded.

```json
{
  "event": "voice_config",
  "voice": "robot-es",
  "mode": "robotic",
  "tts_provider": "qwen"
}
```

### `stt_language`

STT language changed.

```json
{
  "event": "stt_language",
  "language": "es"
}
```

### `voice_loaded`

Voice loaded and ready.

```json
{
  "event": "voice_loaded",
  "voice": "robot-es"
}
```

### `artifact_content`

Response to `get_artifact_content` (full artifact content for metadata-only replays).

```json
{
  "event": "artifact_content",
  "artifact_id": "art_xyz",
  "content": "<html>…</html>"
}
```

### `artifact_console`

Response to `get_artifact_console` (console logs from HTML artifact).

```json
{
  "event": "artifact_console",
  "artifact_id": "art_xyz",
  "logs": [
    { "level": "error", "message": "Uncaught TypeError: ...", "timestamp": 1719000000000 }
  ]
}
```

### `jobs`

List of background jobs.

```json
{
  "event": "jobs",
  "jobs": [
    { "id": "job_001", "type": "download", "progress": 75, "status": "running" }
  ]
}
```

### `job_update`

Job progress update.

```json
{
  "event": "job_update",
  "id": "job_001",
  "progress": 80,
  "status": "running"
}
```

## HTTP endpoints

In addition to the WebSocket protocol, kali-core exposes HTTP endpoints for querying state:

| Endpoint | Description |
|---|---|
| `GET /health` | Health check. Returns `200 OK` if the sidecar is alive. |
| `GET /voices` | Returns the list of available TTS voices and modes. |
| `GET /profiles` | Returns the list of available permission profiles (name + id). |
| `GET /sessions` | Returns all sessions. |
| `GET /sessions/{session_id}` | Returns a specific session. |
| `GET /sessions/{session_id}/messages` | Returns messages for a session. |
| `GET /sessions/{session_id}/artifacts` | Returns artifacts for a session. |
| `GET /sessions/{session_id}/artifacts/{artifact_id}` | Returns full artifact content (for metadata-only replays). |
| `DELETE /sessions/{session_id}` | Deletes a session. |
| `DELETE /sessions` | Deletes all sessions. |

## Versioning

The protocol is versioned via the `version` field in `hello`/`ready`.
Until 1.0, breaking changes bump the minor version. After 1.0, breaking
changes bump the major version and require a migration note in this file.

## Validation

`kali_core/yarn/protocol.py` defines typed schemas (Pydantic models or
dataclasses) for every event and validates incoming frames. The frontend
has a matching TypeScript type file (`kali-web/src/lib/protocol.ts`). CI
should enforce that both sides stay in sync.