"""Tests for the artifact streaming pipeline.

Tests the ArtifactStreamProcessor (marker detection, content accumulation,
event emission) and the runtime integration (WS artifact events with phase).
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import pytest

from kali_core.mind.artifact_stream import (
    ArtifactStreamProcessor,
    STREAMABLE_TYPES,
    NON_STREAMABLE_TYPES,
)
from kali_core.mind.llm.provider import LLMProvider, StreamEvent, ToolDef
from kali_core.mind.runtime import AgentRuntime


# ── ArtifactStreamProcessor unit tests ────────────────────────


def test_no_markers_chat_text_flows():
    """Without markers, all text is returned as chat_text."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed("hello world")
    fr = p.flush()
    assert r.chat_text + fr.chat_text == "hello world"
    assert r.artifact_events == []


def test_streamable_code_full_cycle():
    """BEGIN/END with a streamable type produces create + close events."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed(
        'pre [BEGIN_ARTIFACT: code] {"title":"Test"} '
        "public class X {} [END_ARTIFACT] post"
    )
    fr = p.flush()
    assert r.chat_text + fr.chat_text == "pre  post"
    events = r.artifact_events
    assert len(events) >= 2
    assert events[0].action == "create"
    assert events[0].artifact_type == "code"
    assert events[0].title == "Test"
    assert events[0].window_type == "code"
    assert events[0].phase == "streaming"
    assert events[-1].action == "close"
    assert events[-1].phase == "complete"
    assert events[-1].content == " public class X {} "


def test_non_streamable_table_emits_update_before_close():
    """Non-streamable types emit create + update + close (3 events)."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed(
        '[BEGIN_ARTIFACT: table] {"title":"T"} '
        '{"rows":[1,2]} [END_ARTIFACT]'
    )
    assert r.chat_text == ""
    assert len(r.artifact_events) == 3
    assert r.artifact_events[0].action == "create"
    assert r.artifact_events[1].action == "update"
    assert r.artifact_events[2].action == "close"
    assert r.artifact_events[2].content == ' {"rows":[1,2]} '


def test_markers_split_across_chunks():
    """Markers split across chunks are still detected."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r1 = p.feed("hello [BEGIN_ARTIF")
    assert r1.artifact_events == []
    r2 = p.feed('ACT: code] {"title":"X"} code here [END_ARTIFACT]')
    assert r1.chat_text + r2.chat_text == "hello "
    assert len(r2.artifact_events) >= 2
    assert r2.artifact_events[-1].content == " code here "


def test_incomplete_artifact_closed_on_flush():
    """If stream ends without END, artifact is closed with partial content."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r1 = p.feed('[BEGIN_ARTIFACT: html] {"title":"Page"} <html>partial')
    assert r1.artifact_events[0].action == "create"
    fr = p.flush()
    assert len(fr.artifact_events) == 1
    assert fr.artifact_events[0].action == "close"
    assert fr.artifact_events[0].phase == "complete"
    assert fr.artifact_events[0].content == " <html>partial"


def test_begin_without_json_header():
    """BEGIN without JSON header works with empty title."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed("[BEGIN_ARTIFACT: code] plain code [END_ARTIFACT]")
    assert r.artifact_events[0].title == ""
    assert r.artifact_events[-1].content == "plain code "


def test_invalid_type_treated_as_chat_text():
    """Invalid artifact type in marker is re-emitted as chat text."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed("[BEGIN_ARTIFACT: foobar] not an artifact [END_ARTIFACT]")
    fr = p.flush()
    assert (
        r.chat_text + fr.chat_text
        == "[BEGIN_ARTIFACT: foobar] not an artifact [END_ARTIFACT]"
    )
    assert r.artifact_events == []


