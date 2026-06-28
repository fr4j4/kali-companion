"""Artifact management tools — list, inspect, and update existing artifacts.

These tools let the agent interact with artifacts that have already been
created in the current session:

- ``list_artifacts``: enumerate all artifacts in the session (id, type,
  title, content preview) so the agent can find one by name or topic
  when the user refers to it without having it selected. The preview
  length is configurable via ``preview_len`` (default 200, max 1000).
- ``get_artifact``: fetch the content of a single artifact by id. Supports
  line-range pagination via ``offset`` (1-indexed) and ``limit`` so the
  agent can inspect a region of a large artifact without loading the full
  content into its context window.
- ``update_artifact``: replace or patch the content of an existing
  artifact in place. Two modes (deduced from the parameters):
    * Full mode (``content``): replace the entire body. Use for large
      rewrites or non-streamable types (table, json, ...).
    * Patch mode (``old_string`` + ``new_string``): surgically replace a
      unique fragment of the current content. Only for streamable types
      (code, document, diff, html, mermaid). When
      ``settings.artifact_diff_preview`` is True (default), a ``diff``
  The updated content is persisted to SQLite and emitted as an
  ``update: "update"`` WS event so the frontend re-renders the window.

All three are scoped to ``ctx.session_id`` — artifacts from other
sessions are never visible.
"""

from __future__ import annotations

import difflib
import logging
from typing import Any

from kali_core.claws.base import ToolContext, ToolResult
from kali_core.canvas.registry import is_streamable_type

logger = logging.getLogger("kali_core.claws.manage_artifacts")

_PREVIEW_LEN = 200
_PREVIEW_LEN_MAX = 1000
# Hard cap on lines returned by get_artifact in a single paginated call,
# and on the length of a single line (to avoid blowing up the LLM context
# with minified HTML on a single line). Mirrors opencode's read tool.
_PAGE_LIMIT_MAX = 2000
_LINE_TRUNCATE = 2000
_TRUNCATE_MARKER = " …[truncated]"


