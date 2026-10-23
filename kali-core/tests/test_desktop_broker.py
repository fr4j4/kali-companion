"""Desktop capability routing and registration do not require a GUI."""

import asyncio
import unittest
from types import SimpleNamespace

from kali_core.desktop import DesktopBroker
from kali_core.server import Connection


class FakeConnection:
    def __init__(self, broker: DesktopBroker) -> None:
        self.broker = broker
        self.session_id = "session-a"
        self.is_desktop = True
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


class DesktopBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_only_accepts_response_from_own_connection(self):
        broker = DesktopBroker()
        owner = FakeConnection(broker)
        impostor = FakeConnection(broker)
        token = broker.activate(owner)
        try:
            task = asyncio.create_task(broker.request("session-a", "list_monitors", {}))
            await asyncio.sleep(0)
            request_id = owner.sent[0]["id"]
            broker.respond(impostor, {"id": request_id, "ok": True, "result": {"monitors": ["fake"]}})
            self.assertFalse(task.done())
            broker.respond(owner, {"id": request_id, "ok": True, "result": {"monitors": ["real"]}})
            self.assertEqual(await task, {"monitors": ["real"]})
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                await broker.request("session-b", "screenshot", {})
        finally:
            broker.reset(token)

    async def test_disconnect_fails_pending_request(self):
        broker = DesktopBroker()
        owner = FakeConnection(broker)
        token = broker.activate(owner)
        try:
            task = asyncio.create_task(broker.request("session-a", "screenshot", {}))
            await asyncio.sleep(0)
            broker.disconnect(owner)
            with self.assertRaisesRegex(RuntimeError, "disconnected"):
                await task
        finally:
            broker.reset(token)

    async def test_desktop_registration_requires_both_server_tokens(self):
        async def register(api_token, desktop_token, supplied):
            conn = object.__new__(Connection)
            conn.is_desktop = False
            conn.desktop_capabilities = None
            conn.server = SimpleNamespace(api_token=api_token, desktop_token=desktop_token, desktop_broker=DesktopBroker())
            sent = []

            async def send(payload):
                sent.append(payload)

            conn.send = send
            await conn.dispatch({"event": "desktop_register", "token": supplied})
            return conn.is_desktop, sent

        self.assertEqual(await register("api", "desktop", "desktop"), (True, [{"event": "desktop_registered", "ok": True, "capabilities": ["launch_app", "list_monitors", "screenshot"]}]))
        self.assertFalse((await register("api", "desktop", "wrong"))[0])
        self.assertFalse((await register("api", "desktop", "contraseña"))[0])
        self.assertFalse((await register("", "desktop", "desktop"))[0])
        self.assertFalse((await register("api", "", ""))[0])

    async def test_registered_agent_serves_turns_from_other_connections(self):
        broker = DesktopBroker()
        agent = FakeConnection(broker)
        agent.session_id = None  # presence agent following every session
        agent.desktop_capabilities = frozenset({"screenshot"})
        web = FakeConnection(broker)
        web.is_desktop = False
        web.session_id = "session-a"
        broker.register(agent)
        token = broker.activate(web)
        try:
            self.assertTrue(broker.has_desktop("session-a", "screenshot"))
            self.assertFalse(broker.has_desktop("session-a", "launch_app"))
            task = asyncio.create_task(broker.request("session-a", "screenshot", {}))
            await asyncio.sleep(0)
            self.assertEqual(agent.sent[0]["action"], "screenshot")
            broker.respond(agent, {"id": agent.sent[0]["id"], "ok": True, "result": {"png_base64": ""}})
            self.assertEqual(await task, {"png_base64": ""})
            broker.disconnect(agent)
            self.assertFalse(broker.has_desktop("session-a", "screenshot"))
        finally:
            broker.reset(token)

    async def test_presence_mirror_strips_audio_and_skips_clients(self):
        from kali_core.server import Server

        class Conn(FakeConnection):
            def __init__(self, broker, mode, sid):
                super().__init__(broker)
                self.mode = mode
                self.session_id = sid

        broker = DesktopBroker()
        presence, other_session, client = Conn(broker, "presence", "s1"), Conn(broker, "presence", "s2"), Conn(broker, "client", "s1")
        server = object.__new__(Server)
        server._connections = [presence, other_session, client]
        server.last_active_session = None
        await Server.mirror_presence(server, "s1", {"event": "tts_audio", "audio": "AAAA", "duration": 1.5})
        await Server.mirror_presence(server, "s1", {"event": "artifact", "content": "x"})
        self.assertEqual(presence.sent, [{"event": "tts_audio", "duration": 1.5, "session_id": "s1"}])
        self.assertEqual(other_session.sent, [])
        self.assertEqual(client.sent, [])
        self.assertEqual(server.last_active_session, "s1")