def test_multiple_artifacts_in_sequence():
    """Multiple BEGIN/END blocks produce separate create/close cycles."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    r = p.feed(
        '[BEGIN_ARTIFACT: code] {"title":"A"} aaa [END_ARTIFACT] '
        '[BEGIN_ARTIFACT: document] {"title":"B"} bbb [END_ARTIFACT]'
    )
    creates = [e for e in r.artifact_events if e.action == "create"]
    closes = [e for e in r.artifact_events if e.action == "close"]
    assert len(creates) == 2
    assert len(closes) == 2
    assert creates[0].title == "A"
    assert creates[1].title == "B"
    assert closes[0].content == " aaa "
    assert closes[1].content == " bbb "


def test_reset_clears_state():
    """reset() clears all internal state."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    p.feed('[BEGIN_ARTIFACT: code] {"title":"X"} code')
    assert p.has_active_artifact
    p.reset()
    assert not p.has_active_artifact


def test_throttle_suppresses_intermediate_updates():
    """With throttle > 0, intermediate updates are suppressed."""
    import time

    p = ArtifactStreamProcessor(throttle_ms=100)
    r1 = p.feed('[BEGIN_ARTIFACT: code] {"title":"X"} line1\n')
    # First feed: create event, no update (content too new).
    creates = [e for e in r1.artifact_events if e.action == "create"]
    assert len(creates) == 1
    # Immediately feed more content — should be throttled.
    r2 = p.feed("line2\n")
    updates = [e for e in r2.artifact_events if e.action == "update"]
    assert len(updates) == 0  # throttled
    # Wait past throttle window.
    time.sleep(0.12)
    r3 = p.feed("line3\n")
    updates = [e for e in r3.artifact_events if e.action == "update"]
    assert len(updates) == 1


def test_all_streamable_types():
    """All streamable types are classified correctly."""
    for t in ["code", "document", "diff", "html"]:
        assert t in STREAMABLE_TYPES


def test_all_non_streamable_types():
    """All non-streamable types are classified correctly."""
    for t in ["mermaid", "json", "table", "checklist", "chart", "quiz"]:
        assert t in NON_STREAMABLE_TYPES


# ── Runtime integration test ──────────────────────────────────


class FakeArtifactLLMProvider:
    """LLM that emits a BEGIN/END artifact block in delta text."""

    provider_name = "fake-artifact"

    def __init__(self) -> None:
        self._model = "fake-model"

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        # Emit a code artifact via BEGIN/END markers.
        yield StreamEvent(
            kind="delta",
            text='Here is the code:\n[BEGIN_ARTIFACT: code] {"title":"Hello"} ',
        )
        yield StreamEvent(kind="delta", text="public class Hello {\n}")
        yield StreamEvent(kind="delta", text="    void main() {}\n")
        yield StreamEvent(kind="delta", text="}\n[END_ARTIFACT]\nDone!")
        yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        return {"text": "done"}


@pytest.mark.asyncio
async def test_runtime_emits_artifact_streaming_events():
    """Runtime processes BEGIN/END markers and emits artifact WS events."""
    provider = FakeArtifactLLMProvider()
    runtime = AgentRuntime(provider)
    runtime.set_executor(None)
    runtime.set_tools([])

    emitted: list[dict] = []

    async def emit_callback(payload: dict) -> None:
        emitted.append(payload)

    runtime.set_emit_callback(emit_callback)

    deltas: list[str] = []
    async for event in runtime.respond("show me code", "test-session"):
        if event.kind == "delta" and event.text:
            deltas.append(event.text)

    # Chat text should contain the text outside the markers.
    chat = "".join(deltas)
    assert "Here is the code:" in chat
    assert "Done!" in chat
    assert "[BEGIN_ARTIFACT" not in chat
    assert "[END_ARTIFACT" not in chat

    # Artifact events should be emitted via the callback.
    assert len(emitted) >= 2
    artifact_events = [e for e in emitted if e.get("event") == "artifact"]
    assert len(artifact_events) >= 2

    # First event: create.
    create_evt = artifact_events[0]
    assert create_evt["update"] == "create"
    assert create_evt["phase"] == "streaming"
    assert create_evt["windowType"] == "code"
    assert create_evt["title"] == "Hello"

    # Last event: close with complete phase.
    close_evt = artifact_events[-1]
    assert close_evt["update"] == "close"
    assert close_evt["phase"] == "complete"
    assert "public class Hello" in close_evt["content"]
    assert "void main" in close_evt["content"]