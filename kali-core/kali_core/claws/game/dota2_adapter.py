from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

import httpx

from .adapter import (
    ImageRequest,
    ResourceSchema,
    register_adapter,
)

logger = logging.getLogger("kali_core.claws.game.dota2_adapter")

OPENDOTA_BASE = "https://api.opendota.com/api"
STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react"
TIMEOUT = 10.0
WIKI_TIMEOUT = 12.0


_ITEM_CONSTANTS: dict[str, dict[str, Any]] | None = None
_ID_TO_DNAME: dict[str, str] | None = None
_ID_TO_KEY: dict[str, str] | None = None

_HERO_CONSTANTS: dict[str, dict[str, Any]] | None = None
_ABILITY_CONSTANTS: dict[str, dict[str, Any]] | None = None
_HERO_ABILITIES: dict[str, dict[str, Any]] | None = None


# ── Streaming helpers ──────────────────────────────────────


async def _emit_widget(
    ctx: Any,
    artifact_id: str,
    title: str,
    game: str,
    res_type: str,
    image: dict | None,
    sections: list[dict],
    update: str = "create",
) -> None:
    """Emit a widget artifact via ctx.emit for progressive streaming."""
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
        "title": title,
        "content": json.dumps({"items": [item]}),
        "update": update,
    }
    try:
        result = emit(payload)
        # Handle both sync and async emit callbacks
        if hasattr(result, "__await__"):
            await result
    except Exception:
        logger.warning("Failed to emit artifact update", exc_info=True)


def _liquipedia_urls(slug: str) -> list[str]:
    """Generate candidate Liquipedia URLs trying different casings."""
    candidates = [
        slug,
        slug.capitalize(),
        slug.title(),
        slug.replace("_", " ").title().replace(" ", "_"),
    ]
    seen: set[str] = set()
    urls: list[str] = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            urls.append(f"https://liquipedia.net/dota2/{c}")
    return urls


async def _fetch_wiki_page(slug: str) -> str:
    """Fetch Liquipedia page trying different URL casings."""
    for url in _liquipedia_urls(slug):
        try:
            async with httpx.AsyncClient(
                timeout=WIKI_TIMEOUT, follow_redirects=True
            ) as client:
                resp = await client.get(
                    url, headers={"User-Agent": "Kali/0.1"}
                )
                if resp.status_code == 200:
                    return resp.text
        except Exception:
            continue
    return ""


def _extract_lore_from_html(html: str) -> str:
    """Extract lore text from Liquipedia HTML using multiple patterns."""
    patterns = [
        r'display:table-cell;max-width:\d+px[^>]*>(.*?)</div>',
        r'display:table-cell[^>]*max-width[^>]*>(.*?)</div>',
        r'Lore[^<]*</a>[^<]*</div>\s*<div[^>]*>(.*?)</div>',
    ]
    for pat in patterns:
        match = re.search(pat, html, re.DOTALL)
        if match:
            text = re.sub(r"<[^>]+>", " ", match.group(1))
            text = re.sub(r"\s+", " ", text).strip()
            if len(text) > 50:
                return text[:500]
    return ""


# ── Constants loading ──────────────────────────────────────


async def _load_item_constants() -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    global _ITEM_CONSTANTS, _ID_TO_DNAME
    if _ITEM_CONSTANTS is not None and _ID_TO_DNAME is not None:
        return _ITEM_CONSTANTS, _ID_TO_DNAME
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(f"{OPENDOTA_BASE}/constants/items")
            resp.raise_for_status()
            _ITEM_CONSTANTS = resp.json()
        _ID_TO_DNAME = {
            str(v["id"]): v.get("dname", str(v["id"]))
            for v in _ITEM_CONSTANTS.values()
            if isinstance(v, dict) and "id" in v
        }
        return _ITEM_CONSTANTS, _ID_TO_DNAME
    except httpx.HTTPError as e:
        logger.warning("Failed to load item constants: %s", e)
        _ITEM_CONSTANTS = {}
        _ID_TO_DNAME = {}
        return _ITEM_CONSTANTS, _ID_TO_DNAME


async def _ensure_id_to_key() -> None:
    global _ID_TO_KEY
    if _ID_TO_KEY is not None:
        return
    await _load_item_constants()
    if _ITEM_CONSTANTS is None:
        _ID_TO_KEY = {}
        return
    _ID_TO_KEY = {
        str(v["id"]): k
        for k, v in _ITEM_CONSTANTS.items()
        if isinstance(v, dict) and "id" in v
    }


