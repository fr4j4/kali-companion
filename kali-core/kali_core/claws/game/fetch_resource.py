from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any

import httpx

from kali_core.canvas import widget_artifact
from kali_core.claws.base import ToolContext, ToolResult
from kali_core.claws.game.adapter import (
    ImageRequest,
    ResourceSchema,
    get_adapter,
)
from kali_core.claws.game.spoiler_filter import filter_text, is_spoiler_domain
from kali_core.config import settings

logger = logging.getLogger("kali_core.claws.game.fetch_resource")

_RES_TYPE_MAP = {
    "hero": "entity",
    "item": "resource",
    "location": "place",
    "ability": "entity",
}

_GAME_ALIASES: dict[str, str] = {
    "dota": "dota",
    "dota 2": "dota",
    "dota2": "dota",
    "defense of the ancients": "dota",
    "defense of the ancients 2": "dota",
}

_SEARCH_TIMEOUT = 8.0
_FETCH_TIMEOUT = 10.0
_MAX_FETCH_PAGES = 2
_MAX_IMAGES = 4


def _normalize_game_name(name: str) -> str:
    return _GAME_ALIASES.get(name.lower().strip(), name.lower().strip())


def _find_ability_by_dname(
    constants: dict | None, dname: str
) -> tuple[str, dict] | tuple[None, None]:
    """Find an ability by display name in constants dict."""
    if not constants:
        return None, None
    query = dname.lower().strip()
    for key, val in constants.items():
        if not isinstance(val, dict):
            continue
        name = val.get("dname", "").lower().strip()
        if name == query or (name and name.startswith(query)):
            return key, val
    return None, None


