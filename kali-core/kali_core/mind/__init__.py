"""kali-mind — the agent runtime (the cat's mind).

Receives a message (text or transcribed voice), plans, calls tools via
kali-claws, observes, and responds. Supports single-step (Phase 1) and
multi-step (Phase 2+) planning.

LLM access goes through the `LLMProvider` Protocol. Two implementations:
`DirectLLMProvider` (OpenAI-compatible) and `NanobotLLMProvider` (wraps
nanobot's WebSocket protocol). Config picks one; Kali runs without
nanobot installed.

See docs/COMPONENTS.md#kali-mind for the full spec.
"""

from .llm.provider import LLMProvider, StreamEvent

__all__ = ["LLMProvider", "StreamEvent"]