async def _load_hero_constants() -> None:
    global _HERO_CONSTANTS, _ABILITY_CONSTANTS, _HERO_ABILITIES
    if (
        _HERO_CONSTANTS is not None
        and _ABILITY_CONSTANTS is not None
        and _HERO_ABILITIES is not None
    ):
        return
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r1 = await client.get(f"{OPENDOTA_BASE}/constants/heroes")
            r2 = await client.get(f"{OPENDOTA_BASE}/constants/abilities")
            r3 = await client.get(f"{OPENDOTA_BASE}/constants/hero_abilities")
            r1.raise_for_status()
            r2.raise_for_status()
            r3.raise_for_status()
            _HERO_CONSTANTS = r1.json()
            _ABILITY_CONSTANTS = r2.json()
            _HERO_ABILITIES = r3.json()
    except httpx.HTTPError as e:
        logger.warning("Failed to load hero/ability constants: %s", e)
        _HERO_CONSTANTS = {}
        _ABILITY_CONSTANTS = {}
        _HERO_ABILITIES = {}


# ── Path / URL helpers ─────────────────────────────────────


def _ability_img_path(ability_key: str) -> str:
    return f"dota/abilities/{ability_key}.png"


def _build_ability_url(ability_key: str) -> str:
    return f"{STEAM_CDN}/abilities/{ability_key}.png"


def _clean_talent_name(name: str) -> str:
    """Remove {s:...} placeholders from talent dname strings."""
    return re.sub(r"\{s:[^}]+\}", "?", name).strip()


def _hero_img_path(hero_key: str) -> str:
    return f"dota/heroes/{hero_key}.png"


def _item_img_path(item_key: str) -> str:
    return f"dota/items/{item_key}.png"


def _build_hero_url(hero_key: str) -> str:
    return f"{STEAM_CDN}/heroes/{hero_key}.png"


def _build_item_url(item_key: str) -> str:
    return f"{STEAM_CDN}/items/{item_key}.png"


# ── Item helpers ──────────────────────────────────────────


def _resolve_item_ids_with_keys(
    item_ids: list[str],
) -> tuple[list[str], list[str]]:
    if not item_ids:
        return [], []
    names: list[str] = []
    keys: list[str] = []
    for iid in item_ids:
        if _ID_TO_DNAME is not None:
            names.append(_ID_TO_DNAME.get(iid, iid))
        else:
            names.append(iid)
        if _ID_TO_KEY is not None:
            keys.append(_ID_TO_KEY.get(iid, ""))
        else:
            keys.append("")
    return names, keys


def _top_n_items(items_data: Any, n: int = 5) -> list[str]:
    if isinstance(items_data, dict):
        sorted_items = sorted(
            items_data.items(),
            key=lambda kv: kv[1] if isinstance(kv[1], (int, float)) else 0,
            reverse=True,
        )
        return [str(k) for k, _ in sorted_items[:n]]
    if isinstance(items_data, (list, tuple)):
        return [str(x) for x in items_data[:n]]
    return []


def _build_recipe_tree(
    const_key: str,
    _visited: set[str] | None = None,
) -> dict[str, Any] | None:
    if _ITEM_CONSTANTS is None:
        return None
    item = _ITEM_CONSTANTS.get(const_key)
    if not isinstance(item, dict):
        return None
    _visited = _visited or set()
    if const_key in _visited:
        return {
            "name": item.get("dname", const_key),
            "cost": item.get("cost", 0),
            "image": {"path": _item_img_path(const_key)},
            "_key": const_key,
            "components": [],
        }
    _visited.add(const_key)
    raw_comps: list[str] | None = item.get("components")
    comps = []
    if raw_comps:
        for ck in raw_comps:
            child = _build_recipe_tree(ck, _visited)
            if child:
                comps.append(child)
    return {
        "name": item.get("dname", const_key),
        "cost": item.get("cost", 0),
        "image": {"path": _item_img_path(const_key)},
        "_key": const_key,
        "components": comps,
    }


def _find_item_by_dname(dname: str) -> dict[str, Any] | None:
    if _ITEM_CONSTANTS is None:
        return None
    query = dname.lower()
    for key, val in _ITEM_CONSTANTS.items():
        if not isinstance(val, dict):
            continue
        item_name = val.get("dname", "").lower()
        if item_name == query or item_name.startswith(query):
            return {**val, "_key": key}
    return None


def _match_is_win(match: dict) -> bool:
    slot = match.get("player_slot", 0)
    is_radiant = slot < 128 if isinstance(slot, int) and slot > 100 else slot < 5
    radiant_won = match.get("radiant_win") is True
    return radiant_won if is_radiant else not radiant_won


