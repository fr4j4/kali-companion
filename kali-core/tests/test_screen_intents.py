"""Screen tools by intent: prompt, look_at_screen, suggest_capture and its server-side limits."""

import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from kali_core.claws.base import ToolContext
from kali_core.claws.screenshot import LookAtScreenTool
from kali_core.claws.suggest import (
    MAX_DECLINES, MAX_PER_SESSION, MIN_TURNS_BETWEEN, SuggestCaptureTool, SuggestionLimiter,
)
from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import ALWAYS_CONSENT_TOOLS, PermissionGateway
from kali_core.config import settings
from kali_core.desktop import DesktopBroker
from kali_core.mind.executor import Executor
from kali_core.mind.vision import VisionProcessor
from kali_core.server import _build_tool_defs, _register_tools
from kali_core import claws

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50


class Agent:
    def __init__(self, caps):
        self.session_id = "s1"
        self.is_desktop = True
        self.desktop_capabilities = caps
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


class PromptTests(unittest.TestCase):
    def test_no_mandatory_monitor_procedure(self):
        p = settings.llm_system_prompt
        self.assertNotIn("MONITOR PROCEDURE", p)
        self.assertNotIn('"sample": true', p)
        self.assertIn("look_at_screen", p)
        for tool in ("find_apps", "list_windows", "focus_window", "suggest_capture"):
            self.assertIn(tool, p)

    def test_model_sees_look_at_screen_not_the_old_name(self):
        _register_tools()
        names = {t.name for t in _build_tool_defs()}
        self.assertIn("look_at_screen", names)
        self.assertIn("suggest_capture", names)
        self.assertNotIn("screenshot", names)
        self.assertIsNotNone(claws.base.get("screenshot"))  # alias still executable

    def test_consent_is_mandatory_for_the_new_name(self):
        self.assertIn("look_at_screen", ALWAYS_CONSENT_TOOLS)
        tool = LookAtScreenTool()
        decision = PermissionGateway().check("look_at_screen", tool.risk_level, {}, "dev")
        self.assertTrue(decision.needs_consent)

    def test_battery_is_well_formed(self):
        rows = json.loads((Path(__file__).parent / "data" / "screen_intents.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(rows), 30)
        self.assertEqual({r["expect"] for r in rows}, {"region", "screen", "suggest", "none"})
        self.assertTrue(any(any(c in r["text"] for c in "áéíóñ¿") for r in rows))
        self.assertEqual(len({r["text"] for r in rows}), len(rows))


class VisionTests(unittest.IsolatedAsyncioTestCase):
    def test_question_reaches_the_prompt(self):
        self.assertIn("what does this error say", VisionProcessor._prompt("what does this error say"))
        self.assertIn("Describe what is on this screen", VisionProcessor._prompt(""))

    async def test_question_is_sent_to_the_model(self):
        llm = AsyncMock()
        llm.complete = AsyncMock(return_value={"text": "It says disk full"})
        text = await VisionProcessor(llm_provider=llm)._via_llm(PNG, "image/png", "qué dice el error")
        self.assertEqual(text, "It says disk full")
        content = llm.complete.await_args.args[0][0]["content"]
        self.assertIn("qué dice el error", content[0]["text"])


class LookAtScreenTests(unittest.IsolatedAsyncioTestCase):
    async def run_tool(self, params, gaze=None):
        gaze = gaze or AsyncMock(capture_full=AsyncMock(return_value=PNG))
        ctx = ToolContext(session_id="s", working_dir=".", profile="dev", gaze_client=gaze)
        with patch("kali_core.claws.screenshot.settings") as st, \
                patch("kali_core.mind.vision.VisionProcessor.process", new=AsyncMock(return_value="desc")) as vision:
            import tempfile
            with tempfile.TemporaryDirectory() as d:
                st.snapshots_dir = d
                result = await LookAtScreenTool().run(params, ctx)
        return result, gaze, vision

    async def test_region_is_the_default_and_the_question_reaches_vision(self):
        result, gaze, vision = await self.run_tool({"question": "qué dice esto", "reason": "leer el error"})
        gaze.capture_full.assert_awaited_once_with(output=None, reason="leer el error", region=True)
        self.assertEqual(vision.await_args.args[2], "qué dice esto")
        self.assertEqual(result.output["description"], "desc")

    async def test_screen_target_uses_the_monitor(self):
        _, gaze, _ = await self.run_tool({"target": "screen", "monitor": "secondary", "question": "q"})
        kwargs = gaze.capture_full.await_args.kwargs
        self.assertEqual(kwargs["output"], "secondary")
        self.assertNotIn("region", kwargs)

    async def test_errors_are_actionable(self):
        gaze = AsyncMock(capture_full=AsyncMock(side_effect=RuntimeError("Region capture needs the desktop agent (kali-avatar) on the user's machine.")))
        result, _, _ = await self.run_tool({}, gaze)
        self.assertIn("kali-avatar", result.error)
        self.assertIn("not connected", result.error)
        gaze = AsyncMock(capture_full=AsyncMock(side_effect=RuntimeError("Denied by the user")))
        result, _, _ = await self.run_tool({"target": "screen"}, gaze)
        self.assertIn("Do not insist", result.error)

    async def test_bad_target_is_rejected(self):
        result, _, _ = await self.run_tool({"target": "everything"})
        self.assertIn("target", result.error)

    async def test_executor_does_not_stack_a_core_card_on_the_agent_card(self):
        broker = DesktopBroker()
        agent = Agent(frozenset({"screenshot", "local_consent"}))
        broker.register(agent)
        consent = ConsentManager()
        consent.request = AsyncMock(return_value="deny")
        _register_tools()
        executor = Executor(PermissionGateway(), consent, profile="general", desktop_broker=broker)
        import asyncio
        task = asyncio.create_task(executor.execute("look_at_screen", {"target": "screen"}, "s1"))
        await asyncio.sleep(0.05)
        consent.request.assert_not_awaited()
        sent = agent.sent[0]
        self.assertEqual(sent["action"], "screenshot")
        broker.respond(agent, {"id": sent["id"], "ok": False, "error": "Denied by the user"})
        result = await task
        self.assertIn("Do not insist", result.error)

    async def test_without_an_agent_core_still_asks(self):
        consent = ConsentManager()
        consent.request = AsyncMock(return_value="deny")
        _register_tools()
        executor = Executor(PermissionGateway(), consent, profile="general", desktop_broker=DesktopBroker())
        await executor.execute("look_at_screen", {}, "s1")
        consent.request.assert_awaited_once()


class LimiterTests(unittest.TestCase):
    def setUp(self):
        self.lim = SuggestionLimiter()

    def turns(self, n):
        for _ in range(n):
            self.lim.note_user_turn("s")

    def test_spacing_between_suggestions(self):
        self.turns(1)
        self.assertIsNone(self.lim.check("s"))
        self.lim.register("s", "region")
        self.turns(MIN_TURNS_BETWEEN - 1)
        self.assertIsNotNone(self.lim.check("s"))
        self.turns(1)
        self.assertIsNone(self.lim.check("s"))

    def test_cap_per_conversation(self):
        for _ in range(MAX_PER_SESSION):
            self.turns(MIN_TURNS_BETWEEN)
            self.assertIsNone(self.lim.check("s"))
            self.lim.register("s", "screen")
        self.turns(MIN_TURNS_BETWEEN * 2)
        self.assertIn("limit", self.lim.check("s"))

    def test_decline_silences_then_two_declines_stop_it(self):
        self.turns(1)
        sid = self.lim.register("s", "region")
        self.assertTrue(self.lim.respond("s", sid, "dismiss"))
        self.assertFalse(self.lim.respond("s", sid, "dismiss"))  # answered once only
        self.turns(9)
        self.assertIsNotNone(self.lim.check("s"))
        self.turns(2)
        self.assertIsNone(self.lim.check("s"))
        sid = self.lim.register("s", "region")
        self.lim.respond("s", sid, "dismiss")
        self.turns(100)
        self.assertEqual(MAX_DECLINES, 2)
        self.assertIn("twice", self.lim.check("s"))

    def test_switch_off_and_unknown_ids(self):
        self.lim.enabled = False
        self.assertIn("off", self.lim.check("s"))
        self.assertFalse(self.lim.respond("s", "nope", "region"))

    def test_sessions_are_independent(self):
        self.lim.register("a", "region")
        self.assertIsNone(self.lim.check("b"))


class SuggestToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_emits_event_and_never_captures(self):
        lim = SuggestionLimiter()
        emit = AsyncMock()
        gaze = AsyncMock()
        ctx = ToolContext(session_id="s", working_dir=".", profile="dev", emit=emit, gaze_client=gaze)
        with patch("kali_core.claws.suggest.limiter", lim):
            result = await SuggestCaptureTool().run({"kind": "region", "reason": "x" * 300}, ctx)
            again = await SuggestCaptureTool().run({"kind": "screen", "reason": "otra vez"}, ctx)
        self.assertTrue(result.output["suggested"])
        event = emit.await_args.args[0]
        self.assertEqual((event["event"], event["kind"], len(event["reason"])), ("suggestion", "region", 120))
        self.assertTrue(event["id"].startswith("sug_"))
        gaze.capture_full.assert_not_called()
        self.assertFalse(again.output["suggested"])
        self.assertEqual(emit.await_count, 1)

    async def test_validation(self):
        ctx = ToolContext(session_id="s", working_dir=".", profile="dev", emit=AsyncMock())
        self.assertIn("kind", (await SuggestCaptureTool().run({"kind": "mouse", "reason": "x"}, ctx)).error)
        self.assertIn("reason", (await SuggestCaptureTool().run({"kind": "region"}, ctx)).error)

    def test_tool_is_safe_but_look_at_screen_is_not(self):
        self.assertEqual(SuggestCaptureTool.risk_level, "safe")
        self.assertEqual(LookAtScreenTool.risk_level, "sensitive")


class DescribeTests(unittest.TestCase):
    def test_lines(self):
        broker = DesktopBroker()
        self.assertEqual(broker.describe("s1"), "")
        self.assertIn("no desktop agent", broker.describe("s1", server_screen=False))
        broker.register(Agent(frozenset({"launch_app", "screenshot"})))
        line = broker.describe("s1")
        self.assertIn("open apps", line)
        self.assertIn("look at the screen", line)
        self.assertIn("Not supported here: search apps, list windows, focus windows", line)


if __name__ == "__main__":
    unittest.main()
