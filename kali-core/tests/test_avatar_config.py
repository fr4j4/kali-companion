"""Avatar appearance is stored once in the core and fanned out to every connection."""

import json
import os
import tempfile
import unittest
from types import SimpleNamespace

from kali_core import avatar_config
from kali_core.server import Connection, Server


class FakeConn:
    def __init__(self, mode="client"):
        self.mode = mode
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


class AvatarConfigTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["KALI_AVATAR_CONFIG"] = os.path.join(self.tmp.name, "avatar.json")
        self.addCleanup(lambda: os.environ.pop("KALI_AVATAR_CONFIG", None))
        self.addCleanup(self.tmp.cleanup)

    def test_sanitize_rejects_non_dict_and_oversized(self):
        self.assertIsNone(avatar_config.sanitize("x"))
        self.assertIsNone(avatar_config.sanitize({"a": "x" * avatar_config.MAX_BYTES}))
        self.assertEqual(avatar_config.sanitize({"species": "gato"}), {"species": "gato"})

    def test_save_and_load_roundtrip(self):
        self.assertIsNone(avatar_config.load())
        avatar_config.save({"species": "perro"})
        self.assertEqual(avatar_config.load(), {"species": "perro"})

    async def test_set_persists_and_broadcasts_to_every_connection(self):
        server = SimpleNamespace(avatar_config=None, _connections=[FakeConn(), FakeConn("presence")])

        async def broadcast(payload):
            for conn in server._connections:
                await conn.send(payload)

        server.broadcast = broadcast
        ok = await Server.set_avatar_config(server, {"species": "erizo"})
        self.assertTrue(ok)
        self.assertEqual(server.avatar_config, {"species": "erizo"})
        for conn in server._connections:
            self.assertEqual(conn.sent, [{"event": "avatar_config", "config": {"species": "erizo"}}])
        self.assertEqual(json.loads(avatar_config.config_path().read_text()), {"species": "erizo"})
        self.assertFalse(await Server.set_avatar_config(server, ["bad"]))

    async def test_connection_sends_stored_config_only_when_present(self):
        sent = []

        async def send(payload):
            sent.append(payload)

        conn = SimpleNamespace(server=SimpleNamespace(avatar_config=None), send=send)
        await Connection._send_avatar_config(conn)
        self.assertEqual(sent, [])
        await Connection._send_avatar_config(conn, always=True)
        self.assertEqual(sent, [{"event": "avatar_config", "config": None}])
        sent.clear()
        conn.server.avatar_config = {"species": "gato"}
        await Connection._send_avatar_config(conn)
        self.assertEqual(sent, [{"event": "avatar_config", "config": {"species": "gato"}}])


if __name__ == "__main__":
    unittest.main()