@register_adapter
class Dota2Adapter:
    game = "dota"

    async def build_resource(
        self, query: str, ctx: Any = None
    ) -> ResourceSchema | None:
        """Build a resource for Dota 2 using LLM orchestration."""
        await _load_item_constants()
        await _load_hero_constants()
        await _ensure_id_to_key()

        item = _find_item_by_dname(query)
        if item is not None:
            return await self._build_item_resource(item, ctx)

        # For hero queries, the LLM orchestration happens in fetch_resource.py
        # This method is kept for backward compatibility with DotaBuildsTool
        hero_key = await self._resolve_hero_key(query)
        if hero_key is not None:
            return await self._build_hero_resource(query, ctx, hero_key)

        if query.strip():
            return await self._build_generic_resource(query, ctx)

        return None

    def build_image_requests(
        self, schema: ResourceSchema
    ) -> list[ImageRequest]:
        images: list[ImageRequest] = []
        if schema.image and schema.image.get("path"):
            path = schema.image["path"]
            key_hint = path.replace(".png", "").replace("/", ":")
            images.append(ImageRequest(
                key=f"dota:{key_hint}",
                game="dota",
                type=schema.type,
                url=self._url_for_path(path),
                path=path,
            ))
        for section in schema.sections:
            stype = section.get("type", "")
            if stype == "abilities":
                for ab in section.get("items", []):
                    img = ab.get("image")
                    if img and img.get("path"):
                        p = img["path"]
                        images.append(ImageRequest(
                            key=f"dota:{p.replace('.png','').replace('/',':')}",
                            game="dota",
                            type="ability",
                            url=self._url_for_path(p),
                            path=p,
                        ))
            elif stype == "item_grid":
                for group in section.get("groups", []):
                    for item in group.get("items", []):
                        img = item.get("image")
                        if img and img.get("path"):
                            p = img["path"]
                            images.append(ImageRequest(
                                key=f"dota:{p.replace('.png','').replace('/',':')}",
                                game="dota",
                                type="item",
                                url=self._url_for_path(p),
                                path=p,
                            ))
            elif stype == "recipe_tree":
                self._collect_recipe_images(section, images)
        return images

    def _url_for_path(self, path: str) -> str:
        if path.startswith("dota/heroes/"):
            key = path.replace("dota/heroes/", "").replace(".png", "")
            return _build_hero_url(key)
        if path.startswith("dota/items/"):
            key = path.replace("dota/items/", "").replace(".png", "")
            return _build_item_url(key)
        if path.startswith("dota/abilities/"):
            key = path.replace("dota/abilities/", "").replace(".png", "")
            return _build_ability_url(key)
        return ""

    def _collect_recipe_images(
        self, section: dict, images: list[ImageRequest]
    ) -> None:
        for comp in section.get("components", []):
            comp_key = comp.get("_key") or comp.get("key", "")
            if comp_key:
                p = _item_img_path(comp_key)
                images.append(ImageRequest(
                    key=f"dota:item:{comp_key}",
                    game="dota",
                    type="item",
                    url=_build_item_url(comp_key),
                    path=p,
                ))
            for child in comp.get("components", []):
                self._collect_recipe_images({"components": [child]}, images)

    # ── Item resource ───────────────────────────────────────

    async def _build_item_resource(
        self, item: dict[str, Any], ctx: Any = None
    ) -> ResourceSchema:
        const_key: str = item.get("_key", "")
        recipe_tree = _build_recipe_tree(const_key) if const_key else None

        builds_into: list[str] = []
        builds_into_keys: list[str] = []
        if _ITEM_CONSTANTS and const_key:
            for _k, v in _ITEM_CONSTANTS.items():
                if not isinstance(v, dict):
                    continue
                comps: list[str] | None = v.get("components")
                if comps and const_key in comps:
                    builds_into.append(v.get("dname", _k))
                    builds_into_keys.append(_k)

        sections: list[dict] = []

        sections.append({
            "id": "details",
            "title": "game.details",
            "type": "stats",
            "fields": [
                {"label": "game.cost", "value": item.get("cost", 0)},
            ],
        })

        cd = item.get("cd", False)
        mc = item.get("mc", False)
        extra_fields = []
        if cd is not False and cd is not None:
            extra_fields.append({"label": "game.cooldown", "value": f"{cd}s"})
        if mc is not False and mc is not None:
            extra_fields.append({"label": "game.mana_cost", "value": str(mc)})
        if extra_fields:
            sections[0]["fields"].extend(extra_fields)

        desc = item.get("desc", "")
        if desc:
            sections.append({
                "id": "description",
                "title": "game.description",
                "type": "text",
                "text": desc,
            })

        lore = item.get("lore", "")
        if lore:
            sections.append({
                "id": "lore",
                "title": "game.lore",
                "type": "text",
                "text": lore,
            })

        abilities = item.get("abilities", [])
        if abilities:
            sections.append({
                "id": "abilities",
                "title": "game.abilities",
                "type": "abilities",
                "items": [
                    {
                        "name": ab.get("title") or ab.get("dname") or ab.get("name", f"#{i}"),
                        "description": ab.get("description") or ab.get("desc", ""),
                        "image": None,
                    }
                    for i, ab in enumerate(abilities)
                ],
            })

        attrib = item.get("attrib", [])
        if attrib:
            sections.append({
                "id": "attributes",
                "title": "game.attributes",
                "type": "stats",
                "fields": [
                    {
                        "label": a.get("key") or a.get("header", f"#{i}"),
                        "value": a.get("value", ""),
                    }
                    for i, a in enumerate(attrib)
                ],
            })

        if recipe_tree and recipe_tree.get("components"):
            sections.append({
                "id": "recipe",
                "title": "game.recipe",
                "type": "recipe_tree",
                "name": recipe_tree["name"],
                "cost": recipe_tree["cost"],
                "image": recipe_tree["image"],
                "components": recipe_tree["components"],
            })

        if builds_into:
            sections.append({
                "id": "builds_into",
                "title": "game.builds_into",
                "type": "item_grid",
                "groups": [
                    {
                        "label": "",
                        "items": [
                            {
                                "name": builds_into[i],
                                "image": (
                                    {"path": _item_img_path(builds_into_keys[i])}
                                    if builds_into_keys[i] else None
                                ),
                            }
                            for i in range(len(builds_into))
                        ],
                    }
                ],
            })

        if not desc and not lore and not abilities and not recipe_tree and not builds_into:
            note = (
                f"{item.get('dname', const_key)} is a basic item with no "
                "special abilities or recipe components."
            )
            sections.append({
                "id": "note",
                "title": "",
                "type": "text",
                "text": note,
            })

        usage_hints = []
        if item.get("armor") or item.get("bonus_armor"):
            usage_hints.append("Tank / offlane")
        if item.get("damage") or item.get("bonus_damage"):
            usage_hints.append("Carry / core")
        if item.get("intelligence") or item.get("mana_regen") or item.get("bonus_intelligence"):
            usage_hints.append("Support / caster")
        if item.get("attack_speed") or item.get("bonus_attack_speed"):
            usage_hints.append("Right-click carry")
        if item.get("health_regen") or item.get("bonus_health"):
            usage_hints.append("Durable / initiator")
        if usage_hints:
            sections.append({
                "id": "usage",
                "title": "game.usage",
                "type": "text",
                "text": "Ideal for: " + ", ".join(usage_hints) + ".",
            })

        return ResourceSchema(
            game="dota",
            type="item",
            title=item.get("dname", const_key),
            image={"path": _item_img_path(const_key)} if const_key else None,
            sections=sections,
            raw={
                "dname": item.get("dname", const_key),
                "cost": item.get("cost", 0),
                "item_key": const_key,
            },
        )

    # ── Hero resource (streaming) ────────────────────────────

    async def _build_hero_resource(
        self, hero_name: str, ctx: Any, hero_key: str
    ) -> ResourceSchema | None:
        artifact_id = f"art_dota_{uuid.uuid4().hex[:8]}"
        title = hero_name
        img = {"path": _hero_img_path(hero_key)} if hero_key else None

        await _load_hero_constants()
        await _ensure_id_to_key()

        hero_id = await self._resolve_hero_id(hero_name)
        hero_const = (
            _HERO_CONSTANTS.get(str(hero_id))
            if _HERO_CONSTANTS and hero_id
            else None
        )

        sections: list[dict] = []

        # ── Phase 1: emit title + image ───────────────────────
        await _emit_widget(
            ctx, artifact_id, title, "dota", "hero", img,
            sections, update="create",
        )

        # ── Phase 2: stats ────────────────────────────────────
        if hero_const:
            primary_attr = hero_const.get("primary_attr", "")
            attr_label = {
                "str": "Fuerza", "agi": "Agilidad", "int": "Inteligencia"
            }.get(primary_attr, primary_attr.upper())
            attack_type = hero_const.get("attack_type", "")
            roles = hero_const.get("roles", [])

            hp = hero_const.get("base_health", 0) + hero_const.get("base_str", 0) * 20
            mp = hero_const.get("base_mana", 0) + hero_const.get("base_int", 0) * 12
            dmg_min = hero_const.get("base_attack_min", 0)
            dmg_max = hero_const.get("base_attack_max", 0)
            armor = hero_const.get("base_armor", 0)
            ms = hero_const.get("move_speed", 0)
            atk_range = hero_const.get("attack_range", 150)
            str_gain = hero_const.get("str_gain", 0)
            agi_gain = hero_const.get("agi_gain", 0)
            int_gain = hero_const.get("int_gain", 0)

            hp_regen = hero_const.get('base_str', 0) * 20 + str_gain * 20
            mp_regen = hero_const.get('base_int', 0) * 12 + int_gain * 12
            base_str = hero_const.get('base_str', 0)
            base_agi = hero_const.get('base_agi', 0)
            base_int = hero_const.get('base_int', 0)

            sections.append({
                "id": "stats",
                "title": "game.stats",
                "type": "stats",
                "fields": [
                    {"label": "game.primary_attr", "value": attr_label},
                    {"label": "game.attack_type", "value": attack_type},
                    {"label": "game.roles", "value": ", ".join(roles)},
                    {"label": "game.health", "value": f"{hp} (+{hp_regen:.1f}/lvl)"},
                    {"label": "game.mana", "value": f"{mp} (+{mp_regen:.1f}/lvl)"},
                    {"label": "game.damage", "value": f"{dmg_min}–{dmg_max}"},
                    {"label": "game.armor", "value": f"{armor:.1f}"},
                    {"label": "game.move_speed", "value": str(ms)},
                    {"label": "game.attack_range", "value": str(atk_range)},
                    {"label": "game.strength", "value": f"{base_str} + {str_gain}"},
                    {"label": "game.agility", "value": f"{base_agi} + {agi_gain}"},
                    {"label": "game.intelligence", "value": f"{base_int} + {int_gain}"},
                ],
            })

            roles_str = ", ".join(roles)
            desc_text = (
                f"{hero_name} is a {attack_type.lower()} "
                f"{primary_attr.upper()} hero. Roles: {roles_str}."
            )
            sections.append({
                "id": "description",
                "title": "game.description",
                "type": "text",
                "text": desc_text,
            })

            await _emit_widget(
                ctx, artifact_id, title, "dota", "hero", img,
                sections, update="update",
            )

        # ── Phase 3: abilities + talents ──────────────────────
        full_name = f"npc_dota_hero_{hero_key}"
        hero_ab_data = _HERO_ABILITIES.get(full_name) if _HERO_ABILITIES else None
        if hero_ab_data:
            ability_keys = hero_ab_data.get("abilities", [])
            ability_items = []
            for ab_key in ability_keys:
                if ab_key == "generic_hidden":
                    continue
                ab_const = _ABILITY_CONSTANTS.get(ab_key) if _ABILITY_CONSTANTS else None
                if not ab_const:
                    continue
                dname = ab_const.get("dname", ab_key)
                desc = ab_const.get("desc", "")
                attribs = ab_const.get("attrib", [])
                cd = ""
                mc = ""
                for a in attribs:
                    hdr = (a.get("header") or "").lower()
                    val = a.get("value", "")
                    if "cooldown" in hdr:
                        cd = f"{val}s" if isinstance(val, (int, float, str)) else str(val)
                    elif "mana cost" in hdr:
                        mc = str(val)
                ability_items.append({
                    "name": dname,
                    "description": desc,
                    "image": {"path": _ability_img_path(ab_key)},
                    "cooldown": cd,
                    "mana_cost": mc,
                })
            if ability_items:
                sections.append({
                    "id": "abilities",
                    "title": "game.abilities",
                    "type": "abilities",
                    "items": ability_items,
                })

            talents_raw = hero_ab_data.get("talents", [])
            if talents_raw:
                level_map = {1: 10, 2: 15, 3: 20, 4: 25}
                talent_rows = []
                for i in range(0, len(talents_raw), 2):
                    left = talents_raw[i] if i < len(talents_raw) else None
                    right = talents_raw[i + 1] if i + 1 < len(talents_raw) else None
                    lvl = left.get("level", 1) if left else (
                        right.get("level", 1) if right else 1
                    )
                    display_level = level_map.get(lvl, lvl * 5 + 5)
                    left_name = ""
                    right_name = ""
                    if left:
                        left_name = _clean_talent_name(
                            _ABILITY_CONSTANTS.get(
                                left["name"], {}
                            ).get("dname", left["name"])
                        )
                    if right:
                        right_name = _clean_talent_name(
                            _ABILITY_CONSTANTS.get(
                                right["name"], {}
                            ).get("dname", right["name"])
                        )
                    talent_rows.append({
                        "level": display_level,
                        "left": left_name,
                        "right": right_name,
                    })
                sections.append({
                    "id": "talents",
                    "title": "game.talents",
                    "type": "talents",
                    "rows": talent_rows,
                })

            await _emit_widget(
                ctx, artifact_id, title, "dota", "hero", img,
                sections, update="update",
            )

        # ── Phase 4: build (item popularity) ──────────────────
        items = await self._fetch_item_popularity(hero_name)
        if items is not None:
            early_names, early_keys = _resolve_item_ids_with_keys(
                items.get("early_game", [])
            )
            mid_names, mid_keys = _resolve_item_ids_with_keys(
                items.get("mid_game", [])
            )
            late_names, late_keys = _resolve_item_ids_with_keys(
                items.get("late_game", [])
            )

            def _build_items(names, keys):
                return [
                    {
                        "name": names[i],
                        "image": (
                            {"path": _item_img_path(keys[i])}
                            if keys[i] else None
                        ),
                    }
                    for i in range(len(names))
                ]

            sections.append({
                "id": "build",
                "title": "game.build",
                "type": "item_grid",
                "groups": [
                    {"label": "game.early_game", "items": _build_items(early_names, early_keys)},
                    {"label": "game.mid_game", "items": _build_items(mid_names, mid_keys)},
                    {"label": "game.late_game", "items": _build_items(late_names, late_keys)},
                ],
            })

            await _emit_widget(
                ctx, artifact_id, title, "dota", "hero", img,
                sections, update="update",
            )

        # ── Phase 5: win rate ─────────────────────────────────
        win_rate = await self._fetch_win_rate(hero_name)
        if win_rate is not None:
            stats_section = next(
                (s for s in sections if s.get("id") == "stats"), None
            )
            if stats_section:
                stats_section["fields"].append({
                    "label": "game.win_rate",
                    "value": f"{win_rate}%",
                })

        # ── Phase 6: lore enrichment (LLM) ────────────────────
        await self._enrich_with_llm(
            schema_sections=sections,
            hero_name=hero_name,
            hero_key=hero_key,
            ctx=ctx,
        )

        # ── Final emit ────────────────────────────────────────
        await _emit_widget(
            ctx, artifact_id, title, "dota", "hero", img,
            sections, update="update",
        )

        return ResourceSchema(
            game="dota",
            type="hero",
            title=hero_name,
            image=img,
            sections=sections,
            raw={
                "hero": hero_name,
                "hero_key": hero_key,
                "win_rate": win_rate,
                "_artifact_id": artifact_id,
                "_streamed": True,
            },
        )

    # ── Generic resource (NPCs, maps, etc.) ──────────────────

    async def _build_generic_resource(
        self, query: str, ctx: Any = None
    ) -> ResourceSchema | None:
        """Build a resource card for non-hero, non-item queries (NPCs, maps)."""
        artifact_id = f"art_dota_{uuid.uuid4().hex[:8]}"
        title = query
        sections: list[dict] = []

        # Fetch from Liquipedia — do NOT emit empty card until we have content
        slug = query.lower().replace(" ", "_")
        wiki_html = await _fetch_wiki_page(slug)

        if wiki_html:
            text = re.sub(r"<[^>]+>", " ", wiki_html)
            text = re.sub(r"\s+", " ", text).strip()
            paragraphs = [p.strip() for p in text.split(".") if len(p.strip()) > 80]
            if paragraphs:
                desc_text = paragraphs[0].strip() + "."
                sections.append({
                    "id": "description",
                    "title": "game.description",
                    "type": "text",
                    "text": desc_text[:500],
                })

            img_match = re.search(
                r'<img[^>]+src=["\']([^"\']+)["\']',
                wiki_html,
            )
            if img_match:
                img_url = img_match.group(1)
                if not img_url.startswith("http"):
                    img_url = f"https://liquipedia.net{img_url}"
                sections.append({
                    "id": "image",
                    "title": "game.images",
                    "type": "images",
                    "images": [img_url],
                })

        # Use LLM to structure the info if available
        llm = getattr(ctx, "llm_provider", None) if ctx else None
        lang = getattr(ctx, "language", "en") if ctx else "en"

        if llm is not None and wiki_html:
            try:
                prompt = (
                    "You are a game data extractor. Given raw HTML from a "
                    "Dota 2 wiki page, extract ALL relevant information about "
                    "the requested topic and return it in the requested "
                    "language. Include description, stats, abilities, or "
                    "any other relevant sections.\n\n"
                    f"Query: {query}\n"
                    f"Language: {lang}\n\n"
                    f"Raw HTML excerpt:\n{wiki_html[:3000]}\n\n"
                    "Return ONLY a JSON object, no markdown fences:\n"
                    '{"description": "in requested language",'
                    ' "type": "what kind of entity this is"}'
                )
                result = await llm.complete(
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = result.get("text", "").strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1] if "\n" in raw else raw
                    raw = raw.rsplit("```", 1)[0] if "```" in raw else raw
                data = json.loads(raw)
                desc = data.get("description", "").strip()
                if desc and len(desc) > 50:
                    desc_section = next(
                        (s for s in sections if s.get("id") == "description"),
                        None,
                    )
                    if desc_section:
                        desc_section["text"] = desc[:500]
                    else:
                        sections.append({
                            "id": "description",
                            "title": "game.description",
                            "type": "text",
                            "text": desc[:500],
                        })
            except Exception:
                logger.warning(
                    "LLM structuring failed for generic resource", exc_info=True
                )

        # Only emit if we have content — no orphan cards
        if not sections:
            return None

        await _emit_widget(
            ctx, artifact_id, title, "dota", "info", None,
            sections, update="create",
        )

        return ResourceSchema(
            game="dota",
            type="info",
            title=title,
            image=None,
            sections=sections,
            raw={
                "query": query,
                "_artifact_id": artifact_id,
                "_streamed": True,
            },
        )

    # ── OpenDota API helpers ────────────────────────────────

    async def _resolve_hero_key(self, name: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(f"{OPENDOTA_BASE}/heroes")
                resp.raise_for_status()
                heroes = resp.json()
            name_lower = name.lower()
            for h in heroes:
                localized = h.get("localized_name", "").lower()
                if localized == name_lower or localized.startswith(name_lower):
                    full_name = h.get("name", "")
                    return full_name.replace("npc_dota_hero_", "") if full_name else None
            return None
        except httpx.HTTPError as e:
            logger.warning("OpenDota heroes lookup failed: %s", e)
            return None

    async def _fetch_item_popularity(self, hero_name: str) -> dict | None:
        hero_id = await self._resolve_hero_id(hero_name)
        if hero_id is None:
            return None
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(
                    f"{OPENDOTA_BASE}/heroes/{hero_id}/itemPopularity"
                )
                resp.raise_for_status()
                data = resp.json()
            return {
                "early_game": _top_n_items(data.get("start_game_items"), 5),
                "mid_game": _top_n_items(data.get("mid_game_items"), 5),
                "late_game": _top_n_items(data.get("late_game_items"), 5),
            }
        except httpx.HTTPError as e:
            logger.warning("OpenDota item popularity failed: %s", e)
            return None

    async def _resolve_hero_id(self, name: str) -> int | None:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(f"{OPENDOTA_BASE}/heroes")
                resp.raise_for_status()
                heroes = resp.json()
            name_lower = name.lower()
            for h in heroes:
                localized = h.get("localized_name", "").lower()
                if localized == name_lower or localized.startswith(name_lower):
                    return h["id"]
            return None
        except httpx.HTTPError as e:
            logger.warning("OpenDota heroes lookup failed: %s", e)
            return None

    async def _fetch_win_rate(self, hero_name: str) -> float | None:
        hero_id = await self._resolve_hero_id(hero_name)
        if hero_id is None:
            return None
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(
                    f"{OPENDOTA_BASE}/heroes/{hero_id}/matches",
                    params={"limit": 100},
                )
                resp.raise_for_status()
                matches = resp.json()
            if not matches:
                return None
            wins = sum(1 for m in matches if _match_is_win(m))
            total = len(matches)
            return round(wins / total * 100, 1) if total else None
        except httpx.HTTPError as e:
            logger.warning("OpenDota matches failed: %s", e)
            return None

    # ── LLM enrichment ───────────────────────────────────────

    async def get_hero_list(self) -> list[str]:
        """Return list of all hero localized names."""
        await _load_hero_constants()
        if not _HERO_CONSTANTS:
            return []
        return [
            h.get("localized_name", "")
            for h in _HERO_CONSTANTS.values()
            if isinstance(h, dict) and h.get("localized_name")
        ]

    async def get_item_list(self) -> list[str]:
        """Return list of all item display names."""
        await _load_item_constants()
        if not _ITEM_CONSTANTS:
            return []
        return [
            v.get("dname", "")
            for v in _ITEM_CONSTANTS.values()
            if isinstance(v, dict) and v.get("dname")
        ]

    async def get_hero_data(self, hero_key: str) -> dict | None:
        """Fetch structured data for a hero by key (e.g. 'pudge')."""
        await _load_hero_constants()
        await _load_item_constants()
        await _ensure_id_to_key()

        full_name = f"npc_dota_hero_{hero_key}"
        hero_ab_data = _HERO_ABILITIES.get(full_name) if _HERO_ABILITIES else None

        # Find hero_const from constants
        hero_const = None
        if _HERO_CONSTANTS:
            for _hid, hdata in _HERO_CONSTANTS.items():
                if isinstance(hdata, dict) and hdata.get("name") == full_name:
                    hero_const = hdata
                    break

        if not hero_const:
            return None

        # Build abilities
        abilities = []
        if hero_ab_data:
            for ab_key in hero_ab_data.get("abilities", []):
                if ab_key == "generic_hidden":
                    continue
                ab = _ABILITY_CONSTANTS.get(ab_key, {}) if _ABILITY_CONSTANTS else {}
                if not ab:
                    continue
                attribs = ab.get("attrib", [])
                cd = ""
                mc = ""
                for a in attribs:
                    hdr = (a.get("header") or "").lower()
                    val = a.get("value", "")
                    if "cooldown" in hdr:
                        cd = f"{val}s" if isinstance(val, (int, float, str)) else str(val)
                    elif "mana cost" in hdr:
                        mc = str(val)
                abilities.append({
                    "key": ab_key,
                    "name": ab.get("dname", ab_key),
                    "description": ab.get("desc", ""),
                    "image_path": _ability_img_path(ab_key),
                    "cooldown": cd,
                    "mana_cost": mc,
                })

        # Build talents
        talents = []
        if hero_ab_data:
            talents_raw = hero_ab_data.get("talents", [])
            level_map = {1: 10, 2: 15, 3: 20, 4: 25}
            for i in range(0, len(talents_raw), 2):
                left = talents_raw[i] if i < len(talents_raw) else None
                right = talents_raw[i + 1] if i + 1 < len(talents_raw) else None
                lvl = left.get("level", 1) if left else (
                    right.get("level", 1) if right else 1
                )
                left_name = ""
                right_name = ""
                if left:
                    left_name = _clean_talent_name(
                        _ABILITY_CONSTANTS.get(left["name"], {}).get("dname", left["name"])
                    ) if _ABILITY_CONSTANTS else left["name"]
                if right:
                    right_name = _clean_talent_name(
                        _ABILITY_CONSTANTS.get(right["name"], {}).get("dname", right["name"])
                    ) if _ABILITY_CONSTANTS else right["name"]
                talents.append({
                    "level": level_map.get(lvl, lvl * 5 + 5),
                    "left": left_name,
                    "right": right_name,
                })

        # Stats
        primary_attr = hero_const.get("primary_attr", "")
        attr_label = {
            "str": "Strength", "agi": "Agility", "int": "Intelligence"
        }.get(primary_attr, primary_attr.upper())
        hp = hero_const.get("base_health", 0) + hero_const.get("base_str", 0) * 20
        mp = hero_const.get("base_mana", 0) + hero_const.get("base_int", 0) * 12

        return {
            "hero_key": hero_key,
            "localized_name": hero_const.get("localized_name", hero_key),
            "primary_attr": attr_label,
            "attack_type": hero_const.get("attack_type", ""),
            "roles": hero_const.get("roles", []),
            "stats": {
                "health": hp,
                "mana": mp,
                "damage_min": hero_const.get("base_attack_min", 0),
                "damage_max": hero_const.get("base_attack_max", 0),
                "armor": hero_const.get("base_armor", 0),
                "move_speed": hero_const.get("move_speed", 0),
                "attack_range": hero_const.get("attack_range", 150),
                "strength": (
                    f"{hero_const.get('base_str', 0)} + "
                    f"{hero_const.get('str_gain', 0)}"
                ),
                "agility": (
                    f"{hero_const.get('base_agi', 0)} + "
                    f"{hero_const.get('agi_gain', 0)}"
                ),
                "intelligence": (
                    f"{hero_const.get('base_int', 0)} + "
                    f"{hero_const.get('int_gain', 0)}"
                ),
            },
            "abilities": abilities,
            "talents": talents,
            "image_path": _hero_img_path(hero_key),
        }

    async def _enrich_with_llm(
        self,
        schema_sections: list[dict],
        hero_name: str,
        hero_key: str,
        ctx: Any = None,
    ) -> None:
        """Use LLM to extract lore from wiki and translate descriptions."""
        desc_section = next(
            (s for s in schema_sections if s.get("id") == "description"), None
        )
        if not desc_section:
            return

        text = desc_section.get("text", "")
        if not isinstance(text, str) or not text.startswith(f"{hero_name} is a"):
            return

        llm = getattr(ctx, "llm_provider", None) if ctx else None
        lang = getattr(ctx, "language", "en") if ctx else "en"

        # Fetch wiki page with corrected casing
        slug = hero_key or hero_name.lower().replace(" ", "_")
        wiki_html = await _fetch_wiki_page(slug)

        if not wiki_html:
            logger.warning("Liquipedia fetch failed for hero: %s", hero_name)
            return

        # Extract lore using regex fallback
        lore_excerpt = _extract_lore_from_html(wiki_html)

        # If no LLM available, use regex-extracted lore as plain string
        if llm is None:
            logger.info("No LLM available, using regex lore for %s", hero_name)
            if lore_excerpt:
                desc_section["text"] = lore_excerpt
            return

        # Use LLM to extract lore and translate
        prompt = (
            "You are a game data extractor. Given raw text from a game wiki, "
            "extract the hero's lore/description and return it in the "
            "requested language.\n\n"
            f"Hero: {hero_name}\n"
            f"Language: {lang}\n\n"
            f"Wiki text:\n{(lore_excerpt or wiki_html[:3000])}\n\n"
            "Return ONLY a JSON object with this structure, no markdown "
            "fences:\n"
            '{"original": "the hero lore in English", '
            '"translated": "the hero lore in the requested language"}'
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
            original = data.get("original", "").strip()
            translated = data.get("translated", "").strip()
            if translated and len(translated) > 50:
                desc_section["text"] = {
                    "original": original[:500],
                    "translated": translated[:500],
                }
            elif original and len(original) > 50:
                desc_section["text"] = original[:500]
            elif lore_excerpt:
                desc_section["text"] = lore_excerpt
        except Exception:
            logger.warning(
                "LLM enrichment failed for %s, using regex fallback",
                hero_name,
                exc_info=True,
            )
            if lore_excerpt:
                desc_section["text"] = lore_excerpt