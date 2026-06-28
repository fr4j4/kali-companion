"""Tests for the artifact management tools (list/get/update).

Covers:
- get_artifact: full content (backward compat) + line-range pagination.
- update_artifact: full mode (regression) + patch mode (unique, missing,
  ambiguous, replace_all, non-streamable rejected, mixed-params errors).
- list_artifacts: preview_len default, custom, clamp.
- Patch diff-artifact emission: gated by settings.artifact_diff_preview,
  emitted via ctx.emit when enabled, suppressed when disabled.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from kali_core.claws.base import ToolContext
from kali_core.claws.manage_artifacts import (
    GetArtifactTool,
    ListArtifactsTool,
    UpdateArtifactTool,
)
from kali_core.config import settings
from kali_core.nest.store import SessionStore


@pytest_asyncio.fixture
async def store() -> SessionStore:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    s = SessionStore(db_path)
    yield s
    Path(db_path).unlink(missing_ok=True)


def _ctx(store: SessionStore, *, emit=None) -> ToolContext:
    return ToolContext(
        session_id="sess_test",
        working_dir=".",
        profile="dev",
        session_store=store,
        emit=emit,
    )


async def _seed(
    store: SessionStore,
    *,
    artifact_id: str = "art_abc123",
    art_type: str = "html",
    title: str = "Test Artifact",
    content: str = "<h1>Hello</h1>",
    window_type: str = "html",
) -> str:
    await store.add_artifact(
        "sess_test", artifact_id, art_type, title, content, window_type,
    )
    return artifact_id


# ── get_artifact ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_artifact_full_backCompat(store: SessionStore) -> None:
    """Without offset/limit, returns the full content (legacy shape)."""
    aid = await _seed(store, content="line1\nline2\nline3")
    r = await GetArtifactTool().run({"artifact_id": aid}, _ctx(store))
    assert r.error is None
    out = r.output
    assert out["content"] == "line1\nline2\nline3"
    assert "paginated" not in out
    assert out["id"] == aid


@pytest.mark.asyncio
async def test_get_artifact_paginated_offset_limit(store: SessionStore) -> None:
    aid = await _seed(store, content="l1\nl2\nl3\nl4\nl5")
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "offset": 2, "limit": 2}, _ctx(store),
    )
    assert r.error is None
    out = r.output
    assert out["content"] == "l2\nl3"
    assert out["paginated"] is True
    assert out["offset"] == 2
    assert out["limit"] == 2
    assert out["total_lines"] == 5
    assert out["returned_lines"] == 2
    assert out["has_more"] is True


@pytest.mark.asyncio
async def test_get_artifact_offset_only(store: SessionStore) -> None:
    aid = await _seed(store, content="l1\nl2\nl3")
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "offset": 2}, _ctx(store),
    )
    assert r.error is None
    assert r.output["content"] == "l2\nl3"
    assert r.output["has_more"] is False
    assert r.output["total_lines"] == 3
    assert r.output["returned_lines"] == 2


@pytest.mark.asyncio
async def test_get_artifact_limit_only(store: SessionStore) -> None:
    aid = await _seed(store, content="l1\nl2\nl3\nl4\nl5")
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "limit": 2}, _ctx(store),
    )
    assert r.error is None
    assert r.output["content"] == "l1\nl2"
    assert r.output["has_more"] is True


@pytest.mark.asyncio
async def test_get_artifact_offset_beyond_end(store: SessionStore) -> None:
    aid = await _seed(store, content="l1\nl2")
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "offset": 99, "limit": 5}, _ctx(store),
    )
    assert r.error is None
    assert r.output["content"] == ""
    assert r.output["returned_lines"] == 0
    assert r.output["has_more"] is False
    assert r.output["total_lines"] == 2


@pytest.mark.asyncio
async def test_get_artifact_long_line_truncated(store: SessionStore) -> None:
    long_line = "x" * 3000
    aid = await _seed(store, content=long_line)
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "offset": 1, "limit": 1}, _ctx(store),
    )
    assert r.error is None
    line = r.output["content"]
    assert len(line) <= 2000 + 20  # truncate marker is short
    assert line.endswith("…[truncated]")


@pytest.mark.asyncio
async def test_get_artifact_not_found(store: SessionStore) -> None:
    r = await GetArtifactTool().run(
        {"artifact_id": "art_missing"}, _ctx(store),
    )
    assert r.error is not None
    assert "not found" in r.error


@pytest.mark.asyncio
async def test_get_artifact_invalid_offset(store: SessionStore) -> None:
    aid = await _seed(store, content="l1")
    r = await GetArtifactTool().run(
        {"artifact_id": aid, "offset": 0}, _ctx(store),
    )
    assert r.error is not None
    assert "offset" in r.error


# ── update_artifact — full mode (regression) ───────────────────


@pytest.mark.asyncio
async def test_update_full_mode_replaces_content(store: SessionStore) -> None:
    aid = await _seed(store, content="<p>old</p>")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "content": "<p>new</p>"}, _ctx(store),
    )
    assert r.error is None
    assert r.output["mode"] == "full"
    assert r.output["updated"] is True
    assert r.artifact is not None
    assert r.artifact["content"] == "<p>new</p>"
    # Persisted.
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == "<p>new</p>"


@pytest.mark.asyncio
async def test_update_full_mode_with_title(store: SessionStore) -> None:
    aid = await _seed(store, title="Old", content="x")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "content": "y", "title": "New"}, _ctx(store),
    )
    assert r.error is None
    assert r.output["title"] == "New"


# ── update_artifact — patch mode ───────────────────────────────


@pytest.mark.asyncio
async def test_update_patch_unique(store: SessionStore) -> None:
    aid = await _seed(
        store, art_type="html",
        content="<h1>Title</h1>\n<p>body</p>\n<footer>end</footer>",
    )
    r = await UpdateArtifactTool().run(
        {
            "artifact_id": aid,
            "old_string": "<p>body</p>",
            "new_string": "<p>new body</p>",
        },
        _ctx(store),
    )
    assert r.error is None
    assert r.output["mode"] == "patch"
    assert r.output["occurrences_replaced"] == 1
    assert "diff" in r.output
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == (
        "<h1>Title</h1>\n<p>new body</p>\n<footer>end</footer>"
    )
    # WS update event carries the full new content.
    assert r.artifact is not None
    assert r.artifact["content"] == art["content"]
    assert r.artifact["update"] == "update"


@pytest.mark.asyncio
async def test_update_patch_delete_via_empty_new_string(store: SessionStore) -> None:
    aid = await _seed(store, art_type="document", content="keep\nremove me\nend")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "remove me\n", "new_string": ""},
        _ctx(store),
    )
    assert r.error is None
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == "keep\nend"


@pytest.mark.asyncio
async def test_update_patch_not_found(store: SessionStore) -> None:
    aid = await _seed(store, art_type="html", content="<p>body</p>")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "<p>missing</p>", "new_string": "x"},
        _ctx(store),
    )
    assert r.error is not None
    assert "not found" in r.error
    # Content unchanged.
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == "<p>body</p>"


@pytest.mark.asyncio
async def test_update_patch_ambiguous_rejects(store: SessionStore) -> None:
    aid = await _seed(
        store, art_type="html",
        content="<li>x</li>\n<li>x</li>\n<li>y</li>",
    )
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "<li>x</li>", "new_string": "<li>z</li>"},
        _ctx(store),
    )
    assert r.error is not None
    assert "2 times" in r.error
    art = await store.get_artifact("sess_test", aid)
    assert "<li>z</li>" not in art["content"]


@pytest.mark.asyncio
async def test_update_patch_replace_all(store: SessionStore) -> None:
    aid = await _seed(
        store, art_type="html",
        content="<li>x</li>\n<li>x</li>\n<li>y</li>",
    )
    r = await UpdateArtifactTool().run(
        {
            "artifact_id": aid,
            "old_string": "<li>x</li>",
            "new_string": "<li>z</li>",
            "replace_all": True,
        },
        _ctx(store),
    )
    assert r.error is None
    assert r.output["occurrences_replaced"] == 2
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == "<li>z</li>\n<li>z</li>\n<li>y</li>"


@pytest.mark.asyncio
async def test_update_patch_non_streamable_rejected(store: SessionStore) -> None:
    aid = await _seed(
        store, art_type="table", window_type="table",
        content='{"rows":[["a","b"]]}',
    )
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": '"a"', "new_string": '"c"'},
        _ctx(store),
    )
    assert r.error is not None
    assert "streamable" in r.error
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == '{"rows":[["a","b"]]}'


@pytest.mark.asyncio
async def test_update_patch_streamable_types(
    store: SessionStore,
) -> None:
    """Every streamable type accepts patch mode."""
    for t, wt in [("code", "code"), ("document", "document"),
                  ("diff", "diff"), ("html", "html"), ("mermaid", "mermaid")]:
        aid = f"art_{t}"
        await _seed(
            store, artifact_id=aid, art_type=t, window_type=wt,
            content=f"{t} alpha\n{t} beta",
        )
        r = await UpdateArtifactTool().run(
            {"artifact_id": aid, "old_string": "alpha", "new_string": "ALPHA"},
            _ctx(store),
        )
        assert r.error is None, f"{t}: {r.error}"
        art = await store.get_artifact("sess_test", aid)
        assert "ALPHA" in art["content"]


@pytest.mark.asyncio
async def test_update_rejects_both_content_and_patch(store: SessionStore) -> None:
    aid = await _seed(store, content="x")
    r = await UpdateArtifactTool().run(
        {
            "artifact_id": aid,
            "content": "y",
            "old_string": "x",
            "new_string": "z",
        },
        _ctx(store),
    )
    assert r.error is not None
    assert "not both" in r.error


@pytest.mark.asyncio
async def test_update_rejects_neither_content_nor_patch(
    store: SessionStore,
) -> None:
    aid = await _seed(store, content="x")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid}, _ctx(store),
    )
    assert r.error is not None


@pytest.mark.asyncio
async def test_update_patch_missing_new_string(store: SessionStore) -> None:
    aid = await _seed(store, content="x")
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "x"}, _ctx(store),
    )
    assert r.error is not None
    assert "new_string" in r.error


@pytest.mark.asyncio
async def test_update_artifact_not_found(store: SessionStore) -> None:
    r = await UpdateArtifactTool().run(
        {"artifact_id": "art_missing", "content": "x"}, _ctx(store),
    )
    assert r.error is not None
    assert "not found" in r.error


# ── list_artifacts — preview_len ───────────────────────────────


@pytest.mark.asyncio
async def test_list_artifacts_default_preview(store: SessionStore) -> None:
    await _seed(
        store, artifact_id="a1", content="x" * 400,
        art_type="html", title="Long",
    )
    r = await ListArtifactsTool().run({}, _ctx(store))
    assert r.error is None
    assert r.output["count"] == 1
    preview = r.output["artifacts"][0]["preview"]
    assert len(preview) <= 200 + 3  # 200 + "..."
    assert preview.endswith("...")


@pytest.mark.asyncio
async def test_list_artifacts_custom_preview_len(store: SessionStore) -> None:
    await _seed(
        store, artifact_id="a1", content="y" * 600,
        art_type="html", title="Long",
    )
    r = await ListArtifactsTool().run({"preview_len": 500}, _ctx(store))
    assert r.error is None
    preview = r.output["artifacts"][0]["preview"]
    assert len(preview) <= 500 + 3
    assert len(preview) > 200 + 3  # bigger than default


@pytest.mark.asyncio
async def test_list_artifacts_preview_clamped_to_max(
    store: SessionStore,
) -> None:
    await _seed(
        store, artifact_id="a1", content="z" * 2000,
        art_type="html", title="Huge",
    )
    r = await ListArtifactsTool().run({"preview_len": 5000}, _ctx(store))
    assert r.error is None
    preview = r.output["artifacts"][0]["preview"]
    assert len(preview) <= 1000 + 3


@pytest.mark.asyncio
async def test_list_artifacts_empty(store: SessionStore) -> None:
    r = await ListArtifactsTool().run({}, _ctx(store))
    assert r.error is None
    assert r.output["count"] == 0
    assert r.output["artifacts"] == []


# ── diff-artifact emission (gated by settings) ─────────────────


class _EmitRecorder:
    """Captures payloads emitted via ctx.emit for assertions."""

    def __init__(self) -> None:
        self.payloads: list[dict] = []

    async def __call__(self, payload: dict) -> None:
        self.payloads.append(payload)


@pytest.mark.asyncio
async def test_patch_emits_diff_artifact_when_enabled(
    store: SessionStore, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "artifact_diff_preview", True)
    aid = await _seed(
        store, art_type="html",
        content="<h1>Title</h1><p>body</p>",
    )
    rec = _EmitRecorder()
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "body", "new_string": "BODY"},
        _ctx(store, emit=rec),
    )
    assert r.error is None
    # ctx.emit should have received a diff artifact payload.
    diff_payloads = [p for p in rec.payloads if p.get("type") == "diff"]
    assert len(diff_payloads) == 1
    assert "cambios" in diff_payloads[0]["title"]
    assert "BODY" in diff_payloads[0]["content"]


@pytest.mark.asyncio
async def test_patch_skips_diff_artifact_when_disabled(
    store: SessionStore, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "artifact_diff_preview", False)
    aid = await _seed(
        store, art_type="html",
        content="<h1>Title</h1><p>body</p>",
    )
    rec = _EmitRecorder()
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "old_string": "body", "new_string": "BODY"},
        _ctx(store, emit=rec),
    )
    assert r.error is None
    # The patch itself still succeeded.
    art = await store.get_artifact("sess_test", aid)
    assert "BODY" in art["content"]
    # No diff artifact emitted.
    diff_payloads = [p for p in rec.payloads if p.get("type") == "diff"]
    assert len(diff_payloads) == 0
    # The tool output still includes the diff text for the LLM.
    assert "diff" in r.output


@pytest.mark.asyncio
async def test_full_mode_does_not_emit_diff_artifact(
    store: SessionStore, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "artifact_diff_preview", True)
    aid = await _seed(store, art_type="html", content="<p>old</p>")
    rec = _EmitRecorder()
    r = await UpdateArtifactTool().run(
        {"artifact_id": aid, "content": "<p>new</p>"},
        _ctx(store, emit=rec),
    )
    assert r.error is None
    diff_payloads = [p for p in rec.payloads if p.get("type") == "diff"]
    assert len(diff_payloads) == 0
    assert "diff" not in r.output