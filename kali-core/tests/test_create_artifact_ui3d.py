"""Tests for the create_artifact tool — ui3d scene validation & envelope."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kali_core.claws.base import ToolContext
from kali_core.claws.create_artifact import CreateArtifactTool


def _ctx() -> ToolContext:
    return ToolContext(session_id="t", working_dir=str(Path.cwd()), profile="dev")


VALID_SCENE: dict = {
    "elements": {
        "floor": {
            "type": "box", "position": [0, -0.5, 0],
            "scale": [6, 0.1, 6], "color": "#334155",
        },
        "cube": {"type": "box", "position": [0, 0.5, 0], "color": "#38bdf8"},
        "orb": {"type": "sphere", "position": [1.5, 0.5, -1], "color": "#fbbf24"},
        "cluster": {
            "type": "group",
            "children": ["cube", "orb"],
        },
    },
    "root": "cluster",
}


@pytest.mark.asyncio
async def test_ui3d_valid_scene_builds_widget_envelope() -> None:
    result = await CreateArtifactTool().run(
        {"artifact_type": "ui3d", "title": "Escena demo", "content": json.dumps(VALID_SCENE)},
        _ctx(),
    )
    assert result.error is None
    assert result.artifact is not None
    env = result.artifact
    assert env["windowType"] == "ui3d"
    assert env["type"] == "widget"
    assert env["update"] == "create"
    # parseContent on the frontend unwraps items[0].data → the scene.
    items = json.loads(env["content"])["items"]
    assert items[0]["widgetType"] == "ui3d"
    assert items[0]["data"]["elements"]["cube"]["type"] == "box"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        pytest.param("not json", id="invalid-json"),
        pytest.param("[]", id="not-object"),
        pytest.param("{}", id="missing-elements"),
        pytest.param('{"elements": {}}', id="empty-elements"),
        pytest.param(
            '{"elements": {"a": {"type": "dragon"}}}',
            id="unknown-element-type",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "box", "position": [1, 2]}}}',
            id="bad-vec3-length",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "box", "color": "red"}}}',
            id="bad-color",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "group", "children": ["ghost"]}}}',
            id="unknown-child",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "group", "children": ["a"]}}}',
            id="self-cycle",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "group", "children": ["b"]}, '
            '"b": {"type": "group", "children": ["a"]}}}',
            id="mutual-cycle",
        ),
        pytest.param(
            '{"elements": {"a": {"type": "box"}}, "root": "ghost"}',
            id="unknown-root",
        ),
    ],
)
async def test_ui3d_rejects_invalid(content: str) -> None:
    result = await CreateArtifactTool().run(
        {"artifact_type": "ui3d", "title": "x", "content": content},
        _ctx(),
    )
    assert result.error is not None


@pytest.mark.asyncio
async def test_ui3d_rejects_unknown_artifact_type_spelling() -> None:
    """'ui2d' etc. remain unknown; ui3d must be opt-in via the enum."""
    result = await CreateArtifactTool().run(
        {"artifact_type": "ui2d", "title": "x", "content": "{}"},
        _ctx(),
    )
    assert result.error is not None