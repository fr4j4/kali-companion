"""Tests for Phase 3: screenshot, gaze, vision, organize_folder."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kali_core.claws.base import ToolContext, available_tools
from kali_core.claws.organize import OrganizeFolderTool
from kali_core.claws.screenshot import ScreenshotTool
from kali_core.mind.vision import VisionProcessor
from kali_core.server import _register_tools

pytestmark = pytest.mark.asyncio


# ── Registration ────────────────────────────────────────────


async def test_phase3_tools_registered():
    _register_tools()
    names = [t.name for t in available_tools()]
    assert "screenshot" in names
    assert "list_monitors" in names
    assert "organize_folder" in names


# ── GazeClient (local mss-backed) ──────────────────────────


async def test_gaze_client_not_available():
    """When the capture backend is unavailable, GazeClient reports
    connected=False and capture_full raises."""
    from kali_core.gaze import GazeClient

    gc = GazeClient()
    # Force the backend to report unavailable.
    gc._capture._backend._available = False
    assert gc.connected is False
    with pytest.raises(RuntimeError):
        await gc.capture_full()


async def test_gaze_client_capture_full():
    """GazeClient.capture_full delegates to LocalCapture."""
    from kali_core.gaze import GazeClient

    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    gc = GazeClient()
    # Mock the inner LocalCapture to return our fake PNG.
    gc._capture._available = True

    async def fake_capture(output=None):
        return fake_png

    gc._capture.capture_full = fake_capture  # type: ignore[assignment]
    result = await gc.capture_full()
    assert result == fake_png


async def test_gaze_client_capture_full_with_output():
    """GazeClient.capture_full(output=...) forwards the alias."""
    from kali_core.gaze import GazeClient

    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    captured_output: list[str | None] = []
    gc = GazeClient()
    gc._capture._available = True

    async def fake_capture(output=None):
        captured_output.append(output)
        return fake_png

    gc._capture.capture_full = fake_capture  # type: ignore[assignment]
    result = await gc.capture_full(output="primary")
    assert result == fake_png
    assert captured_output == ["primary"]


async def test_gaze_client_list_monitors():
    """GazeClient.list_monitors delegates to LocalCapture."""
    from kali_core.gaze import GazeClient

    fake_monitors = [
        {"id": 1, "name": "Monitor1", "width": 1920, "height": 1080,
         "x": 0, "y": 0, "primary": True, "active": True, "focused": True},
    ]
    gc = GazeClient()
    gc._capture._available = True

    async def fake_list():
        return fake_monitors

    gc._capture.list_monitors = fake_list  # type: ignore[assignment]
    monitors = await gc.list_monitors()
    assert len(monitors) == 1
    assert monitors[0]["name"] == "Monitor1"


# ── ScreenshotTool ──────────────────────────────────────────


async def test_screenshot_tool_no_gaze():
    """ScreenshotTool returns error when no gaze_client in context."""
    tool = ScreenshotTool()
    ctx = ToolContext(session_id="s", working_dir=".", profile="dev")
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "GazeClient" in result.error


async def test_screenshot_tool_success():
    """ScreenshotTool captures and returns base64 image."""
    tool = ScreenshotTool()
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50

    gaze_mock = AsyncMock()
    gaze_mock.capture_full = AsyncMock(return_value=fake_png)

    # Redirect snapshots dir to a temp location so we don't litter.
    with tempfile.TemporaryDirectory() as d:
        with patch("kali_core.claws.screenshot.settings") as mock_settings:
            mock_settings.snapshots_dir = d
            ctx = ToolContext(
                session_id="s",
                working_dir=".",
                profile="dev",
                gaze_client=gaze_mock,
            )
            result = await tool.run({"description": False}, ctx)
        assert result.error is None
        assert result.output["captured"] is True
        assert result.output["size"] == len(fake_png)
        assert result.output["mime"] == "image/png"
        assert result.output["path"]
        saved = Path(result.output["path"])
        assert saved.exists()
        assert saved.read_bytes() == fake_png
        assert saved.suffix == ".png"
        # image_base64 is NOT included in output (would blow LLM context).
        assert "image_base64" not in result.output


async def test_screenshot_tool_vision_fallback():
    """ScreenshotTool captures and describes with vision."""
    tool = ScreenshotTool()
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50

    gaze_mock = AsyncMock()
    gaze_mock.capture_full = AsyncMock(return_value=fake_png)

    ctx = ToolContext(
        session_id="s",
        working_dir=".",
        profile="dev",
        gaze_client=gaze_mock,
    )
    with patch("kali_core.mind.vision.VisionProcessor") as vp_mock:
        vp_instance = AsyncMock()
        vp_instance.process = AsyncMock(return_value="mock description")
        vp_mock.return_value = vp_instance

        result = await tool.run({"description": True}, ctx)
        assert result.error is None
        assert result.output["description"] == "mock description"


async def test_screenshot_tool_capture_fail():
    """ScreenshotTool handles capture failure gracefully."""
    tool = ScreenshotTool()
    gaze_mock = AsyncMock()
    gaze_mock.capture_full = AsyncMock(side_effect=ConnectionError("IPC down"))

    ctx = ToolContext(
        session_id="s",
        working_dir=".",
        profile="dev",
        gaze_client=gaze_mock,
    )
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "IPC down" in result.error or "IPC" in result.error


# ── VisionProcessor ─────────────────────────────────────────


async def test_vision_ocr_unavailable():
    """VisionProcessor returns unavailable message when pytesseract missing."""
    vp = VisionProcessor()
    result = await vp.process(b"\x00" * 100, "image/png")
    assert "OCR unavailable" in result or "vision" in result


async def test_vision_llm_path():
    """VisionProcessor uses LLM provider when available."""
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(
        return_value={"text": "The screen shows a code editor."}
    )
    vp = VisionProcessor(llm_provider=mock_llm)
    result = await vp.process(b"\x00" * 100, "image/png")
    assert "code editor" in result
    mock_llm.complete.assert_called_once()


async def test_vision_llm_no_provider():
    """VisionProcessor returns fallback when no LLM provider configured."""
    vp = VisionProcessor()
    result = await vp.process(b"\x00" * 100, "image/png")
    assert "unavailable" in result or "vision" in result


async def test_vision_llm_caches_failure():
    """VisionProcessor skips LLM after first 400 to avoid repeated failures."""
    # Clear any leftover state from previous tests.
    VisionProcessor._failed_models.clear()
    mock_llm = MagicMock()
    mock_llm._model = "test-no-vision"
    mock_llm.complete = AsyncMock(
        return_value={"text": "[LLM error: Error code: 400 - Bad Request]"}
    )
    vp = VisionProcessor(llm_provider=mock_llm)
    # First call hits the API and fails.
    result1 = await vp.process(b"\x00" * 100, "image/png")
    assert "vision via LLM failed" in result1
    assert mock_llm.complete.call_count == 1
    # Second call should skip the API (cached failure) and go to OCR.
    result2 = await vp.process(b"\x00" * 100, "image/png")
    assert "skipped" in result2
    # complete() should NOT have been called again.
    assert mock_llm.complete.call_count == 1
    VisionProcessor._failed_models.clear()


# ── OrganizeFolderTool ──────────────────────────────────────


async def test_organize_dry_run():
    tool = OrganizeFolderTool()
    with tempfile.TemporaryDirectory() as d:
        # Create files of different types.
        Path(d, "photo.jpg").write_text("img")
        Path(d, "doc.pdf").write_text("pdf")
        Path(d, "script.py").write_text("code")
        Path(d, "archive.zip").write_text("zip")
        Path(d, "song.mp3").write_text("audio")
        Path(d, "video.mp4").write_text("video")
        Path(d, "notes.txt").write_text("text")

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"path": d, "action": "dry_run"}, ctx)
        assert result.error is None
        assert result.output["action"] == "dry_run"
        assert result.output["total_files"] == 7
        summary = result.output["summary"]
        assert "Images" in summary
        assert "Documents" in summary
        assert "Code" in summary


async def test_organize_execute():
    tool = OrganizeFolderTool()
    with tempfile.TemporaryDirectory() as d:
        Path(d, "photo.jpg").write_text("img")
        Path(d, "script.py").write_text("code")

        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"path": d, "action": "organize"}, ctx)
        assert result.error is None
        assert result.output["action"] == "organize"
        assert result.output["moved"] == 2
        assert (Path(d) / "Images" / "photo.jpg").exists()
        assert (Path(d) / "Code" / "script.py").exists()


async def test_organize_nonexistent_folder():
    tool = OrganizeFolderTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="dev")
    result = await tool.run({"path": "/nonexistent/path"}, ctx)
    assert result.error is not None
    assert "does not exist" in result.error


async def test_organize_dry_run_empty_folder():
    tool = OrganizeFolderTool()
    with tempfile.TemporaryDirectory() as d:
        ctx = ToolContext(session_id="t", working_dir=d, profile="dev")
        result = await tool.run({"path": d, "action": "dry_run"}, ctx)
        assert result.error is None
        assert result.output["total_files"] == 0


# ── ToolContext gaze_client ─────────────────────────────────


async def test_tool_context_gaze():
    """ToolContext passes gaze_client correctly."""
    gaze_mock = MagicMock()
    ctx = ToolContext(
        session_id="s",
        working_dir=".",
        profile="dev",
        gaze_client=gaze_mock,
    )
    assert ctx.gaze_client is gaze_mock


# ── ScreenshotTool monitor + sample ──────────────────────────


async def test_screenshot_tool_passes_monitor_to_gaze():
    """The `monitor` param is forwarded to gaze.capture_full(output=...)."""
    tool = ScreenshotTool()
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    gaze_mock = AsyncMock()
    gaze_mock.capture_full = AsyncMock(return_value=fake_png)

    with tempfile.TemporaryDirectory() as d, patch(
        "kali_core.claws.screenshot.settings"
    ) as mock_settings:
        mock_settings.snapshots_dir = d
        ctx = ToolContext(
            session_id="s", working_dir=".", profile="dev",
            gaze_client=gaze_mock,
        )
        result = await tool.run(
            {"monitor": "HDMI-A-1", "description": False,
             "reason": "verify game", "sample": True},
            ctx,
        )
    assert result.error is None
    gaze_mock.capture_full.assert_awaited_once_with(output="HDMI-A-1")
    assert result.output["monitor"] == "HDMI-A-1"
    assert result.output["path"]


async def test_screenshot_tool_no_monitor_passes_none():
    """When no monitor is given, output=None is forwarded (composition)."""
    tool = ScreenshotTool()
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    gaze_mock = AsyncMock()
    gaze_mock.capture_full = AsyncMock(return_value=fake_png)

    with tempfile.TemporaryDirectory() as d, patch(
        "kali_core.claws.screenshot.settings"
    ) as mock_settings:
        mock_settings.snapshots_dir = d
        ctx = ToolContext(
            session_id="s", working_dir=".", profile="dev",
            gaze_client=gaze_mock,
        )
        result = await tool.run({"description": False}, ctx)
    assert result.error is None
    gaze_mock.capture_full.assert_awaited_once_with(output=None)


# ── ListMonitorsTool ─────────────────────────────────────────


async def test_list_monitors_tool_success():
    from kali_core.claws.list_monitors import ListMonitorsTool

    tool = ListMonitorsTool()
    gaze_mock = AsyncMock()
    gaze_mock.list_monitors = AsyncMock(return_value=[
        {"id": 0, "name": "HDMI-A-1", "description": "Main", "width": 1920,
         "height": 1080, "x": 0, "y": 0, "active": True, "focused": True},
        {"id": 1, "name": "DP-1", "description": "Side", "width": 2560,
         "height": 1440, "x": 1920, "y": 0, "active": True, "focused": False},
    ])
    ctx = ToolContext(
        session_id="s", working_dir=".", profile="dev", gaze_client=gaze_mock,
    )
    result = await tool.run({}, ctx)
    assert result.error is None
    assert result.output["count"] == 2
    assert result.output["primary_guess"] == "HDMI-A-1"
    names = [m["name"] for m in result.output["monitors"]]
    assert names == ["HDMI-A-1", "DP-1"]


async def test_list_monitors_tool_no_gaze():
    from kali_core.claws.list_monitors import ListMonitorsTool

    tool = ListMonitorsTool()
    ctx = ToolContext(session_id="s", working_dir=".", profile="dev")
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "GazeClient" in result.error


async def test_list_monitors_tool_ipc_error():
    from kali_core.claws.list_monitors import ListMonitorsTool

    tool = ListMonitorsTool()
    gaze_mock = AsyncMock()
    gaze_mock.list_monitors = AsyncMock(
        side_effect=RuntimeError("backend unavailable"),
    )
    ctx = ToolContext(
        session_id="s", working_dir=".", profile="dev", gaze_client=gaze_mock,
    )
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "backend unavailable" in result.error


# ── Gateway consent reason for screenshot ────────────────────


async def test_gateway_screenshot_reason_param():
    """Gateway reads the new `reason` param instead of the old `target`."""
    from kali_core.collar.gateway import PermissionGateway

    gw = PermissionGateway()
    # 'dev' profile does not whitelist screenshot → needs consent.
    decision = gw.check("screenshot", "sensitive", {"reason": "verify game"}, "general")
    assert decision.needs_consent
    assert decision.reason_key == "consent.reason.screenshot"
    assert decision.reason_params["reason"] == "verify game"


async def test_gateway_screenshot_reason_empty():
    """Empty reason falls back to an empty string (UI shows generic)."""
    from kali_core.collar.gateway import PermissionGateway

    gw = PermissionGateway()
    decision = gw.check("screenshot", "sensitive", {}, "general")
    assert decision.needs_consent
    assert decision.reason_params["reason"] == ""


async def test_gateway_list_monitors_needs_consent():
    """list_monitors is whitelisted in 'general' profile → no consent."""
    from kali_core.collar.gateway import PermissionGateway

    gw = PermissionGateway()
    decision = gw.check("list_monitors", "sensitive", {}, "general")
    # 'general' whitelists list_monitors, so no consent needed.
    assert decision.allow
    assert not decision.needs_consent