class ListArtifactsTool:
    name = "list_artifacts"
    description = (
        "List all artifacts that exist in the current session. "
        "Returns each artifact's id, type, title, and a short content "
        "preview. Use this when the user refers to an artifact by name "
        "or topic but does not have it selected, so you can find the "
        "right artifact id to inspect or update.\n\n"
        "Artifacts are scoped to the current session only. Pass "
        "preview_len to control how many chars of content preview are "
        "returned per artifact (default 200, max 1000) — a larger "
        "preview helps when searching by topic."
    )
    schema: dict = {
        "type": "object",
        "properties": {
            "preview_len": {
                "type": "integer",
                "description": (
                    "Max chars of content preview per artifact. "
                    "Default 200, max 1000. Use a larger value to "
                    "inspect more context when searching by topic."
                ),
            },
        },
        "required": [],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        store = ctx.session_store
        if store is None:
            return ToolResult(error="No session store available.")
        preview_len = params.get("preview_len")
        if preview_len is None:
            plen = _PREVIEW_LEN
        else:
            try:
                plen = max(0, min(int(preview_len), _PREVIEW_LEN_MAX))
            except (TypeError, ValueError):
                plen = _PREVIEW_LEN
        artifacts = await store.get_artifacts(ctx.session_id)
        if not artifacts:
            return ToolResult(output={"artifacts": [], "count": 0})
        summaries = []
        for art in artifacts:
            content = art.get("content", "") or ""
            preview = content[:plen]
            if len(content) > plen:
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
        "Retrieve the content of a single artifact by its id. "
        "Use this before updating an artifact so you can see its "
        "current content and produce a coherent replacement.\n\n"
        "Pass the artifact id (e.g. 'art_abc123'). The artifact must "
        "belong to the current session.\n\n"
        "For large artifacts, pass offset (1-indexed line number to "
        "start from) and/or limit (max number of lines to return, "
        "default full content, max 2000) to read only a region. The "
        "response then includes total_lines, returned_lines, and "
        "has_more so you can page through the content. Long lines "
        "(>2000 chars) are truncated. Without offset/limit the full "
        "content is returned (backward compatible)."
    )
    schema: dict = {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "The id of the artifact to retrieve.",
            },
            "offset": {
                "type": "integer",
                "description": (
                    "1-indexed line number to start reading from. "
                    "Default 1 (start of content). Use with limit to "
                    "page through a large artifact."
                ),
            },
            "limit": {
                "type": "integer",
                "description": (
                    "Max number of lines to return. Default: return "
                    "the full content. Max 2000. Use with offset to "
                    "read a specific region."
                ),
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

        base = {
            "id": art.get("id", ""),
            "type": art.get("type", ""),
            "window_type": art.get("window_type", ""),
            "title": art.get("title", ""),
        }
        content = art.get("content", "") or ""

        offset_raw = params.get("offset")
        limit_raw = params.get("limit")
        if offset_raw is None and limit_raw is None:
            # Full content — backward compatible shape.
            return ToolResult(output={**base, "content": content})

        # Paginated mode.
        try:
            offset = int(offset_raw) if offset_raw is not None else 1
        except (TypeError, ValueError):
            return ToolResult(error="'offset' must be an integer.")
        try:
            limit = int(limit_raw) if limit_raw is not None else _PAGE_LIMIT_MAX
        except (TypeError, ValueError):
            return ToolResult(error="'limit' must be an integer.")
        if offset < 1:
            return ToolResult(error="'offset' must be >= 1.")
        if limit < 1:
            return ToolResult(error="'limit' must be >= 1.")
        limit = min(limit, _PAGE_LIMIT_MAX)

        lines = content.split("\n")
        total_lines = len(lines)
        start = min(max(offset - 1, 0), total_lines)
        end = min(start + limit, total_lines)
        page = lines[start:end]
        # Truncate over-long lines (e.g. minified HTML) to protect the
        # LLM context window.
        page = [
            ln if len(ln) <= _LINE_TRUNCATE
            else ln[:_LINE_TRUNCATE] + _TRUNCATE_MARKER
            for ln in page
        ]
        return ToolResult(output={
            **base,
            "content": "\n".join(page),
            "paginated": True,
            "offset": offset,
            "limit": limit,
            "total_lines": total_lines,
            "returned_lines": end - start,
            "has_more": end < total_lines,
        })


class UpdateArtifactTool:
    name = "update_artifact"
    description = (
        "Update the content of an existing artifact in place. The "
        "artifact window on the canvas will re-render with the new "
        "content.\n\n"
        "TWO MODES (deduced from the parameters you pass):\n"
        "1. Full mode: pass 'content' with the entire new body. The "
        "old content is completely replaced. Use for large rewrites, "
        "restructuring, or non-streamable types (table, json, "
        "checklist, chart, quiz). Call get_artifact first to see the "
        "current content.\n"
        "2. Patch mode: pass 'old_string' (the exact text to replace "
        "in the current content) and 'new_string' (the replacement; "
        "empty string deletes). Only for streamable types (code, "
        "document, diff, html, mermaid). old_string must appear "
        "exactly once unless replace_all=true. Use get_artifact with "
        "offset/limit to read only the region you need to change, "
        "then patch just that fragment — avoids regenerating the "
        "whole artifact.\n\n"
        "Do NOT pass both 'content' and 'old_string' — pick one mode. "
        "The artifact must belong to the current session. An optional "
        "new title may be provided; if omitted the title is unchanged. "
        "In patch mode a unified diff of the applied change is "
        "returned in the output for verification."
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
                    "Full mode: the entire new content for the "
                    "artifact. Must match the artifact's original "
                    "format: raw text for document/mermaid/code/html, "
                    "JSON string for table/checklist."
                ),
            },
            "old_string": {
                "type": "string",
                "description": (
                    "Patch mode: the exact text to replace in the "
                    "current content. Must match verbatim — call "
                    "get_artifact to read the current content first."
                ),
            },
            "new_string": {
                "type": "string",
                "description": (
                    "Patch mode: the replacement text. Use an empty "
                    "string to delete old_string."
                ),
            },
            "replace_all": {
                "type": "boolean",
                "description": (
                    "Patch mode: replace every occurrence of "
                    "old_string (default false). Use only when the "
                    "patch should apply to all matches."
                ),
            },
            "title": {
                "type": "string",
                "description": "Optional new title for the artifact.",
            },
        },
        "required": ["artifact_id"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        artifact_id = params.get("artifact_id", "").strip()
        if not artifact_id:
            return ToolResult(error="Missing 'artifact_id' parameter.")

        content = params.get("content")
        old_string = params.get("old_string")
        new_string = params.get("new_string")
        replace_all = bool(params.get("replace_all", False))
        new_title = params.get("title", "").strip() or None

        has_content = content is not None and content != ""
        has_patch = old_string is not None or new_string is not None

        if has_content and has_patch:
            return ToolResult(
                error=(
                    "Provide either 'content' (full replacement) or "
                    "'old_string'+'new_string' (patch), not both."
                )
            )
        if not has_content and not has_patch:
            return ToolResult(
                error=(
                    "Missing content: pass 'content' (full mode) or "
                    "'old_string'+'new_string' (patch mode)."
                )
            )
        if has_patch and (old_string is None or new_string is None):
            return ToolResult(
                error=(
                    "Patch mode requires both 'old_string' and "
                    "'new_string' (use empty new_string to delete)."
                )
            )

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
        current_content = existing.get("content", "") or ""

        if has_patch:
            # ── Patch mode (streamable only) ──
            if not is_streamable_type(art_type):
                return ToolResult(
                    error=(
                        f"patch mode is only supported for streamable "
                        f"types (code, document, diff, html, mermaid). "
                        f"For type '{art_type or '?'}', use full "
                        f"content replacement via the 'content' "
                        f"parameter."
                    )
                )
            occurrences = current_content.count(old_string)
            if occurrences == 0:
                return ToolResult(
                    error=(
                        "old_string not found in the artifact content. "
                        "Make sure old_string matches the current "
                        "content exactly (call get_artifact to read "
                        "it)."
                    )
                )
            if occurrences > 1 and not replace_all:
                return ToolResult(
                    error=(
                        f"old_string appears {occurrences} times in "
                        f"the artifact. Pass replace_all=true, or "
                        f"include more surrounding lines in "
                        f"old_string to make it unique."
                    )
                )
            new_content = current_content.replace(
                old_string, new_string, -1 if replace_all else 1
            )
            occurrences_replaced = occurrences if replace_all else 1
            diff_text = _build_patch_diff(
                old_string, new_string, title, occurrences_replaced
            )
        else:
            # ── Full mode ──
            new_content = content
            occurrences_replaced = None
            diff_text = None

        updated = await store.update_artifact_content(
            ctx.session_id, artifact_id, new_content, title=title,
        )
        if updated is None:
            return ToolResult(
                error=f"Failed to update artifact '{artifact_id}'."
            )

        logger.info(
            "[update_artifact] id=%s mode=%s type=%s title=\"%s\" (%s)",
            artifact_id,
            "patch" if has_patch else "full",
            art_type,
            title,
            ctx.session_id[:8],
        )

        payload = {
            "event": "artifact",
            "id": artifact_id,
            "type": art_type,
            "windowType": window_type,
            "title": title,
            "content": new_content,
            "update": "update",
        }

        output: dict[str, Any] = {
            "artifact_id": artifact_id,
            "title": title,
            "updated": True,
            "mode": "patch" if has_patch else "full",
        }
        if has_patch:
            output["occurrences_replaced"] = occurrences_replaced
            output["diff"] = diff_text

        # ── Optional diff-artifact confirmation on the canvas ──
        # Emit a separate `diff` artifact (via ctx.emit, the WS bus) so
        # the user visually sees what the patch changed. Gated by the
        # user setting `artifact_diff_preview` (default True). Only in
        # patch mode (full mode diffs would be huge and noisy).
        if has_patch and ctx.emit is not None:
            await _maybe_emit_diff_artifact(
                ctx.emit, ctx.session_id, title, diff_text
            )

        return ToolResult(output=output, artifact=payload)


def _build_patch_diff(
    old_string: str,
    new_string: str,
    title: str,
    occurrences: int,
) -> str:
    """Build a compact unified diff for the patch being applied."""
    old_lines = old_string.splitlines(keepends=True)
    new_lines = new_string.splitlines(keepends=True)
    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=f"{title} (antes)",
        tofile=f"{title} (después)",
        lineterm="",
    )
    header = (
        f"# Patch aplicado — {occurrences} ocurrencia(s) reemplazada(s)\n"
    )
    return header + "".join(diff)


