"""Web tools — web_search, web_fetch.

web_search uses a SearXNG instance (configurable via KALI_SEARXNG_URL).
web_fetch retrieves a URL and extracts its text content.

Both are safe risk level (no consent needed).
"""

from __future__ import annotations

import logging

import httpx

from kali_core.config import settings

from .base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.web")


class WebSearchTool:
    name = "web_search"
    description = "Search the web and return results."
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query."},
            "num_results": {
                "type": "integer",
                "description": "Max results (default 5).",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        query = params.get("query", "")
        num = int(params.get("num_results", 5))

        if not query:
            return ToolResult(error="Missing 'query' parameter.")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{settings.searxng_url}/search",
                    params={"q": query, "format": "json"},
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            return ToolResult(error=f"Search failed: {e}")

        results = []
        for r in (data.get("results") or [])[:num]:
            results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", "")[:500],
            })

        return ToolResult(output={"query": query, "results": results})


class WebFetchTool:
    name = "web_fetch"
    description = "Fetch a URL and extract its text content. Not for game info or Dota 2 builds — use game_info or fetch_dota2_build instead."
    schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to fetch."},
            "max_chars": {
                "type": "integer",
                "description": "Max characters to return (default 5000).",
            },
        },
        "required": ["url"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        url = params.get("url", "")
        max_chars = int(params.get("max_chars", 5000))

        if not url:
            return ToolResult(error="Missing 'url' parameter.")

        if not url.startswith(("http://", "https://")):
            return ToolResult(error="URL must start with http:// or https://")

        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Kali/0.1"})
                resp.raise_for_status()
        except httpx.HTTPError as e:
            return ToolResult(error=f"Fetch failed: {e}")

        content_type = resp.headers.get("content-type", "")
        text = _extract_text_from_html(resp.text) if "html" in content_type else resp.text
        text = text[:max_chars]
        return ToolResult(
            output={
                "url": url,
                "content_type": content_type,
                "content": text,
                "status_code": resp.status_code,
            }
        )


def _extract_text_from_html(html: str) -> str:
    """Simple HTML text extraction (no dependency on BeautifulSoup)."""
    import re

    # Remove script and style blocks.
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags.
    text = re.sub(r"<[^>]+>", " ", html)
    # Collapse whitespace.
    text = re.sub(r"\s+", " ", text).strip()
    return text