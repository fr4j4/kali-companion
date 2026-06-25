"""Artifact management tools — list, inspect, and update existing artifacts.

These tools let the agent interact with artifacts that have already been
created in the current session:

- ``list_artifacts``: enumerate all artifacts in the session (id, type,
  title, content preview) so the agent can find one by name or topic
  when the user refers to it without having it selected.
- ``get_artifact``: fetch the full content of a single artifact by id.
- ``update_artifact``: replace the content of an existing artifact in
  place. The updated content is persisted to SQLite and emitted as an
  ``update: "update"`` WS event so the frontend re-renders the window.

All three are scoped to ``ctx.session_id`` — artifacts from other
sessions are never visible.
"""

from __future__ import annotations

import logging
from typing import Any

from kali_core.claws.base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.manage_artifacts")

_PREVIEW_LEN = 200


class ListArtifactsTool:
    name = "list_artifacts"
    description = (
        "List all artifacts that exist in the current session. "
        "Returns each artifact's id, type, title, and a short content "
        "preview. Use this when the user refers to an artifact by name "
        "or topic but does not have it selected, so you can find the "
        "right artifact id to inspect or update.\n\n"
        "Artifacts are scoped to the current session only."
    )
    schema: dict = {
        "type": "object",
        "properties": {},
        "required": [],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        store = ctx.session_store
        if store is None:
            return ToolResult(error="No session store available.")
        artifacts = await store.get_artifacts(ctx.session_id)
        if not artifacts:
            return ToolResult(output={"artifacts": [], "count": 0})
        summaries = []
        for art in artifacts:
            content = art.get("content", "") or ""
            preview = content[:_PREVIEW_LEN]
            if len(content) > _PREVIEW_LEN:
                preview += "..."
            summaries.append({
                "id": art.get("id", ""),
                "type": art.get("type", ""),
                "window_type": art.get("window_type", ""),
                "title": art.get("title", ""),
                "preview": preview,
            })
        return ToolResult(output={"artifacts": summaries, "count": len(summaries)})


class GetArtifactTool:
    name = "get_artifact"
    description = (
        "Retrieve the full content of a single artifact by its id. "
        "Use this before updating an artifact so you can see its "
        "current content and produce a coherent replacement.\n\n"
        "Pass the artifact id (e.g. 'art_abc123'). The artifact must "
        "belong to the current session."
    )
    schema: dict = {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "The id of the artifact to retrieve.",
            },
        },
        "required": ["artifact_id"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        artifact_id = params.get("artifact_id", "").strip()
        if not artifact_id:
            return ToolResult(error="Missing 'artifact_id' parameter.")
        store = ctx.session_store
        if store is None:
            return ToolResult(error="No session store available.")
        art = await store.get_artifact(ctx.session_id, artifact_id)
        if art is None:
            return ToolResult(
                error=f"Artifact '{artifact_id}' not found in this session."
            )
        return ToolResult(output={
            "id": art.get("id", ""),
            "type": art.get("type", ""),
            "window_type": art.get("window_type", ""),
            "title": art.get("title", ""),
            "content": art.get("content", ""),
        })


class UpdateArtifactTool:
    name = "update_artifact"
    description = (
        "Update the content of an existing artifact in place. The "
        "artifact window on the canvas will re-render with the new "
        "content.\n\n"
        "You MUST provide the full new content (the entire artifact "
        "body), not just the parts to change — the old content is "
        "completely replaced. Call get_artifact first if you need to "
        "see the current content before producing the replacement.\n\n"
        "The artifact must belong to the current session. An optional "
        "new title may be provided; if omitted the title is unchanged."
    )
    schema: dict = {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "The id of the artifact to update.",
            },
            "content": {
                "type": "string",
                "description": (
                    "The full new content for the artifact. "
                    "Must match the artifact's original format: raw "
                    "text for document/mermaid/code/html/json, JSON "
                    "string for table/checklist."
                ),
            },
            "title": {
                "type": "string",
                "description": "Optional new title for the artifact.",
            },
        },
        "required": ["artifact_id", "content"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        artifact_id = params.get("artifact_id", "").strip()
        content = params.get("content", "")
        new_title = params.get("title", "").strip() or None

        if not artifact_id:
            return ToolResult(error="Missing 'artifact_id' parameter.")
        if not content:
            return ToolResult(error="Missing 'content' parameter.")

        store = ctx.session_store
        if store is None:
            return ToolResult(error="No session store available.")

        existing = await store.get_artifact(ctx.session_id, artifact_id)
        if existing is None:
            return ToolResult(
                error=f"Artifact '{artifact_id}' not found in this session."
            )

        art_type = existing.get("type", "")
        window_type = existing.get("window_type", "")
        title = new_title if new_title else existing.get("title", "")

        updated = await store.update_artifact_content(
            ctx.session_id, artifact_id, content, title=title,
        )
        if updated is None:
            return ToolResult(
                error=f"Failed to update artifact '{artifact_id}'."
            )

        logger.info(
            "[update_artifact] id=%s type=%s title=\"%s\" (%s)",
            artifact_id, art_type, title, ctx.session_id[:8],
        )

        payload = {
            "event": "artifact",
            "id": artifact_id,
            "type": art_type,
            "windowType": window_type,
            "title": title,
            "content": content,
            "update": "update",
        }

        return ToolResult(
            output={
                "artifact_id": artifact_id,
                "title": title,
                "updated": True,
            },
            artifact=payload,
        )


__all__ = ["ListArtifactsTool", "GetArtifactTool", "UpdateArtifactTool"]