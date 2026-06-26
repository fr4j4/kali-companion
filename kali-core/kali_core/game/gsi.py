"""Dota 2 Game State Integration — receives live match data via Valve GSI.

Dota 2 sends POST requests to /gsi/dota every ~1 second with a JSON payload
containing hero, items, abilities, map state, player stats, buildings, minimap,
roshan, couriers, neutral items, and events. This module stores the latest
state in memory for the agent tool to query.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("kali_core.game.gsi")


def _clean_name(name: str) -> str:
    """Convert internal Dota names to human-readable (e.g. npc_dota_hero_pudge -> Pudge)."""
    if not name:
        return ""
    name = name.replace("npc_dota_hero_", "").replace("item_", "")
    return name.replace("_", " ").title()


def _team_label(team: Any) -> str:
    """Convert team id to label (2=Radiant, 3=Dire)."""
    if team == 2 or str(team).lower() == "radiant":
        return "Radiant"
    if team == 3 or str(team).lower() == "dire":
        return "Dire"
    return f"team={team}"


class DotaLiveState:
    """Holds the latest GSI payload from Dota 2."""

    def __init__(self) -> None:
        self._state: dict[str, Any] = {}

    def update(self, payload: dict[str, Any]) -> None:
        self._state = payload

    @property
    def state(self) -> dict[str, Any]:
        return self._state

    @property
    def in_match(self) -> bool:
        """True if Dota reports an active match (or pre-game states)."""
        if not self._state:
            return False
        m = self._state.get("map", {})
        game_state = m.get("game_state")
        if game_state is None:
            return False
        return game_state != "DOTA_GAMERULES_STATE_INIT"

    def summarize(self) -> str:
        """Return a human-readable summary of the current match state."""
        if not self._state:
            return "No hay datos de Dota 2. ¿Estás en una partida?"

        m = self._state.get("map", {})
        game_state = m.get("game_state", "desconocido")
        win_team = m.get("win_team", "")
        clock_time = m.get("clock_time", 0)

        # ── Post-game ──────────────────────────────────────────────
        if game_state == "DOTA_GAMERULES_STATE_POST_GAME" and win_team:
            radiant_score = m.get("radiant_score", 0)
            dire_score = m.get("dire_score", 0)
            return (
                f"Partida terminada. Victoria de {'Radiant' if win_team == 'radiant' else 'Dire'} "
                f"{radiant_score}-{dire_score}. "
                f"Duración: {clock_time // 60}m {clock_time % 60}s."
            )

        # ── Pre-game states ────────────────────────────────────────
        if game_state == "DOTA_GAMERULES_STATE_PRE_GAME":
            return "Pre-game. Selección de héroes en curso."
        if game_state in (
            "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD",
            "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP",
            "DOTA_GAMERULES_STATE_HERO_SELECTION",
            "DOTA_GAMERULES_STATE_STRATEGY_TIME",
        ):
            return f"Pre-partida (estado: {game_state}). Partida aún no iniciada."

        if game_state != "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS":
            return f"Estado del juego: {game_state}."

        # ── In-game: build full summary ────────────────────────────
        lines: list[str] = []

        # Map / time / score
        minutes = clock_time // 60
        seconds = clock_time % 60
        radiant_score = m.get("radiant_score", "?")
        dire_score = m.get("dire_score", "?")
        lines.append(f"⏱ Tiempo: {minutes}m {seconds}s")
        lines.append(f"🏆 Score: Radiant {radiant_score} - {dire_score} Dire")

        # Time of day
        is_day = m.get("daytime", None)
        if is_day is not None:
            ns_night = m.get("nightstalker_night", False)
            if ns_night:
                lines.append("🌙 Noche de Nightstalker")
            else:
                lines.append(f"{'🌅 Día' if is_day else '🌙 Noche'}")

        # Map advantages
        r_gold_adv = m.get("radiant_gold_advantage", None)
        r_xp_adv = m.get("radiant_xp_advantage", None)
        if r_gold_adv is not None:
            gold_side = f"Radiant +{r_gold_adv}" if r_gold_adv >= 0 else f"Dire +{abs(r_gold_adv)}"
            lines.append(f"📈 Ventaja oro: {gold_side}")
        if r_xp_adv is not None:
            xp_side = f"Radiant +{r_xp_adv}" if r_xp_adv >= 0 else f"Dire +{abs(r_xp_adv)}"
            lines.append(f"📈 Ventaja XP: {xp_side}")

        # Paused
        if m.get("paused", False):
            lines.append("⏸️ PARTIDA PAUSADA")

        # Hero
        hero = self._state.get("hero", {})
        if hero:
            h_name = _clean_name(hero.get("name", ""))
            h_level = hero.get("level", "?")
            h_hp = hero.get("health", "?")
            h_maxhp = hero.get("max_health", "?")
            h_mana = hero.get("mana", "?")
            h_maxmana = hero.get("max_mana", "?")
            h_alive = hero.get("alive", True)
            h_respawn = hero.get("respawn_seconds", 0)
            lines.append(f"🎮 Héroe: {h_name} (nivel {h_level})")
            if h_alive:
                hp_pct = hero.get("health_percent", 0)
                mana_pct = hero.get("mana_percent", 0)
                lines.append(f"❤️ HP: {h_hp}/{h_maxhp} ({hp_pct}%) | 💧 Mana: {h_mana}/{h_maxmana} ({mana_pct}%)")
                # Position
                xpos = hero.get("xpos", None)
                ypos = hero.get("ypos", None)
                if xpos is not None and ypos is not None:
                    lines.append(f"📍 Posición: ({xpos},{ypos})")
            else:
                lines.append(f"💀 Muerto. Respawn en {h_respawn}s")

            # Hero status effects
            status_parts = []
            if hero.get("silenced"): status_parts.append("silenciado")
            if hero.get("stunned"): status_parts.append("atónito")
            if hero.get("disarmed"): status_parts.append("desarmado")
            if hero.get("magicimmune"): status_parts.append("inmune a magia")
            if hero.get("hexed"): status_parts.append("hexed")
            if hero.get("muted"): status_parts.append("muteado")
            if hero.get("break"): status_parts.append("break")
            if hero.get("smoked"): status_parts.append("smoked")
            if status_parts:
                lines.append(f"⚠️ Estado: {', '.join(status_parts)}")

            # Aghanims
            agh_scepter = hero.get("aghanims_scepter", False)
            agh_shard = hero.get("aghanims_shard", False)
            agh_parts = []
            if agh_scepter: agh_parts.append("Scepter")
            if agh_shard: agh_parts.append("Shard")
            if agh_parts:
                lines.append(f"✨ Aghanims: {' + '.join(agh_parts)}")

            # Permanent buffs
            buffs = hero.get("permanent_buffs", {})
            if buffs:
                buff_strs = []
                for buff_name, buff_data in buffs.items():
                    stacks = buff_data.get("stack_count", 0) if isinstance(buff_data, dict) else 0
                    clean_buff = buff_name.replace("modifier_", "").replace("_", " ").title()
                    buff_strs.append(f"{clean_buff} ({stacks} stacks)" if stacks else clean_buff)
                if buff_strs:
                    lines.append(f"💪 Buffs: {', '.join(buff_strs)}")

            # Talents
            talents_taken = []
            for i in range(1, 9):
                if hero.get(f"talent_{i}", False):
                    talents_taken.append(str(i))
            if talents_taken:
                lines.append(f"🌟 Talentos: {', '.join(talents_taken)}")

        # Player stats
        player = self._state.get("player", {})
        if player:
            kills = player.get("kills", "?")
            deaths = player.get("deaths", "?")
            assists = player.get("assists", "?")
            gpm = player.get("gpm", "?")
            xpm = player.get("xpm", "?")
            gold = player.get("gold", "?")
            last_hits = player.get("last_hits", "?")
            denies = player.get("denies", "?")
            killstreak = player.get("kill_streak", 0)
            lines.append(f"📊 K/D/A: {kills}/{deaths}/{assists} | LH/D: {last_hits}/{denies}")
            lines.append(f"💰 Oro: {gold} | GPM/XPM: {gpm}/{xpm}")
            if killstreak and killstreak >= 3:
                lines.append(f"🔥 Kill streak: {killstreak}")

        # Items
        items = self._state.get("items", {})
        if items:
            item_list = []
            for slot in ("slot0", "slot1", "slot2", "slot3", "slot4", "slot5", "slot6", "slot7", "slot8"):
                item = items.get(slot, {})
                i_name = item.get("name", "")
                if i_name and i_name != "empty":
                    clean = _clean_name(i_name)
                    charges = item.get("charges", 0)
                    cooldown = item.get("cooldown", 0)
                    suffix = ""
                    if charges: suffix += f" ({charges}x)"
                    if cooldown and cooldown > 0: suffix += f" [{cooldown}s]"
                    item_list.append(f"{clean}{suffix}")
            # Neutral item
            for neutral_slot in ("neutral0", "neutral1"):
                neutral = items.get(neutral_slot, {})
                if neutral.get("name") and neutral["name"] != "empty":
                    item_list.append(f"🆕 {_clean_name(neutral['name'])}")
                    break
            # TP
            tp = items.get("teleport0", {})
            if tp.get("name") and tp["name"] != "empty":
                tp_cd = tp.get("cooldown", 0)
                item_list.append(f"🌀 {_clean_name(tp['name'])}" + (f" [{tp_cd}s]" if tp_cd > 0 else ""))
            # Stash
            stash_items = []
            for slot in ("stash0", "stash1", "stash2", "stash3", "stash4", "stash5"):
                item = items.get(slot, {})
                i_name = item.get("name", "")
                if i_name and i_name != "empty":
                    stash_items.append(_clean_name(i_name))
            if item_list:
                lines.append(f"🧰 Items: {', '.join(item_list)}")
            if stash_items:
                lines.append(f"🎒 Stash: {', '.join(stash_items)}")

        # Abilities
        abilities = self._state.get("abilities", {})
        if abilities:
            ability_list = []
            _skip_abilities = {"plus_high_five", "plus_guild_banner"}
            for slot in ("ability0", "ability1", "ability2", "ability3", "ability4", "ability5"):
                ab = abilities.get(slot, {})
                ab_name = ab.get("name", "")
                if not ab_name or ab_name in _skip_abilities:
                    continue
                ab_clean = _clean_name(ab_name)
                ab_level = ab.get("level", 0)
                if ab_level == 0:
                    continue
                ab_cd = ab.get("cooldown", 0)
                ab_can_cast = ab.get("can_cast", True)
                ab_ult = ab.get("ultimate", False)
                ab_passive = ab.get("passive", False)
                prefix = "🔥" if ab_ult else "⚡"
                cd_str = f" [{ab_cd}s]" if ab_cd and ab_cd > 0 else ""
                cast_str = " (sin mana/CD)" if not ab_can_cast and not ab_passive else ""
                ability_list.append(f"{prefix} {ab_clean} Lv{ab_level}{cd_str}{cast_str}")
            if ability_list:
                lines.append(f"🗡 Habilidades: {' | '.join(ability_list)}")

        # Buildings
        buildings = self._state.get("buildings", {})
        for team_name, team_key in (("Radiant", "radiant"), ("Dire", "dire")):
            team_b = buildings.get(team_key, {})
            if not team_b:
                continue
            # Count towers by tier
            towers = {"T1": 0, "T2": 0, "T3": 0, "T4": 0}
            racks_count = 0
            ancient_alive = False
            for bld_key, bld_data in team_b.items():
                if not isinstance(bld_data, dict):
                    continue
                health = bld_data.get("health", 0)
                max_health = bld_data.get("max_health", 1)
                alive = health > 0
                if "tower" in bld_key.lower():
                    for tier in ("1", "2", "3", "4"):
                        if f"tower{tier}" in bld_key.lower():
                            if alive:
                                towers[f"T{tier}"] += 1
                elif "rax" in bld_key.lower():
                    if alive:
                        racks_count += 1
                elif "fort" in bld_key.lower():
                    ancient_alive = alive
            tower_str = " ".join(f"{k}×{v}" for k, v in towers.items())
            lines.append(
                f"🏛 {team_name}: Torres {tower_str} | Racks {racks_count} | Ancient {'✅' if ancient_alive else '❌'}"
            )

        # Minimap — extract heroes, wards, and other visible units
        minimap = self._state.get("minimap", {})
        if minimap:
            heroes_on_map = []
            wards_on_map = []
            for _k, elem in minimap.items():
                if not isinstance(elem, dict):
                    continue
                unitname = elem.get("unitname", "")
                team = elem.get("team", "?")
                xpos = elem.get("xpos", "?")
                ypos = elem.get("ypos", "?")
                if "npc_dota_hero_" in unitname:
                    h_name = _clean_name(unitname)
                    team_lbl = "R" if team == 2 else ("D" if team == 3 else f"?")
                    heroes_on_map.append(f"{h_name}({team_lbl})@({xpos},{ypos})")
                elif "ward" in unitname.lower():
                    w_type = "Obs" if "observer" in unitname else "Sentry"
                    team_lbl = "R" if team == 2 else ("D" if team == 3 else "?")
                    wards_on_map.append(f"{w_type}({team_lbl})@({xpos},{ypos})")
            if heroes_on_map:
                lines.append(f"🗺️ Héroes visibles en mapa: {' | '.join(heroes_on_map)}")
            if wards_on_map:
                lines.append(f"👁️ Wards visibles: {', '.join(wards_on_map)}")

        # Roshan
        roshan = self._state.get("roshan", {})
        if roshan:
            r_alive = roshan.get("alive", False)
            r_hp = roshan.get("health", "?")
            r_maxhp = roshan.get("max_health", "?")
            r_phase = roshan.get("spawn_phase", "?")
            r_remaining = roshan.get("phase_time_remaining", 0)
            if r_alive:
                lines.append(f"🐢 Roshan: Vivo, HP {r_hp}/{r_maxhp}")
            else:
                phase_str = f" ({r_phase}, {r_remaining}s)" if r_phase != "?" else ""
                lines.append(f"🐢 Roshan: Muerto{phase_str}")
            # Drops
            drops = roshan.get("drops", {})
            if drops:
                drop_items = drops.get("items", [])
                if isinstance(drop_items, dict):
                    drop_items = list(drop_items.values())
                if drop_items:
                    lines.append(f"🎁 Drops Roshan: {', '.join(_clean_name(d) for d in drop_items if d)}")

        # Neutral items
        neutralitems = self._state.get("neutralitems", {})
        if neutralitems:
            team_items = neutralitems.get("team_items", {})
            if isinstance(team_items, dict):
                team_items = list(team_items.values())
            found_items = []
            for ti in team_items:
                if isinstance(ti, dict):
                    name = ti.get("name", "")
                    tier = ti.get("tier", "?")
                    if name and name != "empty":
                        found_items.append(f"{_clean_name(name)} (T{tier})")
            if found_items:
                lines.append(f"🔮 Items neutrales: {', '.join(found_items)}")

        # Couriers
        couriers = self._state.get("couriers", {})
        if couriers:
            courier_map = couriers.get("couriers", couriers)
            if isinstance(courier_map, dict):
                courier_list = list(courier_map.values())
            else:
                courier_list = courier_map if isinstance(courier_map, list) else []
            for c in courier_list[:3]:
                if isinstance(c, dict):
                    c_alive = c.get("alive", True)
                    c_hp = c.get("health", "?")
                    c_flying = c.get("has_flying_upgrade", False)
                    flying_str = " (volador)" if c_flying else ""
                    status = f"Vivo{flying_str} HP {c_hp}" if c_alive else "Muerto"
                    lines.append(f"📦 Courier: {status}")

        # Events
        events = self._state.get("events", [])
        if isinstance(events, dict):
            events = list(events.values())
        if events and len(events) > 0:
            recent_events = events[-5:]
            event_strs = []
            for ev in recent_events:
                if isinstance(ev, dict):
                    ev_type = ev.get("event_type", "?")
                    ev_game_time = ev.get("game_time", 0)
                    ev_min = ev_game_time // 60
                    # Try to parse the data field for event details
                    ev_data_str = ev.get("data", "")
                    ev_detail = ""
                    if ev_data_str:
                        try:
                            ev_data = json.loads(ev_data_str)
                            msg_type = ev_data.get("type", "")
                            if "HERO_KILL" in msg_type:
                                killer = ev_data.get("playerid1", "?")
                                victim = ev_data.get("playerid2", "?")
                                ev_detail = f"Kill: jugador {killer} mató a {victim}"
                            elif "TOWER" in msg_type:
                                ev_detail = "Torre destruida"
                            elif "ITEM_PURCHASE" in msg_type:
                                ev_detail = f"Item comprado (item_id={ev_data.get('value', '?')})"
                            elif "STREAK_KILL" in msg_type:
                                ev_detail = f"Kill streak (valor={ev_data.get('value', '?')})"
                            else:
                                ev_detail = msg_type
                        except (json.JSONDecodeError, TypeError):
                            ev_detail = ev_data_str[:50] if ev_data_str else ev_type
                    event_strs.append(f"{ev_detail} ({ev_min}m)" if ev_detail else f"{ev_type} ({ev_min}m)")
            if event_strs:
                lines.append(f"📜 Eventos recientes: {' | '.join(event_strs)}")

        return "\n".join(lines)


# Singleton holding the latest Dota GSI state.
gsi_state = DotaLiveState()