class FetchGameResourceTool:
    name = "fetch_game_resource"
    description = (
        "Look up game resources (heroes, items, champions, builds, stats) "
        "for ANY game. Automatically uses dedicated data APIs when available "
        "(e.g. Dota 2 via OpenDota), and falls back to web search for other games. "
        "Returns a structured visual card with stats, abilities, and builds. "
        "ALWAYS prefer this tool over web_search or game_info for game questions."
    )
    schema = {
        "type": "object",
        "properties": {
            "game": {
                "type": "string",
                "description": "Game name (e.g. 'Dota 2', 'League of Legends', 'Valorant').",
            },
            "query": {
                "type": "string",
                "description": (
                    "What to look up: hero/champion name, item name, "
                    "or topic (e.g. 'Pudge', 'Blink Dagger', 'Ahri build')."
                ),
            },
        },
        "required": ["game", "query"],
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        game = params.get("game", "").strip()
        query = params.get("query", "").strip()
        if not game or not query:
            return ToolResult(error="Missing 'game' or 'query' parameter.")

        game_key = _normalize_game_name(game)
        adapter = get_adapter(game_key)
        llm = getattr(ctx, "llm_provider", None) if ctx else None
        lang = getattr(ctx, "language", "en") if ctx else "en"

        # ── Phase 1: Collect raw data (parallel) ──────────────
        web_results = await self._web_search_and_fetch(game, query)

        # Get hero/item lists from adapter if available
        hero_names: list[str] = []
        item_names: list[str] = []
        if adapter and hasattr(adapter, "get_hero_list"):
            hero_names = await adapter.get_hero_list()
            item_names = await adapter.get_item_list()

        # ── Phase 2: LLM identifies the entity ────────────────
        identified = None
        if llm is not None:
            identified = await self._llm_identify(
                llm, query, game, hero_names, item_names, lang
            )

        # ── Phase 3: Fetch structured data ───────────────────
        hero_data = None
        if identified and identified.get("hero_key") and adapter:
            hero_data = await adapter.get_hero_data(identified["hero_key"])

        # ── Phase 4: LLM structures the card ──────────────────
        schema = None
        if llm is not None:
            schema = await self._llm_build_card(
                llm, game, query, lang, identified, hero_data, web_results, adapter
            )

        # ── Phase 5: Fallback if no LLM ───────────────────────
        if schema is None:
            if adapter is not None:
                schema = await adapter.build_resource(query, ctx)
            if schema is None:
                schema = await self._build_from_web(game, query, ctx)

        if schema is None:
            schema = self._fallback_schema(game, query, "Could not find info.")

        # ── Phase 6: Build artifact + spawn images ────────────
        artifact = self._build_artifact(game, schema)
        if adapter and ctx.job_mgr:
            adapter_images = adapter.build_image_requests(schema)
            if adapter_images:
                await self._spawn_generic_image_download(
                    [ImageRequest(
                        key=img.key, game=img.game, type=img.type,
                        url=img.url, path=img.path,
                    ) for img in adapter_images],
                    ctx,
                )

        return ToolResult(output=schema.raw, artifact=artifact)

    async def _web_search_and_fetch(
        self, game: str, query: str
    ) -> dict:
        """Search web and fetch top pages, return raw content."""
        year = datetime.now().year
        search_queries = [
            f"{game} {query} wiki {year}",
            f"{game} {query} abilities stats guide",
            f"{game} {query}",
        ]
        all_results: list[dict[str, Any]] = []
        for sq in search_queries:
            results = await self._searxng_search(sq)
            all_results.extend(results)

        unique = self._dedupe_results(all_results)[:5]
        img_urls: list[str] = []
        raw_parts: list[str] = []

        fetch_tasks = [
            self._fetch_and_parse(r["url"]) for r in unique[:_MAX_FETCH_PAGES]
        ]
        fetched = await asyncio.gather(*fetch_tasks, return_exceptions=True)

        for i, r in enumerate(unique[:3]):
            content = r.get("content", "")
            if i < len(fetched) and isinstance(fetched[i], dict):
                content = fetched[i].get("text", content)
                img_urls.extend(fetched[i].get("images", []))
            raw_parts.append(f"## {r['title']}\n{content[:800]}")

        return {
            "raw_content": "\n\n".join(raw_parts)[:4000],
            "img_urls": img_urls[:_MAX_IMAGES],
            "total_results": len(unique),
        }

    async def _llm_identify(
        self, llm: Any, query: str, game: str,
        hero_names: list[str], item_names: list[str], lang: str,
    ) -> dict | None:
        """Phase 2: LLM identifies which hero/character the user is asking about."""
        hero_sample = hero_names[:60] if hero_names else ["(no hero list available)"]
        item_sample = item_names[:30] if item_names else ["(no item list available)"]

        prompt = (
            "You are a game data identifier. Given a user query, identify "
            "which hero, character, or item they are asking about.\n\n"
            f"User query: '{query}'\n"
            f"Game: {game}\n"
            f"Language: {lang}\n\n"
            f"Available heroes in this game:\n{', '.join(hero_sample)}\n\n"
            f"Available items:\n{', '.join(item_sample)}\n\n"
            "Return ONLY a JSON object, no markdown fences:\n"
            "{\n"
            '  "hero_key": "pudge",  // exact hero key from the list, or "" if unknown\n'
            '  "intent": "card|build|counters|info",  // what the user wants\n'
            '  "title": "Pudge",  // display title\n'
            '  "type": "hero|item|info"\n'
            "}"
        )
        try:
            result = await llm.complete(
                messages=[{"role": "user", "content": prompt}],
            )
            raw = result.get("text", "").strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1] if "\n" in raw else raw
                raw = raw.rsplit("```", 1)[0] if "```" in raw else raw
            return json.loads(raw)
        except Exception:
            logger.warning("LLM identify failed", exc_info=True)
            return None

    async def _llm_build_card(
        self, llm: Any, game: str, query: str, lang: str,
        identified: dict | None, hero_data: dict | None,
        web_results: dict, adapter: Any,
    ) -> ResourceSchema | None:
        """Phase 4: LLM structures the card from all available data."""
        intent = identified.get("intent", "info") if identified else "info"
        title = identified.get("title", query) if identified else query
        res_type = identified.get("type", "info") if identified else "info"

        # Build context for the LLM
        parts = [
            f"User query: '{query}'",
            f"Game: {game}",
            f"Language: {lang}",
            f"Intent: {intent}",
        ]

        if hero_data:
            parts.append(f"\nHero data from game API:\n{json.dumps(hero_data, indent=2)[:3000]}")

        if web_results.get("raw_content"):
            parts.append(f"\nWeb search results:\n{web_results['raw_content']}")

        prompt = (
            "You are a game data structurer. Given the following information, "
            "create a structured card with sections. Reply ONLY with JSON, "
            "no markdown fences.\n\n"
            + "\n".join(parts)
            + "\n\n"
            "Based on the intent, create relevant sections:\n"
            "- 'card': include stats, abilities, talents, description\n"
            "- 'build': include skill_build (ability order), item_build (items)\n"
            "- 'counters': include counter picks / weaknesses\n"
            "- 'info': include description + any relevant info\n\n"
            "Use the CORRECT types for each section:\n"
            "- 'item_build': type='item_grid', groups with items having 'name' only\n"
            "  Example: {\"groups\": [{\"label\": \"Core\", \"items\": [{\"name\": \"Blink Dagger\"}, {\"name\": \"Aether Lens\"}]}]}\n"
            "- 'skill_build': type='skill_build', 'levels' array with {level, ability}\n"
            "  Example: {\"levels\": [{\"level\": 1, \"ability\": \"Meat Hook\"}, {\"level\": 2, \"ability\": \"Rot\"}]}\n"
            "- 'stats': type='stats', fields with {label, value}\n"
            "- 'abilities': type='abilities', items with {name, description}\n"
            "- 'talents': type='talents', rows with {level, left, right}\n"
            "- 'description': type='text', text as {original, translated}\n"
            "- 'counters': type='text', text with counter info\n\n"
            "Translate descriptions to the requested language. "
            "Keep ability/item names in English.\n\n"
            "Return JSON:\n"
            "{\n"
            '  "sections": [\n'
            '    {"id": "description", "title": "game.description", '
            '"type": "text",\n'
            '     "text": {"original": "English", '
            '"translated": "in requested language"}},\n'
            '    {"id": "stats", "title": "game.stats", "type": "stats",\n'
            '     "fields": [{"label": "Health", "value": "620"}, ...]},\n'
            '    {"id": "abilities", "title": "game.abilities", '
            '"type": "abilities",\n'
            '     "items": [{"name": "Meat Hook", "description": "..."}]},\n'
            '    {"id": "skill_build", "title": "game.skill_build", '
            '"type": "skill_build",\n'
            '     "levels": [{"level": 1, "ability": "Meat Hook"}, ...]},\n'
            '    {"id": "item_build", "title": "game.build", '
            '"type": "item_grid",\n'
            '     "groups": [{"label": "Core", "items": [{"name": "Blink Dagger"}]}]},\n'
            '    {"id": "talents", "title": "game.talents", '
            '"type": "talents",\n'
            '     "rows": [{"level": 10, "left": "...", "right": "..."}]},\n'
            "    ...\n"
            "  ]\n"
            "}"
        )
        try:
            result = await llm.complete(
                messages=[{"role": "user", "content": prompt}],
            )
            raw = result.get("text", "").strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1] if "\n" in raw else raw
                raw = raw.rsplit("```", 1)[0] if "```" in raw else raw
            data = json.loads(raw)
            sections = data.get("sections", [])
            if not sections:
                return None

            # Build hero image if available
            image = None
            if hero_data and hero_data.get("image_path"):
                image = {"path": hero_data["image_path"]}

            # Enrich with adapter resources
            if adapter and hasattr(adapter, "build_image_requests"):
                image = await self._enrich_with_adapter(
                    sections, "dota", query, image
                )

            return ResourceSchema(
                game=game.lower().replace(" ", "-"),
                type=res_type,
                title=title,
                image=image,
                sections=sections,
                raw={
                    "game": game,
                    "query": query,
                    "intent": intent,
                },
            )
        except Exception:
            logger.warning("LLM build card failed", exc_info=True)
            return None

    async def _emit_stream(
        self, ctx: Any, artifact_id: str, title: str, game: str,
        res_type: str, image: dict | None, sections: list[dict],
    ) -> None:
        emit = getattr(ctx, "emit", None) if ctx else None
        if emit is None:
            return
        data = {
            "game": game,
            "type": res_type,
            "title": title,
            "image": image,
            "sections": sections,
        }
        item = {
            "title": title,
            "description": "",
            "status": "info",
            "widgetType": "game_resource",
            "data": data,
        }
        payload = {
            "event": "artifact",
            "id": artifact_id,
            "type": "widget",
            "windowType": _RES_TYPE_MAP.get(res_type, "entity"),
            "title": title,
            "content": json.dumps({"items": [item]}),
            "update": "create" if not sections else "update",
        }
        try:
            result = emit(payload)
            if hasattr(result, "__await__"):
                await result
        except Exception:
            logger.warning("Failed to emit web artifact", exc_info=True)

    async def _enrich_with_adapter(
        self,
        sections: list[dict],
        game_key: str,
        query: str,
        image: dict | None,
    ) -> dict | None:
        """Enrich web-built sections with adapter resources (images, descriptions)."""
        if game_key != "dota":
            return image

        # Lazy import to avoid circular dependency
        from kali_core.claws.game import dota2_adapter as dota

        # Ensure constants are loaded (they're cached globally)
        try:
            await dota._load_item_constants()
            await dota._load_hero_constants()
        except Exception:
            pass

        # Enrich abilities with images + descriptions
        for section in sections:
            if section.get("type") == "abilities":
                for item in section.get("items", []):
                    name = item.get("name", "")
                    if not name:
                        continue
                    # Search ability by display name
                    ab_key, ab_data = _find_ability_by_dname(
                        dota._ABILITY_CONSTANTS, name
                    )
                    if ab_key:
                        if not item.get("image"):
                            item["image"] = {
                                "path": dota._ability_img_path(ab_key)
                            }
                        if not item.get("description"):
                            desc = ab_data.get("desc", "")
                            if desc:
                                item["description"] = desc

            # Enrich items in build sections with images
            if section.get("type") == "item_grid":
                for group in section.get("groups", []):
                    for item in group.get("items", []):
                        name = item.get("name", "")
                        if not name:
                            continue
                        found = dota._find_item_by_dname(name)
                        if found and not item.get("image"):
                            key = found.get("_key", "")
                            if key:
                                item["image"] = {
                                    "path": dota._item_img_path(key)
                                }

            # Enrich text sections that mention items
            if section.get("type") == "text" and section.get("id") == "build":
                # Build sections might be plain text — try to find item names
                text = section.get("text", "")
                if isinstance(text, str):
                    # Check if any known items are mentioned
                    found_items = []
                    if dota._ITEM_CONSTANTS:
                        for ikey, ival in dota._ITEM_CONSTANTS.items():
                            if not isinstance(ival, dict):
                                continue
                            iname = ival.get("dname", "")
                            if iname and iname.lower() in text.lower():
                                found_items.append({
                                    "name": iname,
                                    "image": {"path": dota._item_img_path(ikey)},
                                })
                    if found_items:
                        # Convert text build to item_grid with images
                        section["type"] = "item_grid"
                        section["groups"] = [{
                            "label": "",
                            "items": found_items[:10],
                        }]
                        # Keep original text as a separate section
                        sections.append({
                            "id": "build_text",
                            "title": "",
                            "type": "text",
                            "text": text,
                        })

            # Enrich skill_build sections with ability images
            if section.get("type") == "skill_build":
                for level_item in section.get("levels", []):
                    ability_name = level_item.get("ability", "")
                    if not ability_name:
                        continue
                    ab_key, ab_data = _find_ability_by_dname(
                        dota._ABILITY_CONSTANTS, ability_name
                    )
                    if ab_key and not level_item.get("image"):
                        level_item["image"] = {
                            "path": dota._ability_img_path(ab_key)
                        }

        # Try to find hero image from query
        if not image and dota._HERO_CONSTANTS:
            query_lower = query.lower().strip()
            for _hid, hdata in dota._HERO_CONSTANTS.items():
                if not isinstance(hdata, dict):
                    continue
                localized = hdata.get("localized_name", "").lower()
                if localized == query_lower or localized.startswith(query_lower):
                    full_name = hdata.get("name", "")
                    hero_key = (
                        full_name.replace("npc_dota_hero_", "")
                        if full_name else ""
                    )
                    if hero_key:
                        return {"path": dota._hero_img_path(hero_key)}

        return image

    async def _searxng_search(self, query: str) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
                resp = await client.get(
                    f"{settings.searxng_url}/search",
                    params={"q": query, "format": "json"},
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            logger.warning("SearXNG search failed for '%s': %s", query, e)
            return []

        results = []
        for r in (data.get("results") or [])[:5]:
            url = r.get("url", "")
            if is_spoiler_domain(url):
                continue
            content = (r.get("content", "") or "")[:500]
            filtered, _ = filter_text(content)
            results.append({
                "title": r.get("title", ""),
                "url": url,
                "content": filtered,
            })
        return results

    async def _fetch_and_parse(self, url: str) -> dict[str, Any]:
        """Fetch a URL, extract text and image URLs."""
        if not url.startswith(("http://", "https://")):
            return {"text": "", "images": []}
        try:
            async with httpx.AsyncClient(
                timeout=_FETCH_TIMEOUT, follow_redirects=True
            ) as client:
                resp = await client.get(url, headers={"User-Agent": "Kali/0.1"})
                resp.raise_for_status()
        except Exception:
            return {"text": "", "images": []}

        html = resp.text
        html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)

        img_pattern = re.compile(
            r'<img[^>]+src=["\']([^"\']+)["\']',
            re.IGNORECASE,
        )
        all_imgs = img_pattern.findall(html)
        img_urls = [
            self._absolutize_url(u, url)
            for u in all_imgs
            if not any(u.endswith(ext) for ext in [".svg", ".ico", ".gif"])
            and "logo" not in u.lower()
            and "icon" not in u.lower()
            and "banner" not in u.lower()
        ]

        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        filtered, _ = filter_text(text[:2000])

        return {"text": filtered, "images": img_urls}

    def _absolutize_url(self, url: str, base: str) -> str:
        if url.startswith(("http://", "https://")):
            return url
        if url.startswith("//"):
            proto = "https" if base.startswith("https") else "http"
            return f"{proto}:{url}"
        if url.startswith("/"):
            from urllib.parse import urlparse
            p = urlparse(base)
            return f"{p.scheme}://{p.netloc}{url}"
        return url

    def _dedupe_results(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen = set()
        unique = []
        for r in results:
            if r["url"] not in seen:
                seen.add(r["url"])
                unique.append(r)
        return unique

    def _extract_image_requests(
        self, schema: ResourceSchema, game_key: str, query: str
    ) -> list[ImageRequest]:
        """Build ImageRequests from image URLs found in web content."""
        images = []
        raw = schema.raw or {}
        img_urls = raw.get("images", [])
        if not img_urls and schema.image and schema.image.get("url"):
            img_urls = [schema.image["url"]]
        for i, url in enumerate(img_urls[:_MAX_IMAGES]):
            safe_query = re.sub(r"[^a-z0-9]", "_", query.lower())
            path = (
                f"{game_key}/web/{safe_query}_{i}.png"
                if i > 0
                else f"{game_key}/web/{safe_query}.png"
            )
            images.append(ImageRequest(
                key=(
                    f"{game_key}:web:{safe_query}_{i}"
                    if i > 0
                    else f"{game_key}:web:{safe_query}"
                ),
                game=game_key,
                type="web",
                url=url,
                path=path,
            ))
        return images

    # ── Helpers ────────────────────────────────────────────

    def _fallback_schema(self, game: str, query: str, reason: str) -> ResourceSchema:
        return ResourceSchema(
            game=game.lower().replace(" ", "-"),
            type="info",
            title=query,
            image=None,
            sections=[{
                "id": "note",
                "title": "",
                "type": "text",
                "text": f"I looked up '{query}' in {game} but {reason}",
            }],
            raw={
                "game": game,
                "query": query,
                "note": reason,
            },
        )

    async def _spawn_image_download(
        self, adapter: Any, schema: ResourceSchema, ctx: ToolContext
    ) -> None:
        job_mgr = getattr(ctx, "job_mgr", None)
        if job_mgr is None:
            return
        images = adapter.build_image_requests(schema)
        if not images:
            return
        await job_mgr.spawn(
            "game_image_download",
            {
                "images": [vars(img) for img in images],
                "images_dir": settings.images_dir,
                "db_path": settings.db_path,
            },
            session_id=ctx.session_id,
        )

    async def _spawn_generic_image_download(
        self, images: list[ImageRequest], ctx: ToolContext
    ) -> None:
        job_mgr = getattr(ctx, "job_mgr", None)
        if job_mgr is None:
            return
        await job_mgr.spawn(
            "game_image_download",
            {
                "images": [vars(img) for img in images],
                "images_dir": settings.images_dir,
                "db_path": settings.db_path,
            },
            session_id=ctx.session_id,
        )

    def _build_artifact(self, game: str, schema: ResourceSchema) -> dict:
        return widget_artifact(
            f"{game} — {schema.title}",
            "game_resource",
            {
                "game": schema.game,
                "type": schema.type,
                "title": schema.title,
                "image": schema.image,
                "sections": schema.sections,
            },
        )

    async def _build_from_web(
        self, game: str, query: str, ctx: ToolContext | None = None
    ) -> ResourceSchema | None:
        """Fallback: search web, fetch pages, build schema."""
        artifact_id = f"art_web_{uuid.uuid4().hex[:8]}"
        game_key = game.lower().replace(" ", "-")
        title = query
        sections: list[dict[str, Any]] = []
        img_urls: list[str] = []

        await self._emit_stream(ctx, artifact_id, title, game_key, "info", None, sections)

        year = datetime.now().year
        search_queries = [
            f"{game} {query} wiki {year}",
            f"{game} {query} abilities stats guide",
            f"{game} {query}",
        ]
        all_results: list[dict[str, Any]] = []
        for sq in search_queries:
            results = await self._searxng_search(sq)
            all_results.extend(results)
        if not all_results:
            return None

        unique = self._dedupe_results(all_results)[:5]
        fetch_tasks = [
            self._fetch_and_parse(r["url"]) for r in unique[:_MAX_FETCH_PAGES]
        ]
        fetched = await asyncio.gather(*fetch_tasks, return_exceptions=True)

        for i, r in enumerate(unique[:3]):
            content = r.get("content", "")
            if i < len(fetched) and isinstance(fetched[i], dict):
                content = fetched[i].get("text", content)
                img_urls.extend(fetched[i].get("images", []))
            sections.append({
                "id": f"result_{i}",
                "title": r["title"],
                "type": "text",
                "text": content[:600],
            })

        if img_urls:
            sections.append({
                "id": "images",
                "title": "game.images",
                "type": "text",
                "text": "",
                "images": img_urls[:_MAX_IMAGES],
            })

        first_img = img_urls[0] if img_urls else None
        image = {"url": first_img} if first_img else None

        await self._emit_stream(ctx, artifact_id, title, game_key, "info", image, sections)

        return ResourceSchema(
            game=game_key,
            type="info",
            title=title,
            image=image,
            sections=sections,
            raw={
                "game": game,
                "query": query,
                "total_results": len(unique),
                "images": img_urls[:_MAX_IMAGES],
            },
        )

    async def _emit_stream(
        self, ctx: Any, artifact_id: str, title: str, game: str,
        res_type: str, image: dict | None, sections: list[dict],
    ) -> None:
        emit = getattr(ctx, "emit", None) if ctx else None
        if emit is None:
            return
        data = {
            "game": game,
            "type": res_type,
            "title": title,
            "image": image,
            "sections": sections,
        }
        item = {
            "title": title,
            "description": "",
            "status": "info",
            "widgetType": "game_resource",
            "data": data,
        }
        payload = {
            "event": "artifact",
            "id": artifact_id,
            "type": "widget",
            "windowType": _RES_TYPE_MAP.get(res_type, "entity"),
            "title": title,
            "content": json.dumps({"items": [item]}),
            "update": "create" if not sections else "update",
        }
        try:
            result = emit(payload)
            if hasattr(result, "__await__"):
                await result
        except Exception:
            logger.warning("Failed to emit web artifact", exc_info=True)