"""Tests for SessionStore (SQLite) and related nest modules."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from kali_core.nest.store import SessionStore


@pytest_asyncio.fixture
async def store() -> SessionStore:
    """Create a SessionStore backed by a temp file, cleaned up after."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    s = SessionStore(db_path)
    yield s
    Path(db_path).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_create_session(store: SessionStore) -> None:
    sess = await store.create_session(title="Test chat")
    assert "id" in sess
    assert sess["id"].startswith("sess_")
    assert sess["title"] == "Test chat"
    assert "created" in sess
    assert "updated" in sess


@pytest.mark.asyncio
async def test_list_sessions_empty(store: SessionStore) -> None:
    sessions = await store.list_sessions()
    assert sessions == []


@pytest.mark.asyncio
async def test_list_sessions_ordered(store: SessionStore) -> None:
    s1 = await store.create_session(title="First")
    s2 = await store.create_session(title="Second")
    sessions = await store.list_sessions()
    # Most recent first.
    assert sessions[0]["id"] == s2["id"]
    assert sessions[1]["id"] == s1["id"]


@pytest.mark.asyncio
async def test_add_and_get_messages(store: SessionStore) -> None:
    sess = await store.create_session()
    sid = sess["id"]

    msg1 = await store.add_message(sid, "user", "hola")
    assert msg1["role"] == "user"
    assert msg1["content"] == "hola"

    msg2 = await store.add_message(sid, "assistant", "Hola, soy Kali.")
    assert msg2["role"] == "assistant"

    messages = await store.get_messages(sid)
    assert len(messages) == 2
    assert messages[0]["content"] == "hola"
    assert messages[1]["content"] == "Hola, soy Kali."


@pytest.mark.asyncio
async def test_add_message_updates_updated_time(store: SessionStore) -> None:
    sess = await store.create_session()
    sid = sess["id"]
    orig_updated = sess["updated"]

    await store.add_message(sid, "user", "test")
    sessions = await store.list_sessions()
    updated_session = next(s for s in sessions if s["id"] == sid)
    assert updated_session["updated"] > orig_updated


@pytest.mark.asyncio
async def test_auto_creates_db_dir() -> None:
    """Verify the store creates parent directories automatically."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "nested" / "dir" / "test.db"
        s = SessionStore(str(db_path))
        sess = await s.create_session()
        assert db_path.exists()
        assert sess["id"].startswith("sess_")


@pytest.mark.asyncio
async def test_multiple_sessions_independent(store: SessionStore) -> None:
    s1 = await store.create_session()
    s2 = await store.create_session()

    await store.add_message(s1["id"], "user", "msg for s1")
    await store.add_message(s2["id"], "user", "msg for s2")

    msgs1 = await store.get_messages(s1["id"])
    msgs2 = await store.get_messages(s2["id"])

    assert len(msgs1) == 1
    assert len(msgs2) == 1
    assert msgs1[0]["content"] == "msg for s1"
    assert msgs2[0]["content"] == "msg for s2"


@pytest.mark.asyncio
async def test_set_title_if_default(store: SessionStore) -> None:
    sess = await store.create_session()
    assert sess["title"] == "New chat"

    await store.set_title_if_default(sess["id"], "First message")
    sessions = await store.list_sessions()
    updated = next(s for s in sessions if s["id"] == sess["id"])
    assert updated["title"] == "First message"

    # Calling again should NOT override a non-default title.
    await store.set_title_if_default(sess["id"], "Second message")
    sessions = await store.list_sessions()
    updated = next(s for s in sessions if s["id"] == sess["id"])
    assert updated["title"] == "First message"


# ── Artifact persistence ──────────────────────────────────


@pytest.mark.asyncio
async def test_add_and_get_artifacts(store: SessionStore) -> None:
    sess = await store.create_session()
    sid = sess["id"]

    art1 = await store.add_artifact(
        sid, "art_aaa1", "widget", "Dota 2 — Pudge",
        '{"items":[{"widgetType":"dota_hero_card","data":{"hero":"Pudge"}}]}',
    )
    assert art1["id"] == "art_aaa1"
    assert art1["session_id"] == sid
    assert art1["type"] == "widget"
    assert art1["title"] == "Dota 2 — Pudge"

    art2 = await store.add_artifact(
        sid, "art_bbb2", "html", "Mockup",
        "<div>hello</div>",
    )

    artifacts = await store.get_artifacts(sid)
    assert len(artifacts) == 2
    assert artifacts[0]["id"] == "art_aaa1"
    assert artifacts[1]["id"] == "art_bbb2"
    assert artifacts[0]["content"] == art1["content"]


# ── Game image cache (generic) ────────────────────────────


@pytest.mark.asyncio
async def test_add_game_image(store: SessionStore) -> None:
    sess = await store.create_session()
    img = await store.add_game_image("dota:hero:pudge", "dota", "hero", "dota/heroes/pudge.png", "https://cdn.example.com/pudge.png")
    assert img["key"] == "dota:hero:pudge"
    assert img["game"] == "dota"
    assert img["type"] == "hero"
    assert img["file_path"] == "dota/heroes/pudge.png"

    fetched = await store.get_game_image("dota:hero:pudge")
    assert fetched is not None
    assert fetched["game"] == "dota"
    assert fetched["file_path"] == "dota/heroes/pudge.png"


@pytest.mark.asyncio
async def test_get_game_image_missing(store: SessionStore) -> None:
    fetched = await store.get_game_image("nonexistent")
    assert fetched is None


@pytest.mark.asyncio
async def test_get_artifacts_empty(store: SessionStore) -> None:
    sess = await store.create_session()
    artifacts = await store.get_artifacts(sess["id"])
    assert artifacts == []


@pytest.mark.asyncio
async def test_artifacts_isolated_per_session(store: SessionStore) -> None:
    s1 = await store.create_session()
    s2 = await store.create_session()

    await store.add_artifact(s1["id"], "art_x", "widget", "A", "{}")
    await store.add_artifact(s2["id"], "art_y", "widget", "B", "{}")

    arts1 = await store.get_artifacts(s1["id"])
    arts2 = await store.get_artifacts(s2["id"])
    assert len(arts1) == 1
    assert len(arts2) == 1
    assert arts1[0]["id"] == "art_x"
    assert arts2[0]["id"] == "art_y"


@pytest.mark.asyncio
async def test_add_artifact_replaces_on_duplicate_id(store: SessionStore) -> None:
    sess = await store.create_session()
    sid = sess["id"]

    await store.add_artifact(sid, "art_dup", "widget", "Original", "{}")
    await store.add_artifact(sid, "art_dup", "html", "Updated", "<p>new</p>")

    artifacts = await store.get_artifacts(sid)
    assert len(artifacts) == 1
    assert artifacts[0]["title"] == "Updated"
    assert artifacts[0]["type"] == "html"
