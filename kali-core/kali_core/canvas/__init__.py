"""kali-canvas — artifact event helpers.

Builds artifact event payloads for tools that produce visual output
(HTML mockups, markdown docs, code diffs, activity widgets). The UI side
lives in kali-web's `components/artifacts/`.

Each artifact carries a ``windowType`` field that tells the frontend which
spatial-window renderer to use (hero, item, code, markdown, diff, etc.).
This avoids fragile heuristic inference on the client side.
"""

from __future__ import annotations

import json


def html_artifact(
    title: str,
    content: str,
    artifact_id: str = "",
    update: str = "create",
    window_type: str = "html",
) -> dict:
    """Build an HTML artifact event payload."""
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "html",
        "windowType": window_type,
        "title": title,
        "content": content,
        "update": update,
    }


def markdown_artifact(
    title: str,
    content: str,
    artifact_id: str = "",
    update: str = "create",
    window_type: str = "document",
) -> dict:
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "markdown",
        "windowType": window_type,
        "title": title,
        "content": content,
        "update": update,
    }


def diff_artifact(
    title: str,
    content: str,
    artifact_id: str = "",
    update: str = "create",
    window_type: str = "diff",
) -> dict:
    return {
        "event": "artifact",
        "id": artifact_id,
        "type": "diff",
        "windowType": window_type,
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
    window_type: str = "",
) -> dict:
    """Build a widget artifact event payload (activity cards).

    The frontend WidgetGrid expects ``content`` to be a JSON object with
    an ``items`` array. Each item has ``title``, ``description``,
    ``status``, ``widgetType``, and ``data``.

    Set ``update="update"`` with the same ``artifact_id`` to stream
    progressive changes to an existing widget artifact.

    ``window_type`` tells the frontend which spatial-window renderer to
    use (e.g. ``entity``, ``resource``, ``document``, ``code``).  If
    omitted (empty string), the executor's ``_derive_window_type``
    safety-net will derive a sensible default from the artifact type
    and widget_type.
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
        "windowType": window_type,
        "title": title,
        "content": json.dumps({"items": [item]}),
        "update": update,
    }


__all__ = ["html_artifact", "markdown_artifact", "diff_artifact", "widget_artifact"]