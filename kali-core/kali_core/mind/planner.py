"""Agent planner — decides single-step vs. multi-step execution.

The Planner analyzes a user message and decides whether the agent should
execute a single function-calling turn (Phase 1 style) or break the task
into a multi-step plan with explicit intermediate goals.

Phase 2 implementation: uses a lightweight LLM call to produce a structured
plan (list of steps) for complex tasks. Simple messages bypass the planner
and go straight to the normal agent loop.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

logger = logging.getLogger("kali_core.mind.planner")


@dataclass
class Plan:
    """A multi-step execution plan."""
    steps: list[str] = field(default_factory=list)
    reasoning: str = ""

    def to_dict(self) -> dict:
        return {"steps": self.steps, "reasoning": self.reasoning}


# Heuristics: messages that look like simple questions or greetings skip
# planning and go straight to the LLM.
_SIMPLE_PATTERNS = [
    "hola", "hello", "hey", "gracias", "thanks", "que tal",
    "what is", "explain", "explain to me", "what are",
    "qu es", "explica", "cunta",
]

# Messages with these keywords likely need multi-step execution.
_COMPLEX_PATTERNS = [
    "implement", "refactor", "fix the bug", "create a",
    "set up", "configure", "migrate", "build a",
    "implementa", "refactoriza", "arregla el bug", "crea un",
    "configura", "construye",
]


def _is_simple(message: str) -> bool:
    """Heuristic: is this message simple enough to skip planning?"""
    lower = message.lower().strip()
    if len(lower) < 80 and lower.endswith("?"):
        return True
    for pattern in _SIMPLE_PATTERNS:
        if lower.startswith(pattern):
            return True
    return all(pattern not in lower for pattern in _COMPLEX_PATTERNS)


_PLAN_PROMPT = """\
You are a planning assistant. Analyze the user's request and break it into concrete steps.

Return a JSON object with:
- "reasoning": brief explanation of your plan
- "steps": array of step descriptions (each step is a single action)

Rules:
- Keep steps small and verifiable.
- Each step should map to a tool call or a small piece of code.
- If the task is simple enough for one step, return a single-element array.
- Reply ONLY with the JSON, no markdown fences.

User request: {request}"""


class Planner:
    """Decides how to execute a turn."""

    def __init__(self, llm=None) -> None:
        """Initialize with an optional LLM provider for plan generation."""
        self._llm = llm

    async def plan(self, user_message: str) -> Plan:
        """Analyze a user message and produce an execution plan.

        Simple messages return an empty plan (skip to direct execution).
        Complex messages use the LLM to generate a multi-step plan.
        """
        if _is_simple(user_message):
            return Plan(steps=[], reasoning="Simple message, direct execution.")

        if self._llm is None:
            return Plan(steps=[], reasoning="No LLM available, direct execution.")

        prompt = _PLAN_PROMPT.format(request=user_message)
        try:
            result = await self._llm.complete(
                messages=[{"role": "user", "content": prompt}],
            )
            text = result.get("text", "").strip()
            # Strip markdown fences if present.
            if text.startswith("```"):
                text = text.split("\n", 1)[-1] if "\n" in text else text
                text = text.rsplit("```", 1)[0] if "```" in text else text
            data = json.loads(text)
            return Plan(
                steps=data.get("steps", []),
                reasoning=data.get("reasoning", ""),
            )
        except (json.JSONDecodeError, Exception) as e:
            logger.warning("Plan generation failed: %s", e)
            return Plan(steps=[], reasoning=f"Planning failed: {e}")