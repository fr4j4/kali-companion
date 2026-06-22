"""Dota 2 Live Game State tool — queries the current match data from GSI."""

from __future__ import annotations

import logging

from ..base import ToolContext, ToolResult
from ...game.gsi import gsi_state

logger = logging.getLogger("kali_core.claws.game.dota_live")


class DotaLiveStateTool:
    name = "dota_live_state"
    description = (
        "Fetch real-time data from the current Dota 2 match: hero, level, K/D/A, "
        "items, gold, XP, score, buildings, and game time. Returns a human-readable "
        "summary. Only works while Dota 2 is running with GSI configured."
    )
    schema = {
        "type": "object",
        "properties": {},
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        if not gsi_state.state:
            return ToolResult(
                output="No hay datos de Dota 2. GSI no ha recibido información. "
                "Asegúrate de estar en una partida y que GSI esté configurado."
            )
        return ToolResult(output=gsi_state.summarize())


__all__ = ["DotaLiveStateTool"]