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
_JSON_TYPES = frozenset({"table", "checklist", "chart"})
_VALID_TYPES = _RAW_TYPES | _JSON_TYPES


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
        "- 'code': source code text (rendered with line numbers)\n"
        "- 'html': raw HTML (rendered in a sandboxed iframe)\n"
        "- 'json': a JSON string (rendered as an expandable tree)\n"
        "- 'table': JSON {\"rows\": [{\"col\": val, ...}]} (sortable table)\n"
        "- 'checklist': JSON {\"items\": [{\"text\": str, \"done\": bool}]}\n\n"
        "For 'table' and 'checklist', content must be a valid JSON string.\n"
        "For other types, content is raw text."
    )
    schema = {
        "type": "object",
        "properties": {
            "artifact_type": {
                "type": "string",
                "enum": ["document", "mermaid", "code", "html", "json",
                         "table", "checklist"],
                "description": (
                    "document=markdown text, mermaid=diagram syntax, "
                    "code=source code, html=HTML, json=JSON string, "
                    'table=JSON {"rows":[...]}, checklist=JSON {"items":[...]}'
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
            "language": {
                "type": "string",
                "description": (
                    "Programming language for 'code' artifacts "
                    "(e.g. 'python', 'java', 'javascript', 'rust'). "
                    "Used for syntax highlighting. Optional but recommended."
                ),
            },
        },
        "required": ["artifact_type", "title", "content"],
    }
    risk_level = "safe"

    async def run(self, params: dict[str, Any], ctx: ToolContext) -> ToolResult:
        atype = params.get("artifact_type", "").strip()
        title = params.get("title", "").strip()
        content = params.get("content", "")
        language = params.get("language", "").strip()

        if not atype:
            return ToolResult(error="Missing 'artifact_type' parameter.")
        if atype not in _VALID_TYPES:
            return ToolResult(
                error=f"Unknown artifact_type '{atype}'. "
                      f"Valid: {sorted(_VALID_TYPES)}"
            )
        if not title:
            return ToolResult(error="Missing 'title' parameter.")

        # Validate JSON types have valid JSON content before building.
        if atype in _JSON_TYPES:
            try:
                json.loads(content)
            except (json.JSONDecodeError, TypeError) as e:
                return ToolResult(
                    error=f"Invalid JSON for {atype}: {e}. "
                          f"Content must be valid JSON."
                )

        envelope = _build_envelope(atype, title, content, language)
        if envelope is None:
            return ToolResult(error=f"Failed to build artifact of type '{atype}'.")

        return ToolResult(
            output={
                "artifact_type": atype,
                "title": title,
            },
            artifact=envelope.to_payload(),
        )


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