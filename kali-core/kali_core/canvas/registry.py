"""kali-canvas registry — single source of truth for artifact types.

The registry maps **domain types** (what a tool knows: ``hero``, ``item``,
``diff``, ``markdown`` ...) to **generic window types** (what the frontend
renders: ``entity``, ``resource``, ``diff``, ``document`` ...).

Tools never touch ``windowType`` directly. They declare *what* they
produced (the domain type) and the registry resolves *how* the frontend
should render it. This removes the four duplicate mapping tables that
existed before (``_WIDGET_TYPE_MAP``, two copies of ``_RES_TYPE_MAP``,
and the frontend ``LEGACY_MAP``).

Adding a new artifact type = adding one row to ``_DOMAIN_TO_WINDOW``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# ── Streamable vs non-streamable artifact types ─────────────────
#
# Single source of truth for which artifact types render meaningfully as
# they grow (streamable: the frontend shows the content live during
# streaming) versus which need to be complete to render (non-streamable:
# the frontend shows a spinner during streaming and renders on close).
#
# ``artifact_stream.py`` reexports these so existing imports keep working.
STREAMABLE_TYPES: frozenset[str] = frozenset({
    "code", "document", "diff", "html", "mermaid",
})

NON_STREAMABLE_TYPES: frozenset[str] = frozenset({
    "json", "table", "checklist", "chart", "quiz",
})


def is_streamable_type(artifact_type: str) -> bool:
    """True if ``artifact_type`` supports live streaming and patch-mode edits.

    Streamable types are plain text (code, document, diff, html, mermaid),
    so their content can be edited surgically via string replacement
    (``update_artifact`` patch mode) and read by line ranges
    (``get_artifact`` offset/limit). Non-streamable types are JSON
    structures that require full-content replacement.
    """
    return artifact_type in STREAMABLE_TYPES


# ── Domain → window type mapping (the single backend source of truth) ──
#
# Keys are domain types a tool might emit (the ``data.type`` field of a
# widget, or the ``type`` of an html/markdown/diff artifact). Values are
# the generic ``WindowType`` strings the frontend understands.
#
# This mirrors the frontend ``WindowType`` union in kali-web/src/workspace/types.ts.
# When adding a new window type you MUST also add it there (the TS compiler
# enforces exhaustiveness across the 5 frontend lookup tables).
_DOMAIN_TO_WINDOW: dict[str, str] = {
    # ── game resources ──
    "hero": "entity",
    "item": "resource",
    "location": "place",
    "ability": "entity",
    "info": "entity",
    # ── widget sub-types (legacy/forward-compat) ──
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
    "img": "image",
    # ── non-widget artifact types ──
    "html": "html",
    "diff": "diff",
    "document": "document",
}

# Generic window types that are valid pass-through values (already
# canonical, no mapping needed). Mirrors the frontend ``VALID_TYPES`` set.
_VALID_WINDOW_TYPES: frozenset[str] = frozenset({
    "code", "link", "mermaid", "qr", "chart", "json",
    "terminal", "checklist", "quiz", "diff", "table", "controls",
    "html", "widget", "entity", "resource", "place", "media",
    "document", "image",
})

# Default fallback when nothing matches.
_DEFAULT_WINDOW_TYPE = "widget"


def resolve_window_type(domain_type: str, explicit: str = "") -> str:
    """Resolve a domain type (or an explicit windowType) to a generic window type.

    Resolution order:
    1. If ``explicit`` is already a valid canonical window type, use it.
    2. If ``explicit`` is a known domain type, map it.
    3. If ``domain_type`` is a known domain type, map it.
    4. If ``domain_type`` is itself a valid canonical window type, pass through.
    5. Fall back to ``_DEFAULT_WINDOW_TYPE``.
    """
    if explicit:
        if explicit in _VALID_WINDOW_TYPES:
            return explicit
        if explicit in _DOMAIN_TO_WINDOW:
            return _DOMAIN_TO_WINDOW[explicit]
    if domain_type:
        if domain_type in _DOMAIN_TO_WINDOW:
            return _DOMAIN_TO_WINDOW[domain_type]
        if domain_type in _VALID_WINDOW_TYPES:
            return domain_type
    return _DEFAULT_WINDOW_TYPE


def is_game_resource(domain_type: str) -> bool:
    """True if the domain type is a game-resource variant that blocks web fetches."""
    return domain_type in ("hero", "item", "location", "ability", "game_resource")


# ── Artifact envelope ──────────────────────────────────────────


@dataclass
class ArtifactEnvelope:
    """Typed artifact payload — replaces the plain-dict returns of the
    old builder functions.

    Serialized to a plain dict for the WS wire format via ``to_payload()``.
    The executor owns persistence and emission; tools just build envelopes.
    """

    type: str  # "html" | "markdown" | "diff" | "widget"
    title: str
    content: str  # raw text (html/markdown/diff) or JSON string (widget)
    window_type: str = ""  # generic windowType; "" → resolved by registry
    artifact_id: str = ""
    update: str = "create"  # "create" | "update" | "close"
    domain_type: str = ""  # domain hint for window_type resolution (widget only)
    language: str = ""  # programming language (e.g. "python", "java")

    def to_payload(self) -> dict[str, Any]:
        """Convert to the WS wire-format dict (``event: "artifact"``)."""
        wt = self.window_type or resolve_window_type(self.domain_type)
        return {
            "event": "artifact",
            "id": self.artifact_id,
            "type": self.type,
            "windowType": wt,
            "title": self.title,
            "content": self.content,
            "update": self.update,
            "language": self.language,
        }


# ── Envelope builder helpers ───────────────────────────────────


def html_artifact(
    title: str, content: str, *, artifact_id: str = "", update: str = "create",
) -> ArtifactEnvelope:
    """Build an HTML artifact envelope."""
    return ArtifactEnvelope(
        type="html", title=title, content=content,
        window_type="html", artifact_id=artifact_id, update=update,
    )


def markdown_artifact(
    title: str, content: str, *, artifact_id: str = "", update: str = "create",
) -> ArtifactEnvelope:
    """Build a markdown/document artifact envelope."""
    return ArtifactEnvelope(
        type="markdown", title=title, content=content,
        window_type="document", artifact_id=artifact_id, update=update,
    )


def diff_artifact(
    title: str, content: str, *, artifact_id: str = "", update: str = "create",
) -> ArtifactEnvelope:
    """Build a diff artifact envelope."""
    return ArtifactEnvelope(
        type="diff", title=title, content=content,
        window_type="diff", artifact_id=artifact_id, update=update,
    )


def widget_artifact(
    title: str,
    widget_type: str,
    data: dict[str, Any],
    *,
    artifact_id: str = "",
    update: str = "create",
    window_type: str = "",
) -> ArtifactEnvelope:
    """Build a widget artifact envelope (activity cards).

    ``widget_type`` is the domain widget identifier (e.g. ``game_resource``).
    ``data`` is the widget payload (sections, stats, etc.).
    ``window_type`` may be set explicitly; if empty, the registry resolves
    it from ``widget_type`` (or from ``data["type"]`` for game resources).
    """
    import json

    item = {
        "title": title,
        "description": "",
        "status": "info",
        "widgetType": widget_type,
        "data": data,
    }
    domain_type = data.get("type", "") if isinstance(data, dict) else ""
    # For game_resource widgets, the domain type is the data.type (hero/item/...).
    effective_domain = domain_type if widget_type == "game_resource" else widget_type
    return ArtifactEnvelope(
        type="widget", title=title,
        content=json.dumps({"items": [item]}),
        window_type=window_type,
        artifact_id=artifact_id, update=update,
        domain_type=effective_domain,
    )


__all__ = [
    "ArtifactEnvelope",
    "resolve_window_type",
    "is_game_resource",
    "is_streamable_type",
    "STREAMABLE_TYPES",
    "NON_STREAMABLE_TYPES",
    "html_artifact",
    "markdown_artifact",
    "diff_artifact",
    "widget_artifact",
]