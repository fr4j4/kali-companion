"""Unit tests for StreamingArtifactArgParser (incremental JSON parser
for native create_artifact tool-call arguments)."""

from __future__ import annotations

import pytest

from kali_core.mind.json_stream_extractor import StreamingArtifactArgParser


def _feed_all(parser: StreamingArtifactArgParser, text: str, chunk_size: int = 1):
    """Feed text in small chunks and collect all events."""
    events = []
    for i in range(0, len(text), chunk_size):
        events.extend(parser.feed(text[i : i + chunk_size]))
    return events


# ── Basic field extraction ──────────────────────────────────


def test_extracts_artifact_type_and_title():
    parser = StreamingArtifactArgParser()
    events = _feed_all(parser, '{"artifact_type": "html", "title": "Mi HTML"}')
    fields = {e.key: e.value for e in events if e.kind == "field"}
    assert fields["artifact_type"] == "html"
    assert fields["title"] == "Mi HTML"
    assert parser.artifact_type == "html"
    assert parser.title == "Mi HTML"
    assert parser.is_streamable is True
    assert parser.failed is False


def test_non_streamable_type_marked_correctly():
    parser = StreamingArtifactArgParser()
    _feed_all(parser, '{"artifact_type": "table", "title": "T"}')
    assert parser.artifact_type == "table"
    assert parser.is_streamable is False


def test_field_events_emitted_once():
    parser = StreamingArtifactArgParser()
    events = _feed_all(parser, '{"artifact_type": "code"}')
    field_events = [e for e in events if e.kind == "field"]
    assert len(field_events) == 1
    assert field_events[0].key == "artifact_type"


# ── Content streaming ───────────────────────────────────────


def test_content_chunks_emitted_live():
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "html", "title": "T", "content": "hello world"}'
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert "".join(chunks) == "hello world"
    assert parser.content == "hello world"
    assert any(e.kind == "content_done" for e in events)


def test_content_with_escaped_newlines_and_quotes():
    """HTML content with \\n and \\" escapes must be unescaped in chunks."""
    parser = StreamingArtifactArgParser()
    # content = <!DOCTYPE html>\n<html lang="es">
    json_str = (
        '{"artifact_type": "html", "title": "T", '
        '"content": "<!DOCTYPE html>\\n<html lang=\\"es\\">"}'
    )
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    joined = "".join(chunks)
    assert joined == '<!DOCTYPE html>\n<html lang="es">'
    assert parser.content == '<!DOCTYPE html>\n<html lang="es">'
    assert parser.failed is False


def test_content_with_unicode_escape():
    """\\uXXXX escapes (e.g. emoji) decode to the actual char."""
    parser = StreamingArtifactArgParser()
    # content = Hola 🌟
    json_str = (
        '{"artifact_type": "html", "title": "T", '
        '"content": "Hola \\ud83c\\udf1f"}'
    )
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    joined = "".join(chunks)
    # Surrogate pair should combine into the star emoji.
    assert "Hola" in joined
    assert "🌟" in joined or "\U0001f31f" in joined


def test_content_with_backslash_escape():
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "code", "title": "T", "content": "a\\\\b"}'
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert "".join(chunks) == "a\\b"


def test_content_with_slash_escape():
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "code", "title": "T", "content": "a\\/b"}'
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert "".join(chunks) == "a/b"


# ── Chunk boundary robustness ───────────────────────────────


def test_large_content_in_realistic_chunks():
    """Simulate HTML arriving in ~10-char chunks (as LLM streaming would)."""
    html = "<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Star Wars</h1>\n  </body>\n</html>"
    json_str = '{"artifact_type": "html", "title": "Ep3", "content": "' + html.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"}'
    parser = StreamingArtifactArgParser()
    events = _feed_all(parser, json_str, chunk_size=12)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert "".join(chunks) == html
    assert parser.content == html
    assert parser.failed is False


def test_escape_split_across_chunks():
    """An escape like \\n must be held until both chars arrive."""
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "html", "title": "T", "content": "a\\nb"}'
    # Feed char-by-char.
    events = _feed_all(parser, json_str, chunk_size=1)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert "".join(chunks) == "a\nb"


def test_unicode_escape_split_across_chunks():
    """\\uXXXX split across chunks still decodes."""
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "html", "title": "T", "content": "x\\ud83c\\udf1fy"}'
    events = _feed_all(parser, json_str, chunk_size=3)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    joined = "".join(chunks)
    assert joined.startswith("x")
    assert joined.endswith("y")


def test_title_arrives_after_content_starts():
    """If the model emits content before title, create still works."""
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "html", "content": "hello", "title": "Late"}'
    events = _feed_all(parser, json_str)
    fields = {e.key: e.value for e in events if e.kind == "field"}
    assert fields["title"] == "Late"
    assert parser.title == "Late"
    assert parser.content == "hello"


# ── Whitespace tolerance ────────────────────────────────────


def test_tolerates_whitespace():
    parser = StreamingArtifactArgParser()
    json_str = '{  "artifact_type"  :  "html"  ,  "title"  :  "T"  }'
    _feed_all(parser, json_str)
    assert parser.artifact_type == "html"
    assert parser.title == "T"


# ── Malformed JSON ──────────────────────────────────────────


def test_malformed_json_sets_failed_flag():
    parser = StreamingArtifactArgParser()
    _feed_all(parser, '{"artifact_type": html}')  # unquoted value
    assert parser.failed is True


def test_truncated_json_finalize_falls_back():
    """finalize() on truncated JSON marks failed and returns None."""
    parser = StreamingArtifactArgParser()
    _feed_all(parser, '{"artifact_type": "html", "title":')  # truncated
    result = parser.finalize()
    assert parser.failed is True
    assert result is None


def test_finalize_completes_partial_state():
    """If incremental parser got most fields, finalize backfills from raw."""
    parser = StreamingArtifactArgParser()
    # Feed a complete, valid JSON; incremental parser should finish it.
    _feed_all(parser, '{"artifact_type": "html", "title": "T", "content": "hi"}')
    assert parser.json_done is True
    result = parser.finalize()
    assert result is not None
    assert result.kind == "json_done"


def test_raw_json_preserved_for_fallback():
    parser = StreamingArtifactArgParser()
    raw = '{"artifact_type": "html", "title": "T"}'
    _feed_all(parser, raw)
    assert parser.raw_json == raw


def test_reset_clears_state():
    parser = StreamingArtifactArgParser()
    _feed_all(parser, '{"artifact_type": "html", "title": "T"}')
    parser.reset()
    assert parser.artifact_type == ""
    assert parser.title == ""
    assert parser.raw_json == ""
    assert parser.failed is False
    assert parser.json_done is False


def test_empty_chunk_returns_no_events():
    parser = StreamingArtifactArgParser()
    assert parser.feed("") == []


def test_unknown_keys_still_emit_field_events():
    """Extra keys don't break parsing; they're emitted as field events."""
    parser = StreamingArtifactArgParser()
    events = _feed_all(parser, '{"artifact_type": "html", "extra": "x", "title": "T"}')
    fields = {e.key: e.value for e in events if e.kind == "field"}
    assert fields.get("extra") == "x"


def test_empty_content_string():
    parser = StreamingArtifactArgParser()
    json_str = '{"artifact_type": "html", "title": "T", "content": ""}'
    events = _feed_all(parser, json_str)
    chunks = [e.text for e in events if e.kind == "content_chunk"]
    assert chunks == []
    assert parser.content == ""
    assert parser.content_done is True