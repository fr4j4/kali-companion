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
            conn.server = SimpleNamespace(api_token=api_token, desktop_token=desktop_token)
            sent = []

            async def send(payload):
                sent.append(payload)

            conn.send = send
            await conn.dispatch({"event": "desktop_register", "token": supplied})
            return conn.is_desktop, sent

        self.assertEqual(await register("api", "desktop", "desktop"), (True, [{"event": "desktop_registered", "ok": True}]))
        self.assertFalse((await register("api", "desktop", "wrong"))[0])
        self.assertFalse((await register("api", "desktop", "contraseña"))[0])
        self.assertFalse((await register("", "desktop", "desktop"))[0])
        self.assertFalse((await register("api", "", ""))[0])
