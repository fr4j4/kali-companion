"""Dota builds tool — recommends builds via OpenDota API through Dota2Adapter."""

from __future__ import annotations

import logging

from ..base import ToolContext, ToolResult
from ...canvas import widget_artifact
from .dota2_adapter import Dota2Adapter
from .image_cache import download_game_images_handler

logger = logging.getLogger("kali_core.claws.game.dota")

_adapter = Dota2Adapter()


class DotaBuildsTool:
    name = "fetch_dota2_build"
    description = (
        "LOOKUP Dota 2 hero builds, win rates, and popular items via the "
        "OpenDota API. Provides structured data with early/mid/late game items. "
        "Use this INSTEAD of web_search or web_fetch when the user asks about "
        "Dota 2 heroes — this tool returns accurate real-time stats."
    )
    schema = {
        "type": "object",
        "properties": {
            "hero": {
                "type": "string",
                "description": "Hero name (e.g. 'Juggernaut', 'Pudge').",
            },
            "item": {
                "type": "string",
                "description": "Item name to look up (e.g. 'Blink Dagger', 'Tango'). "
                "Returns full details: cost, description, recipe tree, stats, builds into.",
            },
        },
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        query = (params.get("item") or params.get("hero") or "").strip()
        if not query:
            return ToolResult(error="Missing 'hero' or 'item' parameter.")

        schema = await _adapter.build_resource(query, ctx)
        if schema is None:
            return ToolResult(error=f"Could not find Dota 2 data for '{query}'.")

        # Spawn background image download (non-blocking).
        await self._spawn_image_download(schema, ctx)

        return ToolResult(
            output=schema.raw,
            artifact=widget_artifact(
                f"Dota 2 — {schema.title}",
                "game_resource",
                {
                    "game": schema.game,
                    "type": schema.type,
                    "title": schema.title,
                    "image": schema.image,
                    "sections": schema.sections,
                },
            ),
        )

    async def _spawn_image_download(self, schema, ctx) -> None:
        job_mgr = getattr(ctx, "job_mgr", None)
        if job_mgr is None:
            return
        images = _adapter.build_image_requests(schema)
        if not images:
            return
        from ...config import settings
        await job_mgr.spawn(
            "game_image_download",
            {
                "images": [vars(img) for img in images],
                "images_dir": settings.images_dir,
                "db_path": settings.db_path,
            },
            session_id=ctx.session_id,
        )


__all__ = ["DotaBuildsTool"]
