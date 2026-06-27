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
    for t in ["code", "document", "diff", "html", "mermaid"]:
        assert t in STREAMABLE_TYPES


def test_all_non_streamable_types():
    """All non-streamable types are classified correctly."""
    for t in ["json", "table", "checklist", "chart", "quiz"]:
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


# ── Native tool-call re-streaming tests ────────────────────────
#
# These tests verify that when an LLM uses OpenAI-style native function
# calling (delta.tool_calls) to invoke create_artifact with a streamable
# type, DirectLLMProvider re-streams the content as synthetic
# [BEGIN_ARTIFACT]/[END_ARTIFACT] deltas so ArtifactStreamProcessor
# streams the artifact live, instead of waiting for the batch tool_call.


from types import SimpleNamespace


def _mk_chunk(
    *,
    content: str | None = None,
    tool_name: str | None = None,
    tool_args: str | None = None,
    tool_index: int = 0,
    tool_id: str = "call_1",
    reasoning: str | None = None,
):
    """Build a fake OpenAI streaming chunk with the attributes direct.py reads."""
    delta = SimpleNamespace(
        content=content,
        tool_calls=None,
        reasoning_content=None,
    )
    if reasoning is not None:
        delta.reasoning_content = reasoning
    if tool_name is not None or tool_args is not None:
        func = SimpleNamespace(
            name=tool_name or None,
            arguments=tool_args or None,
        )
        tc = SimpleNamespace(
            index=tool_index,
            id=tool_id if tool_name else None,
            function=func,
        )
        delta.tool_calls = [tc]
    choice = SimpleNamespace(delta=delta)
    return SimpleNamespace(choices=[choice])


class _FakeAsyncStream:
    """Minimal async iterator over a list of pre-built chunks."""

    def __init__(self, chunks):
        self._chunks = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration:
            raise StopAsyncIteration


class _FakeCompletions:
    async def create(self, **kwargs):
        return _FakeAsyncStream(list(self._chunks))


