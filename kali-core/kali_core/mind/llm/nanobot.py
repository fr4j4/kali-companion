"""NanobotLLMProvider — wraps nanobot's WebSocket protocol.

For users who already run nanobot. Inherits nanobot's tools, reasoning
events, and session management. Talks to nanobot over WS and translates
its events into `StreamEvent`s that the agent loop can consume.

The nanobot WS protocol sends JSON events:
  - {"type": "delta", "text": "..."}  → StreamEvent(kind="delta")
  - {"type": "tool_call", "name": "...", "args": {...}} → StreamEvent(kind="tool_call")
  - {"type": "reasoning", "text": "..."} → StreamEvent(kind="reasoning")
  - {"type": "done"} → StreamEvent(kind="done")
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import websockets

from kali_core.config import settings

from .provider import StreamEvent, ToolDef

logger = logging.getLogger("kali_core.mind.nanobot")


class NanobotLLMProvider:
    """LLM provider that talks to a running nanobot instance over WS."""

    provider_name = "nanobot"

    def __init__(self) -> None:
        self.ws_url = settings.nanobot_ws_url
        self.api_url = settings.nanobot_api_url
        self.token = settings.nanobot_token
        self._model = "nanobot"

    def _build_payload(self, messages: list[dict], tools: list[ToolDef] | None) -> dict:
        """Build the nanobot WS payload."""
        payload: dict = {
            "messages": messages,
        }
        if tools:
            payload["tools"] = [
                {"name": t.name, "description": t.description, "schema": t.schema}
                for t in tools
            ]
        if self.token:
            payload["token"] = self.token
        return payload

    async def stream(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream events from the nanobot WS endpoint."""
        payload = self._build_payload(messages, tools)
        try:
            async with websockets.connect(self.ws_url) as ws:
                await ws.send(json.dumps(payload))
                async for raw in ws:
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        logger.warning("nanobot: malformed frame: %s", raw[:200])
                        continue

                    event_type = event.get("type", "")
                    if event_type == "delta":
                        text = event.get("text", "")
                        if text:
                            yield StreamEvent(kind="delta", text=text)
                    elif event_type == "tool_call":
                        yield StreamEvent(
                            kind="tool_call",
                            tool_name=event.get("name"),
                            tool_args=event.get("args", {}),
                            tool_call_id=event.get("id", ""),
                        )
                    elif event_type == "reasoning":
                        text = event.get("text", "")
                        if text:
                            yield StreamEvent(kind="reasoning", text=text)
                    elif event_type == "done":
                        break
                    elif event_type == "error":
                        err = event.get("message", "unknown nanobot error")
                        logger.error("nanobot error: %s", err)
                        yield StreamEvent(kind="delta", text=f"[nanobot error: {err}]")
                        break
        except Exception as exc:
            logger.error("nanobot stream error: %s", exc)
            yield StreamEvent(kind="delta", text=f"[nanobot error: {exc}]")
        finally:
            yield StreamEvent(kind="done")

    async def complete(
        self,
        messages: list[dict],
        tools: list[ToolDef] | None = None,
    ) -> dict:
        """Get a complete (non-streamed) response from nanobot."""
        accumulated = ""
        async for event in self.stream(messages, tools):
            if event.kind == "delta" and event.text:
                accumulated += event.text
        return {"text": accumulated}