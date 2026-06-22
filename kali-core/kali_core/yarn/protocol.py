"""Protocol schemas for kali-yarn.

Defines the event types both sides of the WebSocket agree on. See
docs/PROTOCOL.md for the full catalogue and field semantics.
"""

from __future__ import annotations

from typing import Literal

# Incoming (web → core)
EventType = Literal[
    "hello",
    "input",
    "stop",
    "new_session",
    "attach_session",
    "list_sessions",
    "audio_start",
    "audio_end",
    "settings",
    "consent_response",
    "list_jobs",
    "cancel_job",
    "get_job_logs",
    "request_image",
]

# Outgoing (core → web)
EventTypeOut = Literal[
    "ready",
    "connected",
    "delta",
    "reasoning_delta",
    "turn_end",
    "message",
    "stt_partial",
    "stt_final",
    "wake_word",
    "tts_audio",
    "tts_filtered",
    "artifact",
    "tool_event",
    "consent_request",
    "session_list",
    "error",
    "status",
    "job_start",
    "job_progress",
    "job_done",
    "job_log",
    "job_list",
    "image_ready",
]


