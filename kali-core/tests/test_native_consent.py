"""Consent questions go to the desktop agent's card when it can show one."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from kali_core.desktop import DesktopBroker
from kali_core.server import Server

PAYLOAD = {"event": "consent_request", "id": "consent_1", "session_id": "s1", "tool": "run_command",
           "risk": "dangerous", "reason_key": "k", "reason_params": {"command": "df -h"}, "summary_key": "x"}


class Agent:
    def __init__(self, caps, fail=False):
        self.session_id = "s1"
        self.is_desktop = True
        self.desktop_capabilities = caps
        self.sent = []
        self.fail = fail

    async def send(self, payload):
        if self.fail:
            raise RuntimeError("socket closed")
        self.sent.append(payload)


def fake_server(broker):
    return SimpleNamespace(desktop_broker=broker, broadcast_session=AsyncMock())


class SendConsentTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_with_cards_gets_the_question_and_the_chat_is_told_not_to_draw_it(self):
        broker = DesktopBroker()
        agent = Agent(frozenset({"consent_ui", "local_consent"}))
        broker.register(agent)
        server = fake_server(broker)
        await Server._send_consent(server, dict(PAYLOAD))
        self.assertEqual(agent.sent[0]["native"], True)
        self.assertEqual(agent.sent[0]["reason_params"], {"command": "df -h"})
        web = server.broadcast_session.await_args.args[1]
        self.assertTrue(web["handled_by_agent"])

    async def test_agent_without_the_capability_leaves_the_chat_dialog(self):
        broker = DesktopBroker()
        agent = Agent(frozenset({"screenshot"}))
        broker.register(agent)
        server = fake_server(broker)
        await Server._send_consent(server, dict(PAYLOAD))
        self.assertEqual(agent.sent, [])
        self.assertNotIn("handled_by_agent", server.broadcast_session.await_args.args[1])

    async def test_legacy_agent_never_claims_cards(self):
        broker = DesktopBroker()
        broker.register(Agent(None))
        server = fake_server(broker)
        await Server._send_consent(server, dict(PAYLOAD))
        self.assertNotIn("handled_by_agent", server.broadcast_session.await_args.args[1])

    async def test_a_broken_agent_falls_back_to_the_chat(self):
        broker = DesktopBroker()
        broker.register(Agent(frozenset({"consent_ui"}), fail=True))
        server = fake_server(broker)
        await Server._send_consent(server, dict(PAYLOAD))
        self.assertNotIn("handled_by_agent", server.broadcast_session.await_args.args[1])

    async def test_no_agent_means_the_chat_dialog(self):
        server = fake_server(DesktopBroker())
        await Server._send_consent(server, dict(PAYLOAD))
        self.assertNotIn("handled_by_agent", server.broadcast_session.await_args.args[1])


if __name__ == "__main__":
    unittest.main()
