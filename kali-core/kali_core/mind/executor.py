"""Tool executor — runs tools through kali-collar and collects observations.

The executor:
1. Looks up the tool in the registry.
2. Checks permissions via PermissionGateway.
3. If consent is needed, asks ConsentManager (which emits consent_request).
4. Runs the tool and returns the result.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from kali_core.canvas import is_game_resource, resolve_window_type
from kali_core.claws.base import ToolContext, ToolResult, get
from kali_core.collar.consent import ConsentManager
from kali_core.collar.gateway import PermissionGateway

logger = logging.getLogger("kali_core.mind.executor")


class Executor:
    """Executes tools with permission checks and consent."""

    def __init__(
        self,
        gateway: PermissionGateway,
        consent: ConsentManager,
        working_dir: str = ".",
        profile: str = "dev",
        gaze_client: Any = None,
        llm_provider: Any = None,
        session_store: Any = None,
        job_mgr: Any = None,
        console_requester: Any = None,
    ) -> None:
        self.gateway = gateway
        self.consent = consent
        self.working_dir = working_dir
        self.profile = profile
        self.gaze_client = gaze_client
        self.llm_provider = llm_provider
        self.session_store = session_store
        self.job_mgr = job_mgr
        self.console_requester = console_requester
        # Per-session flag: True once a game_resource artifact has been returned.
        self._game_resource_returned: dict[str, bool] = {}

    async def execute(
        self,
        tool_name: str,
        params: dict,
        session_id: str,
        emit_event=None,
        language: str = "en",
    ) -> ToolResult:
        """Execute a tool with permission checks."""
        # Block web_search/web_fetch if a game_resource artifact was already returned.
        blocked = self._game_resource_returned.get(session_id)
        if tool_name in ("web_search", "web_fetch") and blocked:
            return ToolResult(
                error="A game resource card was already generated. "
                      "No further web fetches are needed."
            )

        tool = get(tool_name)
        if tool is None:
            return ToolResult(error=f"Unknown tool: {tool_name}")

        # Check permissions.
        decision = self.gateway.check(tool_name, tool.risk_level, params, self.profile)

        if not decision.allow and decision.needs_consent:
            # Request consent from the user.
            reason_params = decision.reason_params or {"tool": tool_name}
            consent_decision = await self.consent.request(
                tool=tool_name,
                reason_key=decision.reason_key or "consent.reason.sensitive",
                reason_params=reason_params,
                summary_key=f"consent.summary.{tool_name}",
                risk=tool.risk_level,
            )

            if consent_decision != "allow":
                logger.info(
                    "[consent] %s for tool '%s' (%s)",
                    consent_decision, tool_name, session_id[:8],
                )
                return ToolResult(error=f"Tool execution denied by user ({consent_decision}).")

        # Emit tool_event (running).
        tool_start = time.monotonic()
        logger.info("[tool] running: %s (%s) args=%s", tool_name, session_id[:8], json.dumps(params))
        if emit_event:
            await emit_event({
                "event": "tool_event",
                "session_id": session_id,
                "tool": tool_name,
                "status": "running",
                "params": params,
                "output": None,
            })

        # Build context and run.
        gaze = getattr(self, "gaze_client", None)
        llm = getattr(self, "llm_provider", None)
        ctx = ToolContext(
            session_id=session_id,
            working_dir=self.working_dir,
            profile=self.profile,
            gaze_client=gaze,
            llm_provider=llm,
            job_mgr=getattr(self, "job_mgr", None),
            session_store=self.session_store,
            console_requester=getattr(self, "console_requester", None),
            emit=emit_event,
            language=language,
        )

        try:
            result = await tool.run(params, ctx)
        except Exception as e:
            logger.exception("Tool %s failed", tool_name)
            result = ToolResult(error=str(e))

        elapsed = time.monotonic() - tool_start
        status = "ok" if result.error is None else "err"
        logger.info(
            "[tool] done: %s (%s) %s after %.1fs",
            tool_name, session_id[:8], status, elapsed,
        )

        # Emit tool_event (success/error).
        if emit_event:
            status = "success" if result.error is None else "error"
            output = result.output if result.error is None else result.error
            await emit_event({
                "event": "tool_event",
                "session_id": session_id,
                "tool": tool_name,
                "status": status,
                "params": params,
                "output": output,
            })

        # Emit artifact event if the tool produced one.
        if result.artifact and emit_event:
            artifact_payload = dict(result.artifact)
            if not artifact_payload.get("id"):
                artifact_payload["id"] = f"art_{uuid.uuid4().hex[:8]}"

            # Safety-net: ensure windowType is always present. If the tool
            # didn't set it, resolve from the artifact type + widgetType
            # via the single registry (canvas.resolve_window_type).
            wt = artifact_payload.get("windowType", "")
            if not wt:
                domain_type = _extract_domain_type(artifact_payload)
                artifact_payload["windowType"] = resolve_window_type(domain_type)

            # ``result.streamed`` is the formal flag (replaces the old
            # implicit ``output["_streamed"]`` magic key). When True the
            # tool already emitted via ctx.emit; we persist but skip WS.
            is_streamed = result.streamed

            # Persist to session store ALWAYS (for replay on refresh).
            if self.session_store is not None:
                try:
                    await self.session_store.add_artifact(
                        session_id,
                        artifact_payload.get("id", ""),
                        artifact_payload.get("type", ""),
                        artifact_payload.get("title", ""),
                        artifact_payload.get("content", ""),
                        artifact_payload.get("windowType", ""),
                    )
                except Exception:
                    logger.warning("Failed to persist artifact", exc_info=True)

            art_type = artifact_payload.get("type", "?")
            art_title = artifact_payload.get("title", "?")
            art_id = artifact_payload.get("id", "?")
            logger.info(
                "[artifact] type=%s title=\"%s\" id=%s (%s)",
                art_type, art_title, art_id, session_id[:8],
            )

            # Only emit via WS if NOT streamed (streaming already sent it).
            if not is_streamed:
                await emit_event(artifact_payload)

            # Track game_resource artifacts to block further web fetches.
            if self._is_game_resource_artifact(artifact_payload):
                self._game_resource_returned[session_id] = True

        return result

    def _is_game_resource_artifact(self, payload: dict) -> bool:
        """Check if an artifact payload is a game_resource widget."""
        domain_type = _extract_domain_type(payload)
        if domain_type and is_game_resource(domain_type):
            return True
        # Fallback: inspect content for widgetType (legacy payloads).
        try:
            content = payload.get("content", "")
            data = json.loads(content) if isinstance(content, str) else content
            items = data.get("items", []) if isinstance(data, dict) else []
            return any(i.get("widgetType") == "game_resource" for i in items)
        except (json.JSONDecodeError, TypeError, AttributeError):
            return False


def _extract_domain_type(payload: dict) -> str:
    """Extract the domain type from an artifact payload.

    For widget artifacts, the domain type is ``data.type`` (hero/item/...)
    or the ``widgetType`` itself (game_resource, music, ...).
    For html/markdown/diff artifacts, the domain type is the ``type`` field.
    """
    art_type = payload.get("type", "")
    if art_type in ("html", "markdown", "diff"):
        return art_type
    if art_type == "widget":
        try:
            content = payload.get("content", "")
            data = json.loads(content) if isinstance(content, str) else content
            items = data.get("items", []) if isinstance(data, dict) else []
            if items:
                widget_type = items[0].get("widgetType", "")
                game_data = items[0].get("data", {})
                data_type = (
                    game_data.get("type", "")
                    if isinstance(game_data, dict) else ""
                )
                # For game_resource, the domain type is data.type (hero/item).
                if widget_type == "game_resource" and data_type:
                    return data_type
                return widget_type
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
    return ""