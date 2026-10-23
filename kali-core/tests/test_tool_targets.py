"""Tools that can run on the server or on the user's PC: routing, labels, consent, no silent fallback."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from kali_core import claws, targets
from kali_core.claws.system_info import SystemInfoTool, parse_cgroup_limit, parse_cpuinfo, parse_meminfo
from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import PermissionGateway
from kali_core.desktop import DesktopBroker
from kali_core.mind.executor import Executor
from kali_core.server import _build_tool_defs, _register_tools

EITHER = ("system_info", "run_command", "fs_read", "fs_list")
FULL_CAPS = frozenset({*EITHER, "launch_app", "screenshot", "local_consent", "consent_ui"})


class Agent:
    def __init__(self, caps=FULL_CAPS, host="minigun"):
        self.session_id = "s1"
        self.is_desktop = True
        self.desktop_capabilities = caps
        self.desktop_hostname = host
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


def make_executor(agent=None, local=False, consent_answer="deny", profile="dev"):
    broker = DesktopBroker()
    if agent is not None:
        broker.register(agent)
    consent = ConsentManager()
    consent.request = AsyncMock(return_value=consent_answer)
    _register_tools()
    executor = Executor(PermissionGateway(), consent, profile=profile, desktop_broker=broker, local_mode=local)
    return executor, broker, consent


async def serve(executor, broker, agent, tool, params, result=None, error=None):
    """Run a tool and answer the agent's request, like kali-avatar would."""
    emitted = []

    async def emit(event):
        emitted.append(event)

    task = asyncio.create_task(executor.execute(tool, params, "s1", emit_event=emit))
    for _ in range(50):
        await asyncio.sleep(0.01)
        if agent.sent:
            break
    if agent.sent:
        sent = agent.sent[-1]
        reply = {"id": sent["id"], "ok": error is None}
        reply.update({"error": error} if error else {"result": result or {}})
        broker.respond(agent, reply)
    return await task, emitted


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        _register_tools()

    def test_target_is_offered_exactly_where_both_machines_make_sense(self):
        for tool in _build_tool_defs():
            if targets.where_for(tool.name) == targets.DESKTOP:
                continue  # look_at_screen has its own `target` (region or screen), unrelated to machines
            has_target = "target" in tool.schema.get("properties", {})
            self.assertEqual(has_target, targets.where_for(tool.name) == targets.EITHER, tool.name)

    def test_the_four_machine_tools_describe_the_default(self):
        for name in EITHER:
            tool = claws.base.get(name)
            self.assertIn("USER'S PC", tool.description, name)
            self.assertEqual(tool.schema["properties"]["target"]["enum"], ["desktop", "server"])
            self.assertNotIn("target", tool.schema.get("required", []), "omitting it must be valid")

    def test_every_registered_tool_is_classified_on_purpose(self):
        # A new tool must be added to targets.TOOL_WHERE: running on the server by omission is how
        # "my RAM" ended up being the server's.
        unlisted = {t.name for t in claws.base.available_tools()} - set(targets.TOOL_WHERE)
        self.assertEqual(unlisted, set())

    def test_intent_of(self):
        self.assertEqual(targets.intent_of("system_info", {}), "system_info:desktop")
        self.assertEqual(targets.intent_of("system_info", {"target": "server"}), "system_info:server")
        self.assertEqual(targets.intent_of("system_info", {"target": "bogus"}), "system_info:desktop")
        self.assertEqual(targets.intent_of("web_search", {"query": "x"}), "web_search:server")
        self.assertEqual(targets.intent_of("launch_app", {}), "launch_app:desktop")
        self.assertEqual(targets.intent_of(None, None), "none")

    def test_battery_is_well_formed_and_its_expectations_agree_with_the_table(self):
        rows = json.loads((Path(__file__).parent / "data" / "tool_target_intents.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(rows), 40)
        self.assertEqual(len({r["text"] for r in rows}), len(rows))
        self.assertTrue(any(any(c in r["text"] for c in "áéíóñ¿") for r in rows))
        groups = {r["group"] for r in rows}
        self.assertTrue({"pc-hardware", "pc-shell", "pc-files", "server", "server-only", "none"} <= groups)
        for row in rows:
            if row["expect"] == "none":
                continue
            tool, where = row["expect"].split(":")
            expected = targets.where_for(tool)
            self.assertIn(where, ("desktop", "server"), row["text"])
            if expected != targets.EITHER:
                self.assertEqual(where, expected, row["text"])
            if row["group"].startswith("pc-"):
                self.assertEqual(where, "desktop", row["text"])


class ResolveTests(unittest.TestCase):
    def broker(self, agent=None):
        b = DesktopBroker()
        if agent:
            b.register(agent)
        return b

    def test_default_is_the_desktop_agent(self):
        r = targets.resolve("system_info", {}, self.broker(Agent()), "s1", is_local=False)
        self.assertEqual((r.where, r.via_agent, r.host, r.label, r.error), ("desktop", True, "minigun", "[minigun]", None))

    def test_server_only_when_asked(self):
        r = targets.resolve("run_command", {"target": "server"}, self.broker(Agent()), "s1", is_local=False)
        self.assertEqual((r.where, r.via_agent, r.label), ("server", False, "[server]"))

    def test_not_an_either_tool(self):
        self.assertIsNone(targets.resolve("web_search", {}, self.broker(Agent()), "s1", is_local=False))
        self.assertIsNone(targets.resolve("launch_app", {"target": "server"}, self.broker(), "s1", is_local=False))

    def test_no_agent_in_remote_mode_is_an_error_that_blocks_the_server_workaround(self):
        r = targets.resolve("system_info", {}, self.broker(), "s1", is_local=False)
        self.assertIn("No desktop agent", r.error)
        self.assertIn("Do NOT retry with target='server'", r.error)

    def test_old_agent_without_the_action_is_named_in_the_error(self):
        old = Agent(frozenset({"launch_app", "screenshot"}))
        r = targets.resolve("run_command", {}, self.broker(old), "s1", is_local=False)
        self.assertIn("minigun", r.error)
        self.assertIn("does not support 'run_command'", r.error)

    def test_everything_on_one_machine_needs_no_agent_and_says_so(self):
        r = targets.resolve("system_info", {}, self.broker(), "s1", is_local=True)
        self.assertEqual((r.where, r.via_agent, r.error, r.local), ("desktop", False, None, True))
        self.assertTrue(r.label.endswith("· local]"))

    def test_invalid_target_is_refused(self):
        r = targets.resolve("run_command", {"target": "cloud"}, self.broker(Agent()), "s1", is_local=False)
        self.assertIn("Invalid target", r.error)

    def test_deployment_mode(self):
        import os
        keep = os.environ.pop("KALI_DEPLOYMENT", None)
        try:
            self.assertTrue(targets.local_mode("127.0.0.1"))
            self.assertFalse(targets.local_mode("0.0.0.0"))
            os.environ["KALI_DEPLOYMENT"] = "remote"
            self.assertFalse(targets.local_mode("127.0.0.1"))
            os.environ["KALI_DEPLOYMENT"] = "local"
            self.assertTrue(targets.local_mode("0.0.0.0"))
        finally:
            os.environ.pop("KALI_DEPLOYMENT", None)
            if keep is not None:
                os.environ["KALI_DEPLOYMENT"] = keep

    def test_stamp_always_names_the_machine(self):
        route = targets.Route("desktop", "minigun", via_agent=True)
        out = targets.stamp({"memory": {"total_mb": 32000}}, route)
        self.assertEqual(out["origin"], "[minigun]")
        self.assertEqual(out["machine"]["where"], "desktop")
        self.assertEqual(out["memory"]["total_mb"], 32000)
        self.assertEqual(targets.stamp("text", route)["result"], "text")
        # A tool cannot forge its own origin.
        self.assertEqual(targets.stamp({"origin": "[server]"}, route)["origin"], "[minigun]")


class ExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_ram_question_goes_to_the_pc_by_default_and_is_labelled(self):
        agent = Agent()
        executor, broker, consent = make_executor(agent)
        info = {"host": "minigun", "memory": {"total_mb": 32768, "available_mb": 20000}}
        result, events = await serve(executor, broker, agent, "system_info", {}, result=info)
        self.assertEqual(agent.sent[0]["action"], "system_info")
        self.assertIsNone(result.error)
        self.assertEqual(result.output["origin"], "[minigun]")
        self.assertEqual(result.output["memory"]["total_mb"], 32768)
        consent.request.assert_not_awaited()
        self.assertEqual(events[-1]["output"]["origin"], "[minigun]", "the UI sees the label too")

    async def test_server_target_never_reaches_the_agent_and_says_server(self):
        agent = Agent()
        executor, broker, _ = make_executor(agent)
        result = await executor.execute("system_info", {"target": "server"}, "s1")
        self.assertEqual(agent.sent, [])
        self.assertEqual(result.output["origin"], "[server]")
        self.assertGreater(result.output["memory"].get("total_mb", 1), 0)

    async def test_no_agent_remote_is_an_error_and_nothing_runs_on_the_server(self):
        executor, _, consent = make_executor(None, local=False)
        with tempfile.TemporaryDirectory() as d:
            marker = Path(d) / "ran"
            result = await executor.execute("run_command", {"command": f"touch {marker}"}, "s1")
            self.assertFalse(marker.exists())
        self.assertIn("No desktop agent", result.error)
        consent.request.assert_not_awaited()
        for tool, params in (("system_info", {}), ("fs_read", {"path": "/etc/hostname"}), ("fs_list", {"path": "/"})):
            self.assertIn("No desktop agent", (await executor.execute(tool, params, "s1")).error, tool)

    async def test_command_on_the_pc_is_asked_by_the_agent_only_and_ignores_core_whitelists(self):
        agent = Agent()
        executor, broker, consent = make_executor(agent)
        # "ls *" is whitelisted by the dev profile for the server; on the PC the agent still asks.
        out = {"exit_code": 0, "stdout": "a\nb\n", "stderr": "", "cwd": "/home/f", "host": "minigun"}
        result, events = await serve(executor, broker, agent, "run_command", {"command": "ls -la"}, result=out)
        sent = agent.sent[0]
        self.assertEqual((sent["action"], sent["params"]["command"]), ("run_command", "ls -la"))
        self.assertNotIn("cwd", sent["params"], "the server's working directory means nothing on the PC")
        self.assertEqual(result.output["origin"], "[minigun]")
        self.assertEqual(result.output["stdout"], "a\nb\n")
        consent.request.assert_not_awaited()
        self.assertFalse(consent.is_granted("s1", "run_command:ls"))
        kinds = [e["event"] for e in events]
        self.assertIn("command_start", kinds)
        self.assertEqual([e["line"] for e in events if e["event"] == "command_output"], ["a", "b"])
        self.assertEqual(next(e for e in events if e["event"] == "command_end")["status"], "done")
        self.assertEqual(next(e for e in events if e["event"] == "command_start")["host"], "[minigun]")

    async def test_denied_on_the_pc_is_reported_with_the_machine(self):
        agent = Agent()
        executor, broker, _ = make_executor(agent)
        result, events = await serve(executor, broker, agent, "run_command", {"command": "rm -rf x"}, error="Denied by the user")
        self.assertEqual(result.error, "[minigun] Denied by the user")
        self.assertEqual(next(e for e in events if e["event"] == "command_end")["status"], "error")

    async def test_agent_that_cannot_ask_locally_gets_nothing_to_run(self):
        agent = Agent(frozenset(EITHER))  # no local_consent
        executor, broker, consent = make_executor(agent)
        result = await executor.execute("run_command", {"command": "id"}, "s1")
        self.assertEqual(agent.sent, [])
        self.assertIn("cannot ask for permission", result.error)
        consent.request.assert_not_awaited()

    async def test_command_on_the_server_still_asks_in_the_core_and_names_the_server(self):
        agent = Agent()
        executor, broker, consent = make_executor(agent, consent_answer="allow")
        with tempfile.TemporaryDirectory() as d:
            result = await executor.execute("run_command", {"command": "echo hi && pwd", "target": "server", "cwd": d}, "s1")
        self.assertEqual(agent.sent, [])
        self.assertEqual(result.output["origin"], "[server]")
        self.assertIn("hi", result.output["stdout"])
        consent.request.assert_awaited_once()
        self.assertEqual(consent.request.await_args.kwargs["reason_params"]["where"], "[server]")

    async def test_denied_on_the_server_is_labelled(self):
        executor, _, _ = make_executor(Agent(), consent_answer="deny")
        result = await executor.execute("run_command", {"command": "echo x", "target": "server"}, "s1")
        self.assertTrue(result.error.startswith("[server] Tool execution denied"))

    async def test_files_default_to_the_pc_and_server_files_are_labelled(self):
        agent = Agent()
        executor, broker, _ = make_executor(agent)
        result, _ = await serve(executor, broker, agent, "fs_read", {"path": "~/n.txt", "max_lines": 5, "target": "desktop"},
                                result={"content": "hola", "path": "/home/f/n.txt"})
        self.assertEqual(agent.sent[0]["params"], {"path": "~/n.txt", "max_lines": 5}, "target is not forwarded")
        self.assertEqual(result.output["origin"], "[minigun]")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.txt").write_text("x")
            res = await executor.execute("fs_list", {"path": d, "target": "server"}, "s1")
        self.assertEqual(res.output["origin"], "[server]")
        self.assertEqual(len(agent.sent), 1)

    async def test_everything_on_one_machine_runs_in_process_and_is_labelled_local(self):
        executor, _, _ = make_executor(None, local=True)
        result = await executor.execute("system_info", {}, "s1")
        self.assertIsNone(result.error)
        self.assertIn("local]", result.output["origin"])

    async def test_a_connected_agent_wins_even_on_one_machine(self):
        agent = Agent()
        executor, broker, _ = make_executor(agent, local=True)
        result, _ = await serve(executor, broker, agent, "system_info", {}, result={"host": "minigun"})
        self.assertEqual(result.output["origin"], "[minigun]")

    async def test_other_tools_are_untouched(self):
        executor, _, _ = make_executor(Agent())
        result = await executor.execute("web_fetch", {"url": "http://127.0.0.1:1/"}, "s1")
        self.assertNotIn("origin", result.output or {})
        self.assertFalse((result.error or "").startswith("["))


class SystemInfoTests(unittest.IsolatedAsyncioTestCase):
    def test_parsers(self):
        mem = parse_meminfo("MemTotal: 32768000 kB\nMemAvailable: 16384000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
        self.assertEqual((mem["total_mb"], mem["available_mb"]), (32000, 16000))
        self.assertEqual(parse_cpuinfo("processor: 0\nmodel name: X\nprocessor: 1\n"), ("X", 2))

    def test_cgroup_limits(self):
        self.assertIsNone(parse_cgroup_limit("max\n"))
        self.assertIsNone(parse_cgroup_limit(None))
        self.assertIsNone(parse_cgroup_limit("9223372036854771712"))  # cgroup v1 "unlimited"
        self.assertEqual(parse_cgroup_limit(str(16 * 1024**3)), 16384)

    async def test_collect_has_the_shared_shape_and_is_safe(self):
        self.assertEqual(SystemInfoTool.risk_level, "safe")
        out = (await SystemInfoTool().run({}, claws.base.ToolContext(session_id="s", working_dir=".", profile="dev"))).output
        for key in ("host", "os", "cpu", "memory", "disks", "gpus"):
            self.assertIn(key, out)
        self.assertEqual(out["memory"]["used_mb"], out["memory"]["total_mb"] - out["memory"]["available_mb"])


class PromptTests(unittest.TestCase):
    def test_system_prompt_teaches_the_default_and_the_exception(self):
        from kali_core.config import settings
        p = settings.llm_system_prompt
        self.assertIn("system_info", p)
        self.assertIn("omit it and they act on the USER'S PC", p)
        self.assertIn("target='server' ONLY when", p)
        self.assertIn("never switch to the server", p)

    def test_describe_names_both_machines(self):
        broker = DesktopBroker()
        broker.register(Agent())
        line = broker.describe("s1")
        self.assertIn("the user's PC is 'minigun'", line)
        self.assertIn("run commands", line)
        self.assertIn("omit it for anything about the user's computer", line)
        self.assertIn("Kali server is", line)

    def test_describe_without_an_agent_warns_off_the_server_workaround(self):
        line = DesktopBroker().describe("s1", server_screen=False)
        self.assertIn("no desktop agent connected", line)
        self.assertIn("would answer about the server", line)


if __name__ == "__main__":
    unittest.main()
