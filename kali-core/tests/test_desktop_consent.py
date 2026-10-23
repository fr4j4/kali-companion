"""The core does not stack a second consent card on an agent that asks the user itself."""

import asyncio
import unittest
from unittest.mock import AsyncMock

from kali_core.claws.launcher import rank_apps
from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import PermissionGateway
from kali_core.desktop import DesktopBroker
from kali_core.mind.executor import Executor
from kali_core.server import _register_tools


class FakeAgent:
    def __init__(self, caps):
        self.session_id = "s1"
        self.is_desktop = True
        self.desktop_capabilities = caps
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


def make_executor(broker):
    consent = ConsentManager()
    consent.request = AsyncMock(return_value="deny")
    _register_tools()
    return Executor(PermissionGateway(), consent, profile="general", desktop_broker=broker), consent


class BrokerTests(unittest.TestCase):
    def test_only_explicit_local_consent_counts(self):
        broker = DesktopBroker()
        agent = FakeAgent(frozenset({"screenshot", "local_consent"}))
        broker.register(agent)
        self.assertTrue(broker.enforces_consent("s1", "screenshot"))
        legacy = FakeAgent(None)
        broker.unregister(agent)
        broker.register(legacy)
        self.assertFalse(broker.enforces_consent("s1", "screenshot"))
        broker.unregister(legacy)
        self.assertFalse(broker.enforces_consent("s1", "screenshot"))

    def test_agent_without_the_capability_keeps_core_consent(self):
        broker = DesktopBroker()
        broker.register(FakeAgent(frozenset({"screenshot"})))
        self.assertFalse(broker.enforces_consent("s1", "screenshot"))


class ExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_core_still_asks_without_a_consent_enforcing_agent(self):
        executor, consent = make_executor(DesktopBroker())
        result = await executor.execute("screenshot", {}, "s1")
        consent.request.assert_awaited_once()
        self.assertIn("denied", result.error)

    async def test_core_does_not_ask_when_the_agent_does(self):
        broker = DesktopBroker()
        agent = FakeAgent(frozenset({"screenshot", "launch_app", "local_consent"}))
        broker.register(agent)
        executor, consent = make_executor(broker)
        task = asyncio.create_task(executor.execute("launch_app", {"name": "firefox"}, "s1"))
        await asyncio.sleep(0.05)
        consent.request.assert_not_awaited()
        sent = agent.sent[0]
        self.assertEqual((sent["action"], sent["params"]), ("launch_app", {"name": "firefox"}))
        broker.respond(agent, {"id": sent["id"], "ok": False, "error": "Denied by the user"})
        result = await task
        self.assertIn("Denied by the user", result.error)


class RankAppsTests(unittest.TestCase):
    APPS = [
        {"id": "org.mozilla.firefox", "name": "Firefox", "generic": "Web Browser", "keywords": "internet;", "categories": "Network;"},
        {"id": "org.kde.dolphin", "name": "Dolphin", "generic": "File Manager", "keywords": "files;", "categories": "System;"},
    ]

    def test_matches_by_name_purpose_and_requires_every_word(self):
        self.assertEqual(rank_apps(self.APPS, "firefox")[0]["id"], "org.mozilla.firefox")
        self.assertEqual(rank_apps(self.APPS, "file manager")[0]["id"], "org.kde.dolphin")
        self.assertEqual(rank_apps(self.APPS, "firefox dolphin"), [])
        self.assertEqual(rank_apps(self.APPS, " "), [])
