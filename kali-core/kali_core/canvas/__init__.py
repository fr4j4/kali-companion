"""kali-canvas — artifact event helpers and registry.

This package provides:
- ``ArtifactEnvelope``: typed payload (replaces plain-dict builders).
- ``ArtifactRegistry`` / ``resolve_window_type``: single source of truth
  mapping domain types → generic frontend window types.
- ``ArtifactStreamer``: generic progressive streaming helper.
- Builder functions (``html_artifact``, ``markdown_artifact``,
  ``diff_artifact``, ``widget_artifact``) that return ``ArtifactEnvelope``
  instances for convenience.

The UI side lives in kali-web's ``components/widgets/``.
"""

from __future__ import annotations

from .registry import (
    ArtifactEnvelope,
    diff_artifact,
    html_artifact,
    is_game_resource,
    markdown_artifact,
    resolve_window_type,
    widget_artifact,
)
from .streamer import ArtifactStreamer

__all__ = [
    "ArtifactEnvelope",
    "ArtifactStreamer",
    "resolve_window_type",
    "is_game_resource",
    "html_artifact",
    "markdown_artifact",
    "diff_artifact",
    "widget_artifact",
]