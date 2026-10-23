"""Measure how well the configured model picks the screen tools for the phrase battery.

    python scripts/eval_screen_intents.py [--repeat 3]

Targets: recall >= 85% on explicit and strong-signal phrases, false positives <= 3% on negatives.
It calls the model configured in ai_config.json with the real prompt and tool definitions; nothing
is executed, only the first tool call is read.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "tests" / "data" / "screen_intents.json"


def classify(tool: str | None, args: dict | None) -> str:
    if tool == "look_at_screen":
        return "screen" if (args or {}).get("target") == "screen" else "region"
    if tool == "suggest_capture":
        return "suggest"
    return "none"


async def first_tool(provider, tools, text: str) -> tuple[str | None, dict | None]:
    from kali_core.mind.runtime import _parse_tool_call

    acc = ""
    async for ev in provider.stream([{"role": "user", "content": text}], tools):
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


async def main(repeat: int) -> int:
    from kali_core.server import _build_llm_provider, _build_tool_defs, _register_tools

    provider = _build_llm_provider()
    if provider is None:
        print("No LLM configured")
        return 2
    _register_tools()
    tools = _build_tool_defs()
    rows = json.loads(DATA.read_text(encoding="utf-8"))
    hits: Counter = Counter()
    totals: Counter = Counter()
    confusion: Counter = Counter()
    for row in rows:
        for _ in range(repeat):
            tool, args = await first_tool(provider, tools, row["text"])
            got = classify(tool, args)
            totals[row["group"]] += 1
            ok = got == row["expect"] or (row["expect"] in ("region", "screen") and got in ("region", "screen"))
            hits[row["group"]] += ok
            if not ok:
                confusion[(row["expect"], got)] += 1
                print(f"MISS {row['expect']:>7} -> {got:<7} {row['text']}")
    for group in totals:
        print(f"{group:>14}: {hits[group]}/{totals[group]} = {hits[group] / totals[group]:.0%}")
    negative_fp = 1 - hits["negative"] / max(totals["negative"], 1)
    recall = (hits["explicit"] + hits["strong-signal"]) / max(totals["explicit"] + totals["strong-signal"], 1)
    print(f"recall {recall:.0%} (target >= 85%), false positives {negative_fp:.0%} (target <= 3%)")
    return 0 if recall >= 0.85 and negative_fp <= 0.03 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    raise SystemExit(asyncio.run(main(ap.parse_args().repeat)))
