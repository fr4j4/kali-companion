"""create_artifact — generic artifact generation tool.

Lets the LLM produce visual artifacts (documents, diagrams, tables, code,
JSON trees, checklists, HTML) on the canvas without needing a specialized
tool for each type. The LLM calls this tool when the user asks to generate,
show, draw, or visualize something — or when a visual window would be
better than plain text.

The tool itself knows nothing about frontend window types. It declares the
``artifact_type`` (a domain-level concept: "document", "mermaid", "table"...)
and the canvas registry resolves it to the correct ``windowType``.

Content formats per type (what the frontend expects):
- document  → raw markdown text
- mermaid   → raw Mermaid diagram syntax
- code      → raw source code text
- html      → raw HTML
- json      → raw JSON string (JSON-as-text, not a parsed object)
- table     → JSON string: {"rows": [{col: val, ...}, ...]}
- checklist → JSON string: {"items": [{"text": str, "done": bool}, ...]}
- chart     → JSON string: {"labels": [...], "series": [{"name", "values"}], ...}
- sources, slides, tasks, notes, calendar, pdf → JSON strings (shapes in
  ``_SHAPES`` below, the same text the model reads in the tool description).

A code artifact may hold several files (``files``), and any artifact may
name the task it belongs to (``group``) so the canvas opens the artifacts of
one task together.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from kali_core.canvas import (
    ArtifactEnvelope,
    html_artifact,
    markdown_artifact,
    widget_artifact,
)
from kali_core.claws.base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.create_artifact")

# Artifact types the LLM can produce → how they map to envelope builders.
# "raw" types use html/markdown builders with raw string content.
# "json" types use widget_artifact with JSON-string content.
_RAW_TYPES = frozenset({"document", "mermaid", "code", "html", "json"})
_JSON_TYPES = frozenset({
    "table", "checklist", "chart",
    "sources", "slides", "tasks", "notes", "calendar", "pdf",
})
_VALID_TYPES = _RAW_TYPES | _JSON_TYPES

# JSON shape of each structured type, as the model reads it.
_SHAPES: dict[str, str] = {
    "table": '{"rows": [{"col": val, ...}]} (sortable spreadsheet; optional "notes": {"D7": "..."}, "formulas", "sheets": [{"name", "rows"}])',
    "checklist": '{"items": [{"text": str, "done": bool}]}',
    "chart": '{"labels": [str], "series": [{"name": str, "values": [num]}], "kind": "line"|"bar", "unit"?, "target"?: {"label", "value"}, "kpis"?: [{"label", "value", "note"?}], "breakdown"?: {"title", "items": [{"label", "value"}]}, "source"?}',
    "sources": '{"question": str, "sources": [{"title": str, "site": str, "year"?: str, "claim": str, "url"?: str}], "synthesis": str, "conflict"?: str, "answer"?: str}',
    "slides": '{"slides": [{"title": str, "kicker"?: str, "body"?: str, "points"?: [{"title", "text"}], "source"?: str, "notes"?: str}], "proposal"?: str (a change you offer on the current deck, one line)}',
    "tasks": '{"tasks": [{"title": str, "status": "todo"|"doing"|"done", "owner": "you"|"kali", "due"?: str, "progress"?: 0..1}]}',
    "notes": '{"notes": [{"title": str, "text"?: str, "kind"?: "note"|"reminder"|"list"|"link"|"voice", "items"?: [str], "when"?: str, "pinned"?: bool, "author"?: "you"|"kali", "source"?: str}]}',
    "calendar": '{"week_of": "YYYY-MM-DD", "events": [{"title": str, "day": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "proposed"?: bool}], "note"?: str, "timezone"?: str} (a view: nothing is booked)',
    "pdf": '{"url" or "path": str, "name"?: str, "pages"?: int, "size"?: str, "marks"?: [{"page": int, "text": str, "note"?: str}]}',
}

# Limits for a multi-file code artifact.
_MAX_FILES = 40


class CreateArtifactTool:
    name = "create_artifact"
    description = (
        "Create a visual artifact rendered as a window on the canvas. "
        "Use this when the user asks to generate, show, draw, or visualize "
        "something, or when your response would be better as a visual card "
        "than plain text.\n\n"
        "Supported artifact_type values and their content format:\n"
        "- 'document': markdown text (rendered as a document window)\n"
        "- 'mermaid': Mermaid diagram syntax (rendered as a diagram)\n"
        "- 'code': source code text (rendered with line numbers). For "
        "several files pass 'files' instead of 'content'.\n"
        "- 'html': raw HTML (rendered in a sandboxed iframe)\n"
        "- 'json': a JSON string (rendered as an expandable tree)\n"
        + "".join(f"- '{k}': JSON {v}\n" for k, v in _SHAPES.items())
        + "\nFor the JSON types, content must be a valid JSON string. "
        "For other types, content is raw text.\n"
        "Pass 'group' (a short name of the task, e.g. 'Portada del sitio') "
        "when several artifacts belong to the same task, so they open "
        "together."
    )
    schema = {
        "type": "object",
        "properties": {
            "artifact_type": {
                "type": "string",
                "enum": sorted(_VALID_TYPES),
                "description": (
                    "document=markdown text, mermaid=diagram syntax, "
                    "code=source code, html=HTML, json=JSON string; "
                    "table, checklist, chart, sources, slides, tasks, "
                    "notes, calendar, pdf = JSON string (see description)"
                ),
            },
            "title": {
                "type": "string",
                "description": "Short title for the artifact window.",
            },
            "content": {
                "type": "string",
                "description": (
                    "The artifact content. For document/mermaid/code/html: "
                    "raw text. For json: a JSON string. For table/checklist: "
                    "a JSON string with the expected shape."
                ),
            },
            "files": {
                "type": "array",
                "description": (
                    "Only for 'code': several files of a small project, "
                    "shown with a file tree and tabs. Use instead of "
                    "'content'. status marks what you changed: M "
                    "(modified), A (added), D (deleted); changed lists "
                    "the 1-based lines you changed."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                        "language": {"type": "string"},
                        "status": {"type": "string", "enum": ["M", "A", "D"]},
                        "changed": {"type": "array", "items": {"type": "integer"}},
                    },
                    "required": ["path", "content"],
                },
            },
            "group": {
                "type": "string",
                "description": (
                    "Optional short name of the task this artifact belongs "
                    "to. Artifacts with the same group open together."
                ),
            },
            "language": {
                "type": "string",
                "description": (
                    "Programming language for 'code' artifacts "
                    "(e.g. 'python', 'java', 'javascript', 'rust'). "
                    "Used for syntax highlighting. Optional but recommended."
                ),
            },
        },
        "required": ["artifact_type", "title"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        atype = params.get("artifact_type", "").strip()
        title = params.get("title", "").strip()
        content = params.get("content", "")
        language = params.get("language", "").strip()
        files = params.get("files")
        group = (params.get("group") or "").strip()

        if not atype:
            return ToolResult(error="Missing 'artifact_type' parameter.")
        if atype not in _VALID_TYPES:
            return ToolResult(
                error=f"Unknown artifact_type '{atype}'. "
                      f"Valid: {sorted(_VALID_TYPES)}"
            )
        if not title:
            return ToolResult(error="Missing 'title' parameter.")

        if files is not None:
            if atype != "code":
                return ToolResult(error="'files' is only for artifact_type 'code'.")
            files, err = _normalize_files(files)
            if err:
                return ToolResult(error=err)
            content = json.dumps({"files": files}, ensure_ascii=False)
        elif not isinstance(content, str) or content == "":
            return ToolResult(error="Missing 'content' parameter.")

        # Validate JSON types have valid JSON content before building.
        if atype in _JSON_TYPES:
            try:
                data = json.loads(content)
            except (json.JSONDecodeError, TypeError) as e:
                return ToolResult(
                    error=f"Invalid JSON for {atype}: {e}. "
                          f"Content must be valid JSON."
                )
            shape_error = _check_shape(atype, data)
            if shape_error:
                return ToolResult(error=f"{shape_error} Expected: {_SHAPES[atype]}")

        envelope = _build_envelope(atype, title, content, language)
        if envelope is None:
            return ToolResult(error=f"Failed to build artifact of type '{atype}'.")
        if group:
            envelope.group = group_id(group)
            envelope.group_title = group[:60]

        output: dict[str, Any] = {"artifact_type": atype, "title": title}
        if files is not None:
            output["files"] = len(files)
        if group:
            output["group"] = envelope.group_title
        return ToolResult(output=output, artifact=envelope.to_payload())


def group_id(name: str) -> str:
    """Stable id of a task group from its name ("Portada del sitio" → "portada-del-sitio")."""
    import re
    import unicodedata

    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")
    return slug[:48] or "task"


def _normalize_files(files: Any) -> tuple[list[dict[str, Any]], str]:
    """Validate the files of a multi-file code artifact."""
    if not isinstance(files, list) or not files:
        return [], "'files' must be a non-empty list of {path, content}."
    if len(files) > _MAX_FILES:
        return [], f"Too many files ({len(files)}); at most {_MAX_FILES}."
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, f in enumerate(files):
        if not isinstance(f, dict) or not isinstance(f.get("path"), str) or not f["path"].strip():
            return [], f"files[{i}] needs a 'path'."
        path = f["path"].strip()
        while path.startswith("./"):
            path = path[2:]
        if path in seen:
            return [], f"Duplicate file path '{path}'."
        seen.add(path)
        code = f.get("content", f.get("code", ""))
        if not isinstance(code, str):
            return [], f"files[{i}].content must be text."
        item: dict[str, Any] = {"path": path, "code": code}
        if isinstance(f.get("language"), str) and f["language"]:
            item["language"] = f["language"]
        if f.get("status") in ("M", "A", "D"):
            item["status"] = f["status"]
        changed = f.get("changed")
        if isinstance(changed, list):
            item["changed"] = [n for n in changed if isinstance(n, int) and n > 0]
        out.append(item)
    return out, ""


# The list each structured type must carry, so a malformed payload fails here
# with a useful message instead of rendering an empty window.
_REQUIRED_LIST = {
    "table": ("rows", "sheets"),
    "checklist": ("items",),
    "chart": ("series", "data"),
    "sources": ("sources",),
    "slides": ("slides",),
    "tasks": ("tasks",),
    "notes": ("notes",),
    "calendar": ("events",),
}


def _check_shape(atype: str, data: Any) -> str:
    if not isinstance(data, dict):
        return f"{atype} content must be a JSON object."
    if atype == "pdf":
        if not isinstance(data.get("url"), str) and not isinstance(data.get("path"), str):
            return "pdf needs 'url' or 'path'."
        return ""
    keys = _REQUIRED_LIST.get(atype)
    if keys and not any(isinstance(data.get(k), list) for k in keys):
        return f"{atype} needs a list in '{keys[0]}'."
    return ""


def _build_envelope(
    artifact_type: str, title: str, content: str, language: str = ""
) -> ArtifactEnvelope | None:
    """Build an ArtifactEnvelope for the given type.

    Raw-text types (document, mermaid, code, html, json) use the appropriate
    builder with the content as a raw string. The registry resolves
    windowType from the artifact type.

    JSON-structured types (table, checklist, chart) use widget_artifact
    with the JSON content wrapped in the {items:[{data:...}]} envelope that
    the frontend's parseContent expects.
    """
    if artifact_type == "document":
        return markdown_artifact(title, content)
    if artifact_type == "mermaid":
        # Mermaid source is raw text; use html_artifact as the carrier
        # with domain_type="mermaid" so the registry resolves windowType.
        env = html_artifact(title, content)
        env.domain_type = "mermaid"
        env.window_type = "mermaid"
        return env
    if artifact_type == "code":
        env = html_artifact(title, content)
        env.domain_type = "code"
        env.window_type = "code"
        env.language = language
        return env
    if artifact_type == "html":
        return html_artifact(title, content)
    if artifact_type == "json":
        env = html_artifact(title, content)
        env.domain_type = "json"
        env.window_type = "json"
        return env
    if artifact_type in _JSON_TYPES:
        # Content already validated as JSON by the caller. Wrap it in the
        # {items:[{data:...}]} envelope so the frontend's parseContent
        # unwraps items[0].data correctly.
        data = json.loads(content)
        return widget_artifact(
            title,
            artifact_type,  # widgetType = domain type
            data,
            window_type=artifact_type,  # registry maps table→table, etc.
        )
    return None


__all__ = ["CreateArtifactTool"]