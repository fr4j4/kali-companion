"""kali-gaze local capture — screen capture via grim (Wayland) or mss (other).

Cross-platform screen capture. On Linux/Wayland (Hyprland) we use `grim`
via subprocess because mss uses the X11 backend, which under XWayland
captures an empty (black) buffer — the Wayland compositor doesn't render
into the X11 root window. `grim` speaks the Wayland protocols directly and
returns a real image.

On Windows, macOS, and Linux/X11-puro, `mss` works correctly (it uses the
native screen-capture APIs of each OS, not X11-via-XWayland), so we keep
it as the fallback there.

The public interface (list_monitors, capture_full) is identical across
backends so callers (claws/screenshot.py, claws/list_monitors.py) don't
change.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from typing import Any, Protocol

logger = logging.getLogger("kali_core.gaze.local")


class CaptureBackend(Protocol):
    """Interface every capture backend implements."""

    @property
    def available(self) -> bool: ...

    async def list_monitors(self) -> list[dict]: ...

    async def capture_full(self, output: str | None = None) -> bytes: ...


# ── grim backend (Linux/Wayland/Hyprland) ──────────────────────────


def _is_wayland() -> bool:
    import os

    return bool(os.getenv("WAYLAND_DISPLAY"))


def _has_grim() -> bool:
    return shutil.which("grim") is not None


def _has_hyprctl() -> bool:
    return shutil.which("hyprctl") is not None


class GrimCapture:
    """Screen capture via grim + hyprctl (Linux/Wayland/Hyprland)."""

    def __init__(self) -> None:
        self._available = _is_wayland() and _has_grim()

    @property
    def available(self) -> bool:
        return self._available

    async def list_monitors(self) -> list[dict]:
        if not self._available or not _has_hyprctl():
            return []

        proc = await asyncio.create_subprocess_exec(
            "hyprctl", "monitors", "-j",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return []
        raw = json.loads(stdout.decode("utf-8", errors="replace"))
        monitors: list[dict] = []
        for idx, m in enumerate(raw, start=1):
            monitors.append(
                {
                    "id": idx,
                    "name": m.get("name", f"Monitor{idx}"),
                    "description": m.get("description", m.get("name", "")),
                    "width": m.get("width", 0),
                    "height": m.get("height", 0),
                    "x": m.get("x", 0),
                    "y": m.get("y", 0),
                    "primary": m.get("focused", idx == 1),
                    "active": True,
                    "focused": m.get("focused", False),
                    "refresh_rate": m.get("refreshRate", 0),
                    "transform": m.get("transform", 0),
                }
            )
        return monitors

    async def capture_full(self, output: str | None = None) -> bytes:
        if not self._available:
            raise RuntimeError("grim capture not available")

        resolved = await self._resolve_output(output)
        cmd = ["grim"]
        if resolved:
            cmd += ["-o", resolved]
        cmd += ["-"]  # write PNG to stdout

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"grim failed (code={proc.returncode}): "
                f"{stderr.decode('utf-8', errors='replace').strip()}"
            )
        return stdout

    async def _resolve_output(self, output: str | None) -> str | None:
        """Map an alias ('primary', 'secondary', 'Monitor1', ...) or a raw
        output name to the real Hyprland output name (e.g. 'DP-4')."""
        if output is None or output == "":
            return None  # composite (all monitors)
        monitors = await self.list_monitors()
        if not monitors:
            return output  # let grim try it directly
        # primary = first focused (or first); secondary = first non-focused.
        focused = next((m for m in monitors if m.get("focused")), monitors[0])
        non_focused = [m for m in monitors if m["name"] != focused["name"]]
        alias_map = {
            "primary": focused["name"],
            "secondary": non_focused[0]["name"] if non_focused else None,
            "tertiary": non_focused[1]["name"] if len(non_focused) > 1 else None,
        }
        low = output.lower()
        if low in alias_map and alias_map[low] is not None:
            return alias_map[low]
        # "Monitor1", "Monitor2" → index-based.
        if output.startswith("Monitor"):
            try:
                idx = int(output[len("Monitor"):])
                if 1 <= idx <= len(monitors):
                    return monitors[idx - 1]["name"]
            except ValueError:
                pass
        # Otherwise assume the caller passed a real output name (DP-4, HDMI-A-1).
        return output


# ── mss backend (Windows, macOS, Linux/X11-puro) ───────────────────


class MssCapture:
    """Screen capture via mss (Windows/macOS/Linux-X11)."""

    def __init__(self) -> None:
        self._sct: Any = None
        self._available = False
        try:
            import mss  # noqa: F401

            self._available = True
        except ImportError:
            logger.warning("mss not installed; screen capture disabled")

    @property
    def available(self) -> bool:
        return self._available

    def _ensure_sct(self) -> Any:
        if self._sct is None:
            import mss

            self._sct = mss.mss()
        return self._sct

    async def list_monitors(self) -> list[dict]:
        if not self._available:
            return []

        def _enumerate() -> list[dict]:
            sct = self._ensure_sct()
            monitors: list[dict] = []
            raw = sct.monitors
            for idx, m in enumerate(raw[1:], start=1):
                monitors.append(
                    {
                        "id": idx,
                        "name": f"Monitor{idx}",
                        "description": f"Monitor {idx}",
                        "width": m["width"],
                        "height": m["height"],
                        "x": m["left"],
                        "y": m["top"],
                        "primary": idx == 1,
                        "active": True,
                        "focused": idx == 1,
                        "refresh_rate": 0,
                        "transform": 0,
                    }
                )
            return monitors

        return await asyncio.to_thread(_enumerate)

    async def capture_full(self, output: str | None = None) -> bytes:
        if not self._available:
            raise RuntimeError("mss is not available; cannot capture screen")

        def _grab() -> bytes:
            sct = self._ensure_sct()
            raw_monitors = sct.monitors
            if output is None or output == "":
                target = raw_monitors[0]
            else:
                alias_map = {"primary": 1, "secondary": 2, "tertiary": 3}
                idx = alias_map.get(output.lower())
                if idx is None and output.startswith("Monitor"):
                    try:
                        idx = int(output[len("Monitor"):])
                    except ValueError:
                        idx = None
                if idx is None:
                    raise RuntimeError(f"Unknown monitor alias: {output}")
                if idx >= len(raw_monitors):
                    raise RuntimeError(
                        f"Monitor index {idx} out of range "
                        f"(have {len(raw_monitors) - 1} monitors)"
                    )
                target = raw_monitors[idx]
            shot = sct.grab(target)
            from mss.tools import to_png

            return to_png(shot.rgb, shot.size)

        return await asyncio.to_thread(_grab)


# ── Backend selector ──────────────────────────────────────────────


def _select_backend() -> CaptureBackend:
    """Pick the best available backend for this platform.

    On Linux/Wayland with grim installed, use grim (mss captures a black
    buffer under XWayland). Everywhere else, use mss.
    """
    import sys

    if sys.platform == "linux" and _is_wayland() and _has_grim():
        logger.info("using grim capture backend (Wayland)")
        return GrimCapture()
    logger.info("using mss capture backend")
    return MssCapture()


class LocalCapture:
    """Cross-platform screen capture.

    Delegates to the best backend for the platform (grim on Wayland,
    mss elsewhere). The public interface matches the old GazeClient so
    callers don't change.
    """

    def __init__(self) -> None:
        self._backend: CaptureBackend = _select_backend()

    @property
    def available(self) -> bool:
        return self._backend.available

    async def list_monitors(self) -> list[dict]:
        return await self._backend.list_monitors()

    async def capture_full(self, output: str | None = None) -> bytes:
        return await self._backend.capture_full(output)