class _FakeOpenAIClient:
    """Fake AsyncOpenAI client that returns a _FakeAsyncStream."""

    def __init__(self, chunks):
        self._chunks = chunks
        comp = _FakeCompletions()
        comp._chunks = chunks
        self.chat = SimpleNamespace(completions=comp)

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_native_tool_call_streamed_as_artifact():
    """A native create_artifact(html) tool call is re-streamed as live deltas."""
    from kali_core.mind.llm.direct import DirectLLMProvider

    html_content = "<!DOCTYPE html>\n<html><body>Hello</body></html>"
    # The JSON arguments the model would emit (content escaped).
    args_json = json.dumps(
        {"artifact_type": "html", "title": "Test", "content": html_content}
    )
    # Split args into sequential chunks to simulate streaming.
    chunk_size = max(1, len(args_json) // 8)
    arg_chunks = [args_json[i : i + chunk_size] for i in range(0, len(args_json), chunk_size)]

    chunks = []
    for i, arg_piece in enumerate(arg_chunks):
        chunks.append(
            _mk_chunk(
                tool_name="create_artifact" if i == 0 else None,
                tool_args=arg_piece,
            )
        )
    chunks.append(_mk_chunk())  # empty final chunk

    provider = DirectLLMProvider.__new__(DirectLLMProvider)
    provider._model = "fake-model"
    provider._system_prompt = ""
    provider._client = _FakeOpenAIClient(chunks)
    provider._max_tokens = 4096

    events = []
    async for ev in provider.stream([{"role": "user", "content": "make html"}]):
        events.append(ev)

    deltas = [e.text for e in events if e.kind == "delta" and e.text]
    joined = "".join(deltas)

    # Synthetic BEGIN_ARTIFACT marker should appear in deltas.
    assert "[BEGIN_ARTIFACT: html]" in joined
    assert "[END_ARTIFACT]" in joined
    # The unescaped HTML content should flow through the deltas.
    assert "<!DOCTYPE html>" in joined
    assert "<body>Hello</body>" in joined

    # No batch tool_call event should be emitted (it was streamed live).
    tool_call_events = [e for e in events if e.kind == "tool_call"]
    assert len(tool_call_events) == 0, "batch tool_call should be skipped"


@pytest.mark.asyncio
async def test_native_tool_call_non_streamable_stays_batch():
    """A native create_artifact(table) tool call is NOT re-streamed; stays batch."""
    from kali_core.mind.llm.direct import DirectLLMProvider

    table_content = json.dumps({"rows": [{"a": 1, "b": 2}]})
    args_json = json.dumps(
        {"artifact_type": "table", "title": "T", "content": table_content}
    )

    chunks = [_mk_chunk(tool_name="create_artifact", tool_args=args_json)]
    chunks.append(_mk_chunk())  # empty final chunk

    provider = DirectLLMProvider.__new__(DirectLLMProvider)
    provider._model = "fake-model"
    provider._system_prompt = ""
    provider._client = _FakeOpenAIClient(chunks)
    provider._max_tokens = 4096

    events = []
    async for ev in provider.stream([{"role": "user", "content": "make table"}]):
        events.append(ev)

    deltas = [e.text for e in events if e.kind == "delta" and e.text]
    joined = "".join(deltas)

    # No synthetic markers (non-streamable stays batch).
    assert "[BEGIN_ARTIFACT" not in joined
    # A batch tool_call event IS emitted.
    tool_call_events = [e for e in events if e.kind == "tool_call"]
    assert len(tool_call_events) == 1
    assert tool_call_events[0].tool_name == "create_artifact"
    assert tool_call_events[0].tool_args["artifact_type"] == "table"


@pytest.mark.asyncio
async def test_streamed_artifact_persists_on_close():
    """A streamed artifact (via synthetic deltas) is persisted to session_store."""
    from kali_core.mind.artifact_stream import ArtifactStreamProcessor

    # Simulate the runtime flow: feed synthetic BEGIN/END deltas through
    # the processor (as the runtime does) and verify close triggers persist.
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.llm = None
    runtime._histories = {}
    runtime._executor = None
    runtime._tools = []
    runtime._emit_event = None
    runtime._session_store = None

    persisted: list[tuple] = []

    class FakeStore:
        async def add_artifact(self, session_id, art_id, atype, title, content, wt, language=""):
            persisted.append((session_id, art_id, atype, title, content, wt, language))

    runtime._session_store = FakeStore()

    # Use the real _emit_artifact_event to check persistence on close.
    from kali_core.mind.artifact_stream import ArtifactStreamEvent

    close_evt = ArtifactStreamEvent(
        artifact_id="art_test",
        artifact_type="html",
        window_type="html",
        title="T",
        content="<html></html>",
        action="close",
        phase="complete",
        language="",
    )

    # Without emit_callback, _emit_artifact_event returns early — so set one.
    async def emit(payload):
        pass

    runtime._emit_event = emit
    await runtime._emit_artifact_event(close_evt, "sess_1")

    assert len(persisted) == 1
    sess, art_id, atype, title, content, wt, lang = persisted[0]
    assert sess == "sess_1"
    assert art_id == "art_test"
    assert atype == "html"
    assert content == "<html></html>"
    assert lang == ""


# ── Defensive salvage tests (1a / 1b) ───────────────────────────


def test_header_with_content_field_rescued(caplog):
    """1a: a VALID header JSON that smuggles a 'content' field is
    salvaged — the artifact is created with that content."""
    import logging

    p = ArtifactStreamProcessor(throttle_ms=0)
    html = "<html><body>Hello</body></html>"
    payload = json.dumps({"title": "Page", "content": html})
    r = p.feed(f"[BEGIN_ARTIFACT: html] {payload} [END_ARTIFACT]")
    fr = p.flush()

    events = r.artifact_events + fr.artifact_events
    creates = [e for e in events if e.action == "create"]
    closes = [e for e in events if e.action == "close"]
    assert len(creates) == 1
    assert creates[0].title == "Page"
    assert creates[0].artifact_type == "html"
    assert len(closes) == 1
    # The salvaged content should reach the close event.
    assert html in closes[0].content
    # The raw content after the header (between markers) is just " ",
    # so the close content equals the salvaged body.
    assert closes[0].content.strip() == html

    # A warning should be logged about the malformed header.
    with caplog.at_level(logging.WARNING, logger="kali_core.mind.artifact_stream"):
        # Re-run to capture the log since caplog may not have caught it.
        p2 = ArtifactStreamProcessor(throttle_ms=0)
        p2.feed(f"[BEGIN_ARTIFACT: html] {payload} [END_ARTIFACT]")
        p2.flush()
    assert any(
        "'content' field" in rec.getMessage()
        for rec in caplog.records
    )


def test_malformed_unescaped_content_salvaged():
    """1b: a header where the model put raw HTML with unescaped quotes
    inside a 'content' field (so the JSON is technically invalid) is
    salvaged via the fallback path. Reproduces the exact bug reported."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    # Mimic the real-world malformed output: header JSON that contains a
    # "content" field whose value has unescaped double quotes (charset="...",
    # id="ui", ...). No [END_ARTIFACT] — the model omitted it.
    body_html = (
        '<html lang="es">\n <meta charset="UTF-8">\n'
        ' <div id="ui">Sim</div>\n'
        " <script>console.log(1)</script>\n"
        "</html>"
    )
    malformed = (
        '[BEGIN_ARTIFACT: html] {"title": "Simulador", "content": "'
        + body_html
        + '")]'  # the model's broken tail
    )
    # Pad to exceed the salvage threshold so the fallback triggers.
    # We append enough trailing chars so the in-flight header is large.
    malformed += " " * 4200
    r = p.feed(malformed)
    fr = p.flush()

    events = r.artifact_events + fr.artifact_events
    creates = [e for e in events if e.action == "create"]
    closes = [e for e in events if e.action == "close"]
    assert len(creates) == 1
    assert creates[0].artifact_type == "html"
    assert creates[0].title == "Simulador"
    assert len(closes) == 1
    # The salvaged body should contain the raw HTML.
    assert "<html lang=" in closes[0].content
    assert '<meta charset="UTF-8">' in closes[0].content
    assert '<div id="ui">' in closes[0].content
    assert "console.log(1)" in closes[0].content

    # The malformed header text should NOT leak into chat text.
    chat = r.chat_text + fr.chat_text
    assert "[BEGIN_ARTIFACT" not in chat


def test_salvage_does_not_trigger_on_legitimate_small_header():
    """Guard: a normal small header that is still incomplete (waiting for
    more chunks) must NOT trigger the salvage fallback — it should return
    None and wait for the rest of the JSON."""
    p = ArtifactStreamProcessor(throttle_ms=0)
    # Small, legit, incomplete header (no closing brace yet).
    r = p.feed('[BEGIN_ARTIFACT: html] {"title":"X"')
    # Should not create an artifact yet — awaiting more chunks.
    assert r.artifact_events == []
    assert p.has_active_artifact is False
    # Now complete it normally.
    r2 = p.feed('} <html></html> [END_ARTIFACT]')
    fr = p.flush()
    events = r2.artifact_events + fr.artifact_events
    closes = [e for e in events if e.action == "close"]
    assert len(closes) == 1
    assert closes[0].title == "X"
    assert closes[0].content.strip() == "<html></html>"


def test_prompt_forbids_content_field_in_header():
    """The system prompt must explicitly forbid a 'content' field in the
    streaming header JSON and show a WRONG/RIGHT contrast."""
    from kali_core import config

    prompt = config.llm_system_prompt
    assert "NEVER include a \"content\" field" in prompt
    assert "WRONG" in prompt
    assert '"content":"<html>...</html>"' in prompt


def test_synthetic_header_includes_language_for_code():
    """direct.py must include 'language' in the synthetic BEGIN header
    when the model invokes create_artifact(code) with a language field."""
    import asyncio

    from kali_core.mind.llm.direct import DirectLLMProvider

    args_json = json.dumps(
        {
            "artifact_type": "code",
            "title": "Suma",
            "language": "python",
            "content": "print(1+1)\n",
        }
    )
    chunks = [_mk_chunk(tool_name="create_artifact", tool_args=args_json)]
    chunks.append(_mk_chunk())  # empty final chunk

    provider = DirectLLMProvider.__new__(DirectLLMProvider)
    provider._model = "fake-model"
    provider._system_prompt = ""
    provider._client = _FakeOpenAIClient(chunks)
    provider._max_tokens = 4096

    deltas: list[str] = []

    async def _run() -> None:
        async for ev in provider.stream(
            [{"role": "user", "content": "make code"}]
        ):
            if ev.kind == "delta" and ev.text:
                deltas.append(ev.text)

    asyncio.run(_run())
    joined = "".join(deltas)

    assert "[BEGIN_ARTIFACT: code]" in joined
    assert '"language":"python"' in joined
    assert '"title":"Suma"' in joined
    assert "[END_ARTIFACT]" in joined