"""Core pieces of the v2 canvas.

Covers:
- registry: the new window types, group and progress on the wire.
- create_artifact: the new structured types and their shape check, a code
  artifact with several files, task groups.
- suggestions on a document: add / decide / prune / wire format, the
  update_artifact suggestion mode, and the user's decision from the canvas.
- consent: the question names the window it belongs to (artifact or
  terminal session), and the executor resolves the terminal of a command.
- memory recall event when a conversation is loaded.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from kali_core.canvas import suggestions as sug
from kali_core.canvas.registry import (
    NON_STREAMABLE_TYPES,
    ArtifactEnvelope,
    is_streamable_type,
    resolve_window_type,
)
from kali_core.claws.base import ToolContext
from kali_core.claws.create_artifact import CreateArtifactTool, group_id
from kali_core.claws.manage_artifacts import GetArtifactTool, UpdateArtifactTool
from kali_core.collar.consent import ConsentManager
from kali_core.nest.store import SessionStore

NEW_TYPES = ("sources", "slides", "tasks", "notes", "calendar", "pdf")


@pytest_asyncio.fixture
async def store() -> SessionStore:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name
    s = SessionStore(db_path)
    yield s
    Path(db_path).unlink(missing_ok=True)


def _ctx(store: SessionStore | None = None) -> ToolContext:
    return ToolContext(session_id="sess_test", working_dir=".", profile="dev", session_store=store)


DOC = "# Informe\n\nLas ventas subieron un 12% en marzo.\n\nEl equipo creció a 8 personas.\n"


async def _seed_doc(store: SessionStore, content: str = DOC, art_type: str = "markdown", window_type: str = "document") -> str:
    await store.add_artifact("sess_test", "art_doc", art_type, "Informe", content, window_type)
    return "art_doc"


# ── registry ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("t", NEW_TYPES)
def test_new_types_are_windows_and_not_streamed(t: str) -> None:
    assert t in NON_STREAMABLE_TYPES
    assert not is_streamable_type(t)
    assert resolve_window_type(t) == t


def test_domain_aliases_map_to_new_windows() -> None:
    assert resolve_window_type("research") == "sources"
    assert resolve_window_type("deck") == "slides"
    assert resolve_window_type("kanban") == "tasks"
    assert resolve_window_type("agenda") == "calendar"


def test_payload_carries_group_and_clamped_progress() -> None:
    env = ArtifactEnvelope(type="widget", title="T", content="{}", window_type="tasks")
    plain = env.to_payload()
    assert "group" not in plain and "progress" not in plain
    env.group, env.group_title, env.progress = "portada", "Portada", 1.7
    p = env.to_payload()
    assert p["group"] == "portada" and p["group_title"] == "Portada"
    assert p["progress"] == 1.0
    env.progress = -0.2
    assert env.to_payload()["progress"] == 0.0


# ── create_artifact ───────────────────────────────────────────────────────


VALID = {
    "sources": {"question": "¿?", "sources": [{"title": "A", "site": "x.org", "claim": "c"}], "synthesis": "s"},
    "slides": {"slides": [{"title": "Uno"}]},
    "tasks": {"tasks": [{"title": "Hacer", "status": "todo", "owner": "you"}]},
    "notes": {"notes": [{"title": "Nota"}]},
    "calendar": {"week_of": "2026-10-19", "events": []},
    "pdf": {"url": "https://example.org/a.pdf"},
}


@pytest.mark.asyncio
@pytest.mark.parametrize("t", NEW_TYPES)
async def test_create_new_types(t: str) -> None:
    res = await CreateArtifactTool().run({"artifact_type": t, "title": "X", "content": json.dumps(VALID[t])}, _ctx())
    assert res.error is None, res.error
    assert res.artifact["windowType"] == t


@pytest.mark.asyncio
@pytest.mark.parametrize("t,bad", [
    ("tasks", {"items": []}),
    ("slides", []),
    ("pdf", {"pages": 3}),
    ("calendar", {"events": "lunes"}),
])
async def test_create_rejects_wrong_shape(t: str, bad) -> None:
    res = await CreateArtifactTool().run({"artifact_type": t, "title": "X", "content": json.dumps(bad)}, _ctx())
    assert res.error and "Expected:" in res.error


@pytest.mark.asyncio
async def test_create_needs_content_or_files() -> None:
    res = await CreateArtifactTool().run({"artifact_type": "document", "title": "X"}, _ctx())
    assert res.error == "Missing 'content' parameter."


@pytest.mark.asyncio
async def test_create_code_with_files() -> None:
    files = [
        {"path": "./src/app.py", "content": "print(1)\n", "status": "M", "changed": [1, 0, "x"]},
        {"path": ".gitignore", "content": "venv/\n", "language": "text"},
    ]
    res = await CreateArtifactTool().run({"artifact_type": "code", "title": "Proyecto", "files": files}, _ctx())
    assert res.error is None
    assert res.output["files"] == 2
    data = json.loads(res.artifact["content"])
    assert data["files"][0] == {"path": "src/app.py", "code": "print(1)\n", "status": "M", "changed": [1]}
    assert data["files"][1]["path"] == ".gitignore"


@pytest.mark.asyncio
async def test_create_files_errors() -> None:
    tool = CreateArtifactTool()
    res = await tool.run({"artifact_type": "document", "title": "X", "files": [{"path": "a", "content": ""}]}, _ctx())
    assert "only for artifact_type 'code'" in res.error
    res = await tool.run({"artifact_type": "code", "title": "X", "files": [{"path": "a", "content": ""}, {"path": "./a", "content": ""}]}, _ctx())
    assert "Duplicate" in res.error
    res = await tool.run({"artifact_type": "code", "title": "X", "files": []}, _ctx())
    assert "non-empty" in res.error


@pytest.mark.asyncio
async def test_create_with_group() -> None:
    res = await CreateArtifactTool().run(
        {"artifact_type": "document", "title": "X", "content": "hola", "group": "Portada del sitio"}, _ctx())
    assert res.artifact["group"] == "portada-del-sitio"
    assert res.artifact["group_title"] == "Portada del sitio"
    assert res.output["group"] == "Portada del sitio"


def test_group_id() -> None:
    assert group_id("Diseño Ñandú 2") == "diseno-nandu-2"
    assert group_id("¡¡!!") == "task"
    assert len(group_id("a" * 100)) == 48


# ── suggestions ───────────────────────────────────────────────────────────


def test_add_validates_and_numbers() -> None:
    pending, err = sug.add(DOC, [], [{"old": "12%", "new": "14%", "note": "  Dato de abril  "}])
    assert err == ""
    assert pending == [{"id": "sug_1", "old": "12%", "new": "14%", "note": "Dato de abril"}]
    pending, err = sug.add(DOC, pending, [{"old": "8 personas", "new": "nueve personas"}])
    assert pending[-1]["id"] == "sug_2"
    _, err = sug.add(DOC, pending, [{"old": "12%", "new": "x"}])
    assert "overlaps" in err
    _, err = sug.add(DOC, [], [{"old": "no está", "new": "x"}])
    assert "not found" in err
    _, err = sug.add("a a", [], [{"old": "a", "new": "b"}])
    assert "2 times" in err
    _, err = sug.add(DOC, [], [])
    assert "non-empty" in err


def test_add_caps_pending() -> None:
    text = " ".join(f"w{i}." for i in range(40))
    pending, err = sug.add(text, [], [{"old": f"w{i}.", "new": "x"} for i in range(sug.MAX_PENDING)])
    assert err == "" and len(pending) == sug.MAX_PENDING
    _, err = sug.add(text, pending, [{"old": "w35.", "new": "x"}])
    assert "Too many" in err


def test_decide_accept_discard_and_unknown() -> None:
    pending, _ = sug.add(DOC, [], [{"old": "12%", "new": "14%"}, {"old": "8 personas", "new": "9 personas"}])
    content, rest, found = sug.decide(DOC, pending, "sug_1", "accept")
    assert "14%" in content and found["id"] == "sug_1"
    assert [s["id"] for s in rest] == ["sug_2"]
    content2, rest2, _ = sug.decide(content, rest, "sug_2", "discard")
    assert content2 == content and rest2 == []
    same, again, none = sug.decide(content, rest, "sug_9", "accept")
    assert none is None and same == content and again == rest


def test_decide_drops_suggestions_whose_text_went_away() -> None:
    text = "uno dos tres"
    pending = [{"id": "sug_1", "old": "uno dos", "new": "1 2"}, {"id": "sug_2", "old": "dos tres", "new": "2 3"}]
    content, rest, _ = sug.decide(text, pending, "sug_1", "accept")
    assert content == "1 2 tres" and rest == []


def test_load_wire_and_prune() -> None:
    assert sug.load(None) == [] and sug.load("{") == [] and sug.load('{"a":1}') == []
    assert sug.load('[{"id":"sug_1","old":"a","new":"b"},{"id":2}]') == [{"id": "sug_1", "old": "a", "new": "b"}]
    assert sug.wire_content("hola", []) == "hola"
    wire = json.loads(sug.wire_content("hola", [{"id": "sug_1", "old": "hola", "new": "adiós"}]))
    assert wire["content"] == "hola" and wire["suggestions"][0]["new"] == "adiós"
    assert sug.prune("adiós", [{"id": "sug_1", "old": "hola", "new": "x"}]) == []
    assert sug.can_suggest("markdown", "document") and not sug.can_suggest("code", "code")


@pytest.mark.asyncio
async def test_update_artifact_suggestion_mode(store: SessionStore) -> None:
    aid = await _seed_doc(store)
    tool = UpdateArtifactTool()
    res = await tool.run({"artifact_id": aid, "suggestions": [{"old": "12%", "new": "14%", "note": "abril"}]}, _ctx(store))
    assert res.error is None
    assert res.output["mode"] == "suggest" and res.output["pending_suggestions"] == 1
    wire = json.loads(res.artifact["content"])
    assert wire["content"] == DOC and wire["suggestions"][0]["id"] == "sug_1"
    art = await store.get_artifact("sess_test", aid)
    assert art["content"] == DOC
    assert sug.load(art["suggestions"])[0]["old"] == "12%"

    got = await GetArtifactTool().run({"artifact_id": aid}, _ctx(store))
    assert got.output["pending_suggestions"][0]["new"] == "14%"


@pytest.mark.asyncio
async def test_update_artifact_suggestion_mode_errors(store: SessionStore) -> None:
    aid = await _seed_doc(store)
    tool = UpdateArtifactTool()
    res = await tool.run({"artifact_id": aid, "suggestions": [{"old": "12%", "new": "x"}], "content": "otro"}, _ctx(store))
    assert "only 'suggestions'" in res.error
    res = await tool.run({"artifact_id": aid, "suggestions": [{"old": "nada", "new": "x"}]}, _ctx(store))
    assert "not found" in res.error
    await store.add_artifact("sess_test", "art_code", "code", "C", "x = 1", "code")
    res = await tool.run({"artifact_id": "art_code", "suggestions": [{"old": "x", "new": "y"}]}, _ctx(store))
    assert "only for documents" in res.error


@pytest.mark.asyncio
async def test_patch_prunes_pending_suggestions(store: SessionStore) -> None:
    aid = await _seed_doc(store, art_type="document")
    tool = UpdateArtifactTool()
    await tool.run({"artifact_id": aid, "suggestions": [{"old": "12%", "new": "14%"}, {"old": "8 personas", "new": "9"}]}, _ctx(store))
    res = await tool.run({"artifact_id": aid, "old_string": "un 12% en marzo", "new_string": "bastante"}, _ctx(store))
    assert res.error is None
    wire = json.loads(res.artifact["content"])
    assert [s["id"] for s in wire["suggestions"]] == ["sug_2"]
    art = await store.get_artifact("sess_test", aid)
    assert [s["id"] for s in sug.load(art["suggestions"])] == ["sug_2"]

    # A full rewrite that drops the last suggested text leaves plain text.
    res = await tool.run({"artifact_id": aid, "content": "Otro texto."}, _ctx(store))
    assert res.artifact["content"] == "Otro texto."
    assert sug.load((await store.get_artifact("sess_test", aid))["suggestions"]) == []


@pytest.mark.asyncio
async def test_canvas_decision_applies_and_broadcasts(store: SessionStore) -> None:
    from kali_core.server import Connection

    aid = await _seed_doc(store)
    await UpdateArtifactTool().run({"artifact_id": aid, "suggestions": [{"old": "12%", "new": "14%"}]}, _ctx(store))
    server = SimpleNamespace(session_store=store, broadcast_session=AsyncMock())
    conn = SimpleNamespace(session_id="sess_test", server=server)

    await Connection._handle_artifact_suggestion(conn, {"artifact_id": aid, "suggestion_id": "sug_1", "decision": "accept"})
    art = await store.get_artifact("sess_test", aid)
    assert "14%" in art["content"] and sug.load(art["suggestions"]) == []
    sent = server.broadcast_session.await_args.args[1]
    assert sent["update"] == "update" and sent["content"] == art["content"]

    # An unknown or repeated decision changes nothing and sends nothing.
    server.broadcast_session.reset_mock()
    await Connection._handle_artifact_suggestion(conn, {"artifact_id": aid, "suggestion_id": "sug_1", "decision": "accept"})
    await Connection._handle_artifact_suggestion(conn, {"artifact_id": aid, "suggestion_id": "sug_1", "decision": "maybe"})
    server.broadcast_session.assert_not_awaited()


# ── consent and memory ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_consent_payload_names_its_window() -> None:
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    consent = ConsentManager(send_callback=capture, timeout=2)
    task = asyncio.create_task(consent.request(
        session_id="s", tool="run_command", reason_key="r", reason_params={},
        artifact_id="art_1", terminal_session_id="ts_1",
    ))
    while not sent:
        await asyncio.sleep(0)
    assert sent[0]["artifact_id"] == "art_1" and sent[0]["terminal_session_id"] == "ts_1"
    consent.respond(sent[0]["id"], "allow")
    assert await task == "allow"

    sent.clear()
    task = asyncio.create_task(consent.request(session_id="s", tool="t", reason_key="r", reason_params={}))
    while not sent:
        await asyncio.sleep(0)
    assert "artifact_id" not in sent[0] and "terminal_session_id" not in sent[0]
    consent.respond(sent[0]["id"], "deny")
    assert await task == "deny"


@pytest.mark.asyncio
async def test_executor_resolves_the_command_terminal(store: SessionStore) -> None:
    from kali_core.collar.gateway import PermissionGateway
    from kali_core.mind.executor import Executor

    ex = Executor(PermissionGateway(), ConsentManager(), session_store=store)
    params: dict = {"command": "ls"}
    aid, tsid = await ex._consent_origin("run_command", params, "sess_test")
    assert aid == "" and tsid and params["terminal_session_id"] == tsid
    again: dict = {"command": "pwd"}
    assert (await ex._consent_origin("run_command", again, "sess_test"))[1] == tsid

    given = {"command": "ls", "terminal_session_id": "ts_x"}
    assert await ex._consent_origin("run_command", given, "sess_test") == ("", "ts_x")
    other = {"artifact_id": "art_9", "path": "a"}
    assert await ex._consent_origin("fs_write", other, "sess_test") == ("art_9", "")
    assert "terminal_session_id" not in other


@pytest.mark.asyncio
async def test_memory_recall_event() -> None:
    from kali_core.server import Connection

    conn = SimpleNamespace(send=AsyncMock())
    await Connection._send_memory_recall(conn, "sess_1", 12)
    conn.send.assert_awaited_once_with({"event": "memory_event", "session_id": "sess_1", "action": "recall", "count": 12})
