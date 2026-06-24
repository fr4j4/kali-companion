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
import uuid
from typing import Any

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
    ) -> None:
        self.gateway = gateway
        self.consent = consent
        self.working_dir = working_dir
        self.profile = profile
        self.gaze_client = gaze_client
        self.llm_provider = llm_provider
        self.session_store = session_store
        self.job_mgr = job_mgr
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
                return ToolResult(error=f"Tool execution denied by user ({consent_decision}).")

        # Emit tool_event (running).
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
            emit=emit_event,
            language=language,
        )

        try:
            result = await tool.run(params, ctx)
        except Exception as e:
            logger.exception("Tool %s failed", tool_name)
            result = ToolResult(error=str(e))

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

            # Safety-net: ensure windowType is always present.  If the tool
            # didn't set it, derive a sensible default from type/widgetType.
            if not artifact_payload.get("windowType"):
                artifact_payload["windowType"] = _derive_window_type(artifact_payload)

            # Check if this was a streamed artifact (adapter already
            # sent it via ctx.emit, so we should NOT re-emit via WS).
            is_streamed = (
                isinstance(result.output, dict)
                and result.output.get("_streamed")
            )

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

            # Only emit via WS if NOT streamed (streaming already sent it).
            if not is_streamed:
                await emit_event(artifact_payload)

            # Track game_resource artifacts to block further web fetches.
            if self._is_game_resource_artifact(artifact_payload):
                self._game_resource_returned[session_id] = True

        return result

    def _is_game_resource_artifact(self, payload: dict) -> bool:
        """Check if an artifact payload is a game_resource widget."""
        try:
            content = payload.get("content", "")
            data = json.loads(content) if isinstance(content, str) else content
            items = data.get("items", []) if isinstance(data, dict) else []
            return any(i.get("widgetType") == "game_resource" for i in items)
        except (json.JSONDecodeError, TypeError, AttributeError):
            return False


_WIDGET_TYPE_MAP: dict[str, str] = {
    "game_resource": "entity",
    "dota_hero_card": "entity",
    "dota_item_card": "resource",
    "hero_card": "entity",
    "item_card": "resource",
    "location_card": "place",
    "music": "media",
    "video": "media",
    "markdown": "document",
    "text": "document",
    "longtext": "document",
}


def _derive_window_type(payload: dict) -> str:
    """Derive a sensible windowType from artifact type + widgetType.

    Used as a safety-net when the tool didn't set windowType explicitly.
    Returns generic types (entity, resource, document, etc.) instead of
    domain types.  This is the single source of truth for the mapping
    from backend domain/widget types to frontend generic window types.
    """
    art_type = payload.get("type", "")
    if art_type == "markdown":
        return "document"
    if art_type == "diff":
        return "diff"
    if art_type == "html":
        return "html"
    if art_type == "widget":
        try:
            content = payload.get("content", "")
            data = json.loads(content) if isinstance(content, str) else content
            items = data.get("items", []) if isinstance(data, dict) else []
            if items:
                wt = items[0].get("widgetType", "")
                # game_resource needs section inspection to distinguish
                # entity (has abilities) from resource (has item_grid).
                if wt == "game_resource":
                    game_data = items[0].get("data", {})
                    sections = game_data.get("sections", []) if isinstance(game_data, dict) else []
                    for sec in sections:
                        if sec.get("type") == "abilities":
                            return "entity"
                        if sec.get("type") == "item_grid":
                            return "resource"
                    return "entity"
                # Map known widget types to generic window types.
                if wt in _WIDGET_TYPE_MAP:
                    return _WIDGET_TYPE_MAP[wt]
                # Unknown widget type: if it's already a valid generic
                # type, pass it through; otherwise fall back to widget.
                return wt or "widget"
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
    return "widget"