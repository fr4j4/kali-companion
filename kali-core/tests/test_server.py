"""End-to-end server test with a mock LLM provider.

Verifies the full Phase 1A flow: input → agent → delta events → TTS
synthesis → tts_audio events → turn_end. Uses a fake LLM that streams a
canned reply so no real API key or network is needed.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import tempfile
from collections.abc import AsyncIterator

import pytest
import websockets
from fastapi.testclient import TestClient

from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import PermissionGateway
from kali_core.config import settings
from kali_core.mind.executor import Executor
from kali_core.mind.llm.provider import StreamEvent, ToolDef
from kali_core.mind.console_requester import ConsoleRequester
from kali_core.mind.connections_store import ConnectionsStore
from kali_core.mind.runtime import AgentRuntime
from kali_core.nest.store import SessionStore
from kali_core.server import Server
from kali_core.voice.pipeline import TTSPipeline
from kali_core.voice.providers.inproc import InProcTTSProvider
from kali_core.voice.voice_config import VoiceConfigManager


class FakeLLMProvider:
    """LLM that streams a fixed reply without any network call."""

    provider_name = "fake"

    def __init__(self) -> None:
        self._model = "fake-model"

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        reply = "Hola. Soy Kali, tu companera."
        for word in reply.split():
            yield StreamEvent(kind="delta", text=word + " ")
        yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        return {"text": "Hola. Soy Kali, tu companera."}


class FakeReasoningLLMProvider:
    """LLM that emits a reasoning event before deltas."""

    provider_name = "fake-reasoning"

    def __init__(self) -> None:
        self._model = "fake-model"

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        yield StreamEvent(kind="reasoning", text="Analyzing the question...")
        yield StreamEvent(kind="delta", text="Hello.")
        yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        return {"text": "Hello."}


@pytest.fixture
def server() -> Server:
    s = Server.__new__(Server)
    s.host = "127.0.0.1"
    s.port = 0
    s.app = __import__("fastapi").FastAPI(title="Kali Core Test")
    s.llm_provider = FakeLLMProvider()
    s.tts_provider = InProcTTSProvider()
    s.agent = AgentRuntime(s.llm_provider)
    s.tts_pipeline = TTSPipeline(
        s.tts_provider, voice="robot-es", mode="robotic", auto_tts=True
    )
    s.voice_configs = VoiceConfigManager(settings.voice_configs_dir)
    s.gateway = PermissionGateway()
    s.consent = ConsentManager()
    s.gaze_client = type("FakeGaze", (), {"connected": False})()
    s.executor = Executor(gateway=s.gateway, consent=s.consent, working_dir=".", profile="dev")
    s.agent.set_executor(s.executor)
    s.agent.set_tools([])
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as _tmp_db:
        s.session_store = SessionStore(_tmp_db.name)
    from kali_core.nest.job_store import JobStore
    from kali_core.mind.jobs import JobManager
    s.job_store = JobStore(_tmp_db.name)
    s.job_mgr = JobManager(s.job_store)
    s._register_routes()
    s._connections = []
    s._config_warnings = {}
    s.tts_available = True
    s.tts_error = None
    s.stt_available = True
    s.stt_error = None
    s.connections_store = ConnectionsStore()
    s.console_requester = ConsoleRequester()
    s.agent.set_session_store(s.session_store)
    return s


def test_health(server: Server):
    client = TestClient(server.app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_profiles(server: Server):
    client = TestClient(server.app)
    resp = client.get("/profiles")
    assert resp.status_code == 200
    data = resp.json()
    assert "profiles" in data
    ids = [p["id"] for p in data["profiles"]]
    assert "dev" in ids
    assert "general" in ids


@pytest.mark.asyncio
@pytest.mark.skip(reason="websockets 16.0 + Python 3.14 event loop incompatibility in uvicorn 0.49")
async def test_ws_full_flow(server: Server):
    """Connect, send hello + input, expect delta + tts_audio + turn_end."""
    import uvicorn

    config = uvicorn.Config(server.app, host="127.0.0.1", port=0, log_level="error")
    instance = uvicorn.Server(config)
    server_task = asyncio.create_task(instance.serve())
    try:
        await asyncio.sleep(0.3)
        port = list(instance.servers)[0].sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}/ws"

        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"event": "hello", "client": "test", "version": "0.1.0"}))
            ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert ready["event"] == "ready"
            assert "session_id" in ready

            await ws.send(json.dumps({"event": "input", "content": "hola", "source": "text"}))

            saw_delta = False
            saw_tts = False
            saw_turn_end = False
            deadline = asyncio.get_event_loop().time() + 15
            while asyncio.get_event_loop().time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                except TimeoutError:
                    break
                if msg["event"] == "delta":
                    saw_delta = True
                elif msg["event"] == "tts_audio":
                    saw_tts = True
                    assert len(msg["audio"]) > 100
                    decoded = base64.b64decode(msg["audio"])
                    assert decoded[:4] == b"RIFF"
                elif msg["event"] == "turn_end":
                    saw_turn_end = True
                    break

            assert saw_delta, "did not receive any delta events"
            assert saw_tts, "did not receive any tts_audio events"
            assert saw_turn_end, "did not receive turn_end"
    finally:
        instance.should_exit = True
        server_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, SystemExit):
            await server_task


@pytest.mark.asyncio
@pytest.mark.skip(reason="websockets 16.0 + Python 3.14 event loop incompatibility in uvicorn 0.49")
async def test_attach_session(server: Server):
    """Connect, send input, then attach to the same session and verify replay."""
    import uvicorn

    config = uvicorn.Config(server.app, host="127.0.0.1", port=0, log_level="error")
    instance = uvicorn.Server(config)
    server_task = asyncio.create_task(instance.serve())
    try:
        await asyncio.sleep(0.3)
        port = list(instance.servers)[0].sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}/ws"

        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"event": "hello", "client": "test", "version": "0.1.0"}))
            ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert ready["event"] == "ready"
            sid = ready["session_id"]

            await ws.send(json.dumps({"event": "input", "content": "hola", "source": "text"}))

            deadline = asyncio.get_event_loop().time() + 15
            while asyncio.get_event_loop().time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                except TimeoutError:
                    break
                if msg["event"] == "turn_end":
                    break

            # List sessions and attach to this one.
            await ws.send(json.dumps({"event": "list_sessions"}))
            session_list = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert session_list["event"] == "session_list"
            assert len(session_list["sessions"]) >= 1

            await ws.send(json.dumps({"event": "attach_session", "session_id": sid}))
            connected = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert connected["event"] == "connected"
            assert connected["session_id"] == sid

            # Should receive replayed messages.
            replayed = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert replayed["event"] == "message"
            assert replayed["session_id"] == sid
            assert replayed["role"] == "user"
            assert replayed["text"] == "hola"

            replayed2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert replayed2["event"] == "message"
            assert replayed2["role"] == "assistant"
    finally:
        instance.should_exit = True
        server_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, SystemExit):
            await server_task


@pytest.mark.asyncio
@pytest.mark.skip(reason="websockets 16.0 + Python 3.14 event loop incompatibility in uvicorn 0.49")
async def test_reasoning_delta(server: Server):
    """Verify reasoning_delta events are emitted before deltas."""
    import uvicorn

    # Swap in the reasoning LLM provider.
    server.llm_provider = FakeReasoningLLMProvider()
    server.agent = AgentRuntime(server.llm_provider)
    server.agent.set_executor(server.executor)
    server.agent.set_tools([])

    config = uvicorn.Config(server.app, host="127.0.0.1", port=0, log_level="error")
    instance = uvicorn.Server(config)
    server_task = asyncio.create_task(instance.serve())
    try:
        await asyncio.sleep(0.3)
        port = list(instance.servers)[0].sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}/ws"

        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"event": "hello", "client": "test", "version": "0.1.0"}))
            ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert ready["event"] == "ready"

            await ws.send(json.dumps({"event": "input", "content": "hello", "source": "text"}))

            saw_reasoning = False
            saw_delta = False
            saw_turn_end = False
            reasoning_text = ""
            deadline = asyncio.get_event_loop().time() + 15
            while asyncio.get_event_loop().time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                except TimeoutError:
                    break
                if msg["event"] == "reasoning_delta":
                    saw_reasoning = True
                    reasoning_text += msg["text"]
                elif msg["event"] == "delta":
                    saw_delta = True
                elif msg["event"] == "turn_end":
                    saw_turn_end = True
                    break

            assert saw_reasoning, "did not receive reasoning_delta"
            assert reasoning_text == "Analyzing the question...", reasoning_text
            assert saw_delta, "did not receive delta"
            assert saw_turn_end, "did not receive turn_end"
    finally:
        instance.should_exit = True
        server_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, SystemExit):
            await server_task


@pytest.mark.asyncio
@pytest.mark.skip(reason="websockets 16.0 + Python 3.14 event loop incompatibility in uvicorn 0.49")
async def test_tts_speak(server: Server):
    """Verify tts_speak event generates TTS audio without going through the full agent flow."""
    import uvicorn

    config = uvicorn.Config(server.app, host="127.0.0.1", port=0, log_level="error")
    instance = uvicorn.Server(config)
    server_task = asyncio.create_task(instance.serve())
    try:
        await asyncio.sleep(0.3)
        port = list(instance.servers)[0].sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}/ws"

        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"event": "hello", "client": "test", "version": "0.1.0"}))
            ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert ready["event"] == "ready"

            await ws.send(json.dumps({"event": "tts_speak", "text": "Hola desde debug"}))

            saw_tts = False
            deadline = asyncio.get_event_loop().time() + 15
            while asyncio.get_event_loop().time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                except TimeoutError:
                    break
                if msg["event"] == "tts_audio":
                    saw_tts = True
                    assert len(msg["audio"]) > 100
                    decoded = base64.b64decode(msg["audio"])
                    assert decoded[:4] == b"RIFF"
                elif msg["event"] == "turn_end":
                    break

            assert saw_tts, "did not receive any tts_audio events"
    finally:
        instance.should_exit = True
        server_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, SystemExit):
            await server_task