async def _maybe_emit_diff_artifact(
    emit: Any,
    session_id: str,
    artifact_title: str,
    diff_text: str,
) -> None:
    """Emit a `diff` artifact to the canvas if the setting is enabled.

    Reads ``settings.artifact_diff_preview`` lazily so test/runtime
    toggles take effect immediately. Failures are logged and swallowed
    — the update already succeeded; the diff is a nice-to-have.
    """
    from kali_core.config import settings
    if not getattr(settings, "artifact_diff_preview", True):
        return
    try:
        from kali_core.canvas import diff_artifact
        envelope = diff_artifact(
            title=f"{artifact_title} — cambios",
            content=diff_text,
        )
        payload = envelope.to_payload()
        payload["session_id"] = session_id
        await emit(payload)
    except Exception:
        logger.warning(
            "Failed to emit patch diff artifact", exc_info=True
        )


__all__ = ["ListArtifactsTool", "GetArtifactTool", "UpdateArtifactTool", "GetArtifactConsoleTool"]


class GetArtifactConsoleTool:
    name = "get_artifact_console"
    description = (
        "Retrieve the runtime console logs of an HTML/renderer artifact "
        "by its id. The artifact must be currently open (rendered) in the "
        "frontend for logs to be available; if it is closed, the tool "
        "returns a message explaining that the artifact is not rendered.\n\n"
        "Use this when an HTML artifact looks broken or behaves unexpectedly "
        "and you want to see JavaScript errors, warnings, or debug output "
        "that the artifact produced at runtime. The logs are ephemeral "
        "(not persisted) and reflect the current rendering session.\n\n"
        "Pass the artifact id (e.g. 'art_abc123'). The artifact must "
        "belong to the current session."
    )
    schema: dict = {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "The id of the artifact whose console logs to retrieve.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of log entries to return (default 200, max 500).",
                "default": 200,
            },
        },
        "required": ["artifact_id"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        artifact_id = params.get("artifact_id", "").strip()
        if not artifact_id:
            return ToolResult(error="Missing 'artifact_id' parameter.")
        limit = min(int(params.get("limit", 200)), 500)

        requester = ctx.console_requester
        if requester is None:
            return ToolResult(error="Console log requester not available.")

        logs = await requester.request(ctx.emit, ctx.session_id, artifact_id, limit=limit)
        if logs is None:
            return ToolResult(output={
                "logs": None,
                "hint": (
                    "The artifact is not currently rendered (it may be closed "
                    "or was never opened). Console logs only exist while the "
                    "artifact is open in the frontend. "
                    "You can still inspect the artifact's source code using "
                    "get_artifact."
                ),
            })
        return ToolResult(output={
            "logs": logs,
            "count": len(logs),
        })