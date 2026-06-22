"""Game tools — Dota builds, generic game info.

`game_info` supports a "no-spoiler" mode so Kali can help without
ruining the story. `fetch_dota2_build` recommends Dota 2 builds.
"""

from __future__ import annotations

from .dota import DotaBuildsTool
from .generic import GameInfoTool

__all__ = ["DotaBuildsTool", "GameInfoTool"]