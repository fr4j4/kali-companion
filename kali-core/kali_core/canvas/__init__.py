"""kali-canvas — artifact event helpers.

Builds artifact event payloads for tools that produce visual output
(HTML mockups, markdown docs, code diffs, activity widgets). The UI side
lives in kali-web's `components/artifacts/`.
"""

from __future__ import annotations

import json


def html_artifact(
    title: str, content: str, artifact_id: str = "", update: str = "create"
) -> dict:
    """Build an HTML artifact event payload."""
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "html",
        "title": title,
        "content": content,
        "update": update,
    }


def markdown_artifact(
    title: str, content: str, artifact_id: str = "", update: str = "create"
) -> dict:
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "markdown",
        "title": title,
        "content": content,
        "update": update,
    }


def diff_artifact(
    title: str, content: str, artifact_id: str = "", update: str = "create"
) -> dict:
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "diff",
        "title": title,
        "content": content,
        "update": update,
    }


def widget_artifact(
    title: str,
    widget_type: str,
    data: dict,
    artifact_id: str = "",
    update: str = "create",
) -> dict:
    """Build a widget artifact event payload (activity cards).

    The frontend WidgetGrid expects ``content`` to be a JSON object with
    an ``items`` array. Each item has ``title``, ``description``,
    ``status``, ``widgetType``, and ``data``.

    Set ``update="update"`` with the same ``artifact_id`` to stream
    progressive changes to an existing widget artifact.
    """
    item = {
        "title": title,
        "description": "",
        "status": "info",
        "widgetType": widget_type,
        "data": data,
    }
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "widget",
        "title": title,
        "content": json.dumps({"items": [item]}),
        "update": update,
    }


__all__ = ["html_artifact", "markdown_artifact", "diff_artifact", "widget_artifact"]