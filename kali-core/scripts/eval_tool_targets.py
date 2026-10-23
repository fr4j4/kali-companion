"""Measure whether the configured model picks the right machine for the system tools.

    python scripts/eval_tool_targets.py [--repeat 3] [--host minigun]

Each phrase in tests/data/tool_target_intents.json is sent with the real system prompt, the real tool
definitions and the "WHERE TOOLS RUN" line of a connected desktop agent. Nothing is executed: only
the first tool call is read and compared with the expected ``tool:where`` (see targets.intent_of).

Targets: >= 90% on every pc-* group (the default must win), >= 85% on `server`, and no PC question
answered on the server (the mistake this battery exists to catch) in more than 2% of the tries.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

DATA = Path(__file__).resolve().parent.parent / "tests" / "data" / "tool_target_intents.json"


async def first_tool(provider, tools, system: str, text: str) -> tuple[str | None, dict | None]:
    from kali_core.mind.runtime import _parse_tool_call

    messages = [{"role": "system", "content": system}, {"role": "user", "content": text}]
    acc = ""
    async for ev in provider.stream(messages, tools):
        if ev.kind == "tool_call":
            return ev.tool_name, ev.tool_args
        if ev.kind == "delta" and ev.text:
            acc += ev.text
        if ev.kind == "done":
            break
    parsed = _parse_tool_call(acc)
    if parsed:
        return parsed[0][0], parsed[0][1]
    return None, None


async def main(repeat: int, host: str) -> int:
    from kali_core import targets
    from kali_core.config import settings
    from kali_core.desktop import DesktopBroker
    from kali_core.server import _build_llm_provider, _build_tool_defs, _register_tools

    provider = _build_llm_provider()
    if provider is None:
        print("No LLM configured")
        return 2
    _register_tools()
    tools = _build_tool_defs()
    broker = DesktopBroker()
    broker.register(SimpleNamespace(
        is_desktop=True, session_id=None, desktop_hostname=host,
        desktop_capabilities=frozenset({"system_info", "run_command", "fs_read", "fs_list", "launch_app", "screenshot", "local_consent"}),
    ))
    system = f"{settings.llm_system_prompt}\n\n{broker.describe('eval')}"

    rows = json.loads(DATA.read_text(encoding="utf-8"))
    hits: Counter = Counter()
    totals: Counter = Counter()
    pc_on_server = 0
    pc_total = 0
    for row in rows:
        for _ in range(repeat):
            tool, args = await first_tool(provider, tools, system, row["text"])
            got = targets.intent_of(tool, args)
            ok = got == row["expect"]
            totals[row["group"]] += 1
            hits[row["group"]] += ok
            if row["group"].startswith("pc-"):
                pc_total += 1
                pc_on_server += got.endswith(":server") and got.split(":")[0] in targets.EITHER_ACTIONS
            if not ok:
                print(f"MISS {row['expect']:<26} -> {got:<26} {row['text']}")
    for group in totals:
        print(f"{group:>14}: {hits[group]}/{totals[group]} = {hits[group] / totals[group]:.0%}")
    pc_rate = pc_on_server / max(pc_total, 1)
    print(f"PC questions answered on the server: {pc_rate:.1%} (target <= 2%)")
    pc_ok = all(hits[g] / totals[g] >= 0.9 for g in totals if g.startswith("pc-"))
    server_ok = hits["server"] / max(totals["server"], 1) >= 0.85
    return 0 if pc_ok and server_ok and pc_rate <= 0.02 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--host", default="minigun", help="name the fake desktop agent reports")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(main(args.repeat, args.host)))
