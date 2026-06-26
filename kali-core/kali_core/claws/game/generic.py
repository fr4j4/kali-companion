"""Generic game info tool — web_search wrapper with anti-spoiler filter.

Searches the web for game information and applies a heuristic filter to
redact spoiler content. Uses web_search internally.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..base import ToolContext, ToolResult
from .spoiler_filter import SPOILER_DOMAINS, filter_text, is_spoiler_domain

logger = logging.getLogger("kali_core.claws.game.generic")

_SEARXNG_TIMEOUT = 10.0


class GameInfoTool:
    name = "game_info"
    description = (
        "Look up game reviews, gameplay tips, guides, and general information "
        "strictly without spoilers. For character/hero/item lookups, use "
        "fetch_game_resource instead."
    )
    schema = {
        "type": "object",
        "properties": {
            "game": {
                "type": "string",
                "description": "Name of the game to look up.",
            },
            "topic": {
                "type": "string",
                "description": (
                    "Topic: 'gameplay', 'review', 'tips', "
                    "'build_order', 'achievements', or any custom query. "
                    "Default 'tips'."
                ),
            },
        },
        "required": ["game"],
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        game = params.get("game", "").strip()
        topic = params.get("topic", "tips").strip()

        if not game:
            return ToolResult(error="Missing 'game' parameter.")

        from kali_core.config import settings

        query = f"{game} {topic} no spoilers guide"
        searxng_url = settings.searxng_url

        try:
            async with httpx.AsyncClient(timeout=_SEARXNG_TIMEOUT) as client:
                resp = await client.get(
                    f"{searxng_url}/search",
                    params={"q": query, "format": "json"},
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            return ToolResult(error=f"Search failed: {e}")

        raw_results = (data.get("results") or [])[:8]

        # Filter out spoiler domains.
        results: list[dict[str, Any]] = []
        for r in raw_results:
            url = r.get("url", "")
            if is_spoiler_domain(url):
                continue
            content = (r.get("content", "") or "")[:500]
            filtered, spoiler_count = filter_text(content)
            results.append({
                "title": r.get("title", ""),
                "url": url,
                "content": filtered,
                "spoilers_filtered": spoiler_count,
            })

        total_spoilers = sum(r["spoilers_filtered"] for r in results)

        # Fetch top 3 results for full content.
        enriched: list[dict[str, Any]] = []
        for r in results[:3]:
            full_content = await self._fetch_full(r["url"])
            if full_content:
                filtered, _ = filter_text(full_content[:2000])
                r["content"] = filtered[:500]
            enriched.append(r)

        # Build sections for the widget card.
        sections = []
        for r in enriched[:3]:
            sections.append({
                "id": f"result_{enriched.index(r)}",
                "title": r["title"],
                "type": "text",
                "text": r["content"],
            })

        from kali_core.canvas import widget_artifact

        return ToolResult(
            output={
                "game": game,
                "topic": topic,
                "query": query,
                "total_results": len(enriched),
                "results": enriched,
                "spoilers_filtered_total": total_spoilers,
            },
            artifact=widget_artifact(
                f"{game} — {topic}",
                "game_resource",
                {
                    "game": game.lower().replace(" ", "-"),
                    "type": "info",
                    "title": topic,
                    "image": None,
                    "sections": sections,
                },
            ).to_payload(),
        )

    async def _fetch_full(self, url: str) -> str | None:
        if not url.startswith(("http://", "https://")):
            return None
        try:
            async with httpx.AsyncClient(
                timeout=_SEARXNG_TIMEOUT, follow_redirects=True
            ) as client:
                resp = await client.get(
                    url, headers={"User-Agent": "Kali/0.1"}
                )
                resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                import re
                html = re.sub(
                    r"<(script|style)[^>]*>.*?</\1>", "", resp.text,
                    flags=re.DOTALL | re.IGNORECASE,
                )
                text = re.sub(r"<[^>]+>", " ", html)
                return re.sub(r"\s+", " ", text).strip()
            return resp.text[:2000]
        except Exception:
            return None
