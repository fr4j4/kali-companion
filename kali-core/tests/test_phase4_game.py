"""Tests for Phase 4: DotaBuildsTool, GameInfoTool, spoiler_filter, gaming profile."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from kali_core.claws.base import ToolContext, available_tools
from kali_core.claws.game.dota import DotaBuildsTool
from kali_core.claws.game.dota2_adapter import Dota2Adapter
from kali_core.claws.game.generic import GameInfoTool
from kali_core.claws.game.spoiler_filter import filter_text, is_spoiler_domain
from kali_core.server import _register_tools

pytestmark = pytest.mark.asyncio


# ── Registration ────────────────────────────────────────────


async def test_phase4_tools_registered():
    _register_tools()
    names = [t.name for t in available_tools()]
    assert "fetch_game_resource" in names
    assert "fetch_dota2_build" not in names
    assert "game_info" not in names


# ── Spoiler filter ──────────────────────────────────────────


def test_spoiler_filter_clean():
    text = "This game has great gameplay and fun mechanics."
    filtered, count = filter_text(text)
    assert count == 0
    assert filtered == text


def test_spoiler_filter_detects_spoiler():
    text = "At the end, the protagonist dies tragically."
    filtered, count = filter_text(text)
    assert count >= 1
    assert "[SPOILER" in filtered


def test_spoiler_filter_multi_line():
    text = "Great graphics.\nThe final boss is the king.\nNice music."
    filtered, count = filter_text(text)
    assert count >= 1
    assert "[SPOILER" in filtered


def test_spoiler_domain_check():
    assert is_spoiler_domain("https://www.fandom.com/wiki/Ending") is True
    assert is_spoiler_domain("https://reddit.com/r/gaming") is True
    assert is_spoiler_domain("https://www.ign.com/articles/review") is False
    assert is_spoiler_domain("https://store.steampowered.com") is False


# ── DotaBuildsTool ──────────────────────────────────────────


async def test_dota_builds_opendota_success():
    tool = DotaBuildsTool()
    mock_heroes = [{"id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge"}]
    mock_items_pop = {
        "start_game_items": {"13": 49, "11": 30},
        "mid_game_items": {"1": 42, "3": 6},
        "late_game_items": {"1": 13, "24": 3},
    }
    mock_matches = [
        {"player_slot": 0, "radiant_win": True},
        {"player_slot": 2, "radiant_win": False},
        {"player_slot": 128, "radiant_win": False},
    ]
    mock_constants = {
        "gauntlets": {"id": 13, "dname": "Gauntlets of Strength", "cost": 140,
                      "components": None, "created": False, "desc": "", "lore": ""},
        "gauntlets2": {"id": 11, "dname": "Gauntlets of Str II", "cost": 200,
                       "components": None, "created": False, "desc": "", "lore": ""},
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250,
                  "components": None, "created": False, "desc": "", "lore": ""},
        "urn": {"id": 3, "dname": "Urn of Shadows", "cost": 800,
                "components": None, "created": False, "desc": "", "lore": ""},
        "ultimate_orb": {"id": 24, "dname": "Ultimate Orb", "cost": 2150,
                         "components": None, "created": False, "desc": "", "lore": ""},
    }
    mock_hero_const = {
        "10": {
            "id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge",
            "primary_attr": "str", "attack_type": "Melee", "roles": ["Disabler", "Initiator"],
            "base_health": 120, "base_mana": 75, "base_attack_min": 45, "base_attack_max": 51,
            "base_armor": 0, "move_speed": 280, "attack_range": 175,
            "base_str": 25, "base_agi": 11, "base_int": 16,
            "str_gain": 3.0, "agi_gain": 1.4, "int_gain": 1.8,
        },
    }
    mock_ability_const = {}
    mock_hero_abilities = {}

    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.text = ""
        if "constants/items" in url:
            resp.json = MagicMock(return_value=mock_constants)
        elif "constants/heroes" in url and "abilities" not in url:
            resp.json = MagicMock(return_value=mock_hero_const)
        elif "constants/abilities" in url:
            resp.json = MagicMock(return_value=mock_ability_const)
        elif "constants/hero_abilities" in url:
            resp.json = MagicMock(return_value=mock_hero_abilities)
        elif "liquipedia" in url:
            resp.text = ""
        elif "heroes" in url and "itemPopularity" not in url and "matches" not in url:
            resp.json = MagicMock(return_value=mock_heroes)
        elif "itemPopularity" in url:
            resp.json = MagicMock(return_value=mock_items_pop)
        elif "matches" in url:
            resp.json = MagicMock(return_value=mock_matches)
        return resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"hero": "Pudge"}, ctx)
        assert result.error is None
        assert result.output["hero"] == "Pudge"
        assert result.output["win_rate"] == 66.7  # 2/3
        assert result.artifact is not None
        assert result.artifact["type"] == "widget"
        assert result.artifact["title"] == "Dota 2 — Pudge"


async def test_dota_builds_unknown_hero():
    tool = DotaBuildsTool()
    mock_heroes = [{"id": 1, "localized_name": "Anti-Mage", "name": "npc_dota_hero_antimage"}]
    mock_constants = {"blink": {"id": 1, "dname": "Blink Dagger"}}

    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        if "constants/items" in url:
            resp.json = MagicMock(return_value=mock_constants)
        else:
            resp.json = MagicMock(return_value=mock_heroes)
        return resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"hero": "NonexistentHero"}, ctx)
        assert result.error is not None


async def test_dota_builds_api_down():
    import httpx
    tool = DotaBuildsTool()

    async def mock_get(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"hero": "Pudge"}, ctx)
        assert result.error is not None


# ── GameInfoTool ────────────────────────────────────────────


async def test_game_info_basic():
    tool = GameInfoTool()
    mock_results = {
        "results": [
            {
                "title": "Baldur's Gate 3 Tips",
                "url": "https://www.ign.com/articles/baldurs-gate-3-tips",
                "content": "Some helpful tips for starting the game.",
            }
        ]
    }

    async def mock_search(*args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json = MagicMock(return_value=mock_results)
        return resp

    with (
        patch("httpx.AsyncClient.get", side_effect=mock_search),
        patch.object(tool, "_fetch_full", new=AsyncMock(return_value=None)),
    ):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "Baldur's Gate 3", "topic": "tips"}, ctx)
        assert result.error is None
        assert result.output["game"] == "Baldur's Gate 3"
        assert result.output["total_results"] >= 1
        assert result.output["results"][0]["title"] == "Baldur's Gate 3 Tips"


async def test_game_info_spoiler_filter():
    tool = GameInfoTool()
    mock_results = {
        "results": [
            {
                "title": "Game Ending Explained",
                "url": "https://example.com/ending",
                "content": "At the ending, the protagonist dies.",
            }
        ]
    }

    async def mock_search(*args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json = MagicMock(return_value=mock_results)
        return resp

    with (
        patch("httpx.AsyncClient.get", side_effect=mock_search),
        patch.object(tool, "_fetch_full", new=AsyncMock(return_value=None)),
    ):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "Some Game"}, ctx)
        assert result.error is None
        if result.output["results"]:
            assert any(
                "[SPOILER" in r.get("content", "") for r in result.output["results"]
            ) or result.output["spoilers_filtered_total"] > 0


async def test_game_info_spoiler_domain():
    tool = GameInfoTool()
    mock_results = {
        "results": [
            {
                "title": "Spoiler Subreddit",
                "url": "https://reddit.com/r/gaming/spoilers",
                "content": "This contains spoilers.",
            },
            {
                "title": "IGN Review",
                "url": "https://www.ign.com/articles/review",
                "content": "This is a safe review.",
            },
        ]
    }

    async def mock_search(*args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json = MagicMock(return_value=mock_results)
        return resp

    with (
        patch("httpx.AsyncClient.get", side_effect=mock_search),
        patch.object(tool, "_fetch_full", new=AsyncMock(return_value=None)),
    ):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "Some Game"}, ctx)
        assert result.error is None
        urls = [r["url"] for r in result.output["results"]]
        assert "https://reddit.com/r/gaming/spoilers" not in urls
        assert "https://www.ign.com/articles/review" in urls


async def test_game_info_missing_game():
    tool = GameInfoTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
    result = await tool.run({}, ctx)
    assert result.error is not None
    assert "Missing" in result.error


# ── Gaming profile ──────────────────────────────────────────


async def test_gaming_profile_has_game_tools():
    profile_path = (
        Path(__file__).parent.parent
        / "kali_core"
        / "collar"
        / "profiles"
        / "gaming.json"
    )
    data = json.loads(profile_path.read_text())
    assert "fetch_game_resource" in data["allowed_tools"]
    assert "game_info" not in data["allowed_tools"]
    assert "fetch_dota2_build" not in data["allowed_tools"]


async def test_gaming_profile_has_screenshot():
    profile_path = (
        Path(__file__).parent.parent
        / "kali_core"
        / "collar"
        / "profiles"
        / "gaming.json"
    )
    data = json.loads(profile_path.read_text())
    assert "screenshot" in data["allowed_tools"]


# ── DotaHeroCard widget format ──────────────────────────────



async def test_dota_builds_output_widget_format():
    """Verify DotaBuildsTool output can feed GameResourceCard widget."""
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _saved_constants = _dota_mod._ITEM_CONSTANTS
    _saved_id_map = _dota_mod._ID_TO_DNAME
    _saved_hero_const = _dota_mod._HERO_CONSTANTS
    _saved_ability_const = _dota_mod._ABILITY_CONSTANTS
    _saved_hero_abilities = _dota_mod._HERO_ABILITIES
    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None
    _dota_mod._HERO_CONSTANTS = None
    _dota_mod._ABILITY_CONSTANTS = None
    _dota_mod._HERO_ABILITIES = None

    tool = DotaBuildsTool()
    mock_heroes = [{"id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge"}]
    mock_items = {
        "start_game_items": {"13": 49, "11": 30, "12": 20},
        "mid_game_items": {"1": 42, "3": 6, "8": 4},
        "late_game_items": {"1": 13, "24": 3, "48": 2},
    }
    mock_matches = [
        {"player_slot": 0, "radiant_win": True},
        {"player_slot": 2, "radiant_win": False},
        {"player_slot": 130, "radiant_win": True},
        {"player_slot": 130, "radiant_win": False},
    ]
    mock_constants = {
        "gauntlets": {"id": 13, "dname": "Gauntlets of Strength", "cost": 140,
                      "components": None, "created": False, "desc": "", "lore": ""},
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250,
                  "components": None, "created": False, "desc": "", "lore": ""},
        "chainmail": {"id": 3, "dname": "Chainmail", "cost": 550,
                      "components": None, "created": False, "desc": "", "lore": ""},
        "claymore": {"id": 8, "dname": "Claymore", "cost": 1400,
                     "components": None, "created": False, "desc": "", "lore": ""},
        "gauntlets2": {"id": 11, "dname": "Gauntlets of Str II", "cost": 200,
                       "components": None, "created": False, "desc": "", "lore": ""},
        "slippers": {"id": 12, "dname": "Slippers of Agility", "cost": 150,
                     "components": None, "created": False, "desc": "", "lore": ""},
        "ultimate_orb": {"id": 24, "dname": "Ultimate Orb", "cost": 2150,
                        "components": None, "created": False, "desc": "", "lore": ""},
        "travel_boots": {"id": 48, "dname": "Boots of Travel", "cost": 2500,
                         "components": None, "created": False, "desc": "", "lore": ""},
    }
    mock_hero_const = {
        "10": {
            "id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge",
            "primary_attr": "str", "attack_type": "Melee", "roles": ["Disabler"],
            "base_health": 120, "base_mana": 75, "base_attack_min": 45, "base_attack_max": 51,
            "base_armor": 0, "move_speed": 280, "attack_range": 175,
            "base_str": 25, "base_agi": 11, "base_int": 16,
            "str_gain": 3.0, "agi_gain": 1.4, "int_gain": 1.8,
        },
    }
    mock_ability_const = {}
    mock_hero_abilities = {}

    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.text = ""
        if "constants/items" in url:
            resp.json = MagicMock(return_value=mock_constants)
        elif "constants/heroes" in url and "abilities" not in url:
            resp.json = MagicMock(return_value=mock_hero_const)
        elif "constants/abilities" in url:
            resp.json = MagicMock(return_value=mock_ability_const)
        elif "constants/hero_abilities" in url:
            resp.json = MagicMock(return_value=mock_hero_abilities)
        elif "liquipedia" in url:
            resp.text = ""
        elif "search" in url and "format=json" in url:
            # SearXNG search mock
            resp.json = MagicMock(return_value={"results": []})
        elif "heroes" in url and "itemPopularity" not in url and "matches" not in url:
            resp.json = MagicMock(return_value=mock_heroes)
        elif "itemPopularity" in url:
            resp.json = MagicMock(return_value=mock_items)
        elif "matches" in url:
            resp.json = MagicMock(return_value=mock_matches)
        return resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"hero": "Pudge"}, ctx)
        assert result.error is None
        output = result.output
        assert output["hero"] == "Pudge"
        assert output["win_rate"] == 50.0

        assert result.artifact is not None
        import json as _json
        artifact_content = _json.loads(result.artifact["content"])
        assert "items" in artifact_content
        item = artifact_content["items"][0]
        assert item["widgetType"] == "game_resource"
        assert item["data"]["title"] == "Pudge"
        assert item["data"]["game"] == "dota"
        assert item["data"]["type"] == "hero"

    _dota_mod._ITEM_CONSTANTS = _saved_constants
    _dota_mod._ID_TO_DNAME = _saved_id_map
    _dota_mod._HERO_CONSTANTS = _saved_hero_const
    _dota_mod._ABILITY_CONSTANTS = _saved_ability_const
    _dota_mod._HERO_ABILITIES = _saved_hero_abilities


# ── Gateway reason keys ─────────────────────────────────────


def test_gateway_run_tests_reason_key():
    """Gateway emits tool-specific reason key for run_tests."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("run_tests", "sensitive", {"framework": "pytest"}, "general")
    assert not decision.allow
    assert decision.needs_consent
    assert decision.reason_key == "consent.reason.run_tests"
    assert decision.reason_params == {"framework": "pytest"}


def test_gateway_git_worktree_reason_key():
    """Gateway emits tool-specific reason key for git_worktree."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("git_worktree", "sensitive", {"branch": "feature-1"}, "general")
    assert decision.reason_key == "consent.reason.git_worktree"
    assert decision.reason_params == {"branch": "feature-1"}


def test_gateway_organize_folder_reason_key():
    """Gateway emits tool-specific reason key for organize_folder."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("organize_folder", "sensitive", {"path": "/tmp"}, "general")
    assert decision.reason_key == "consent.reason.organize_folder"
    assert decision.reason_params == {"path": "/tmp"}


def test_gateway_launch_app_reason_key():
    """Gateway emits tool-specific reason key for launch_app."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("launch_app", "sensitive", {"name": "firefox"}, "general")
    assert decision.reason_key == "consent.reason.launch_app"
    assert decision.reason_params == {"name": "firefox"}


def test_gateway_screenshot_reason_key():
    """Gateway emits tool-specific reason key for screenshot."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("screenshot", "sensitive", {}, "general")
    assert decision.reason_key == "consent.reason.screenshot"


def test_gateway_unknown_sensitive_falls_back():
    """Gateway falls back to generic reason for unknown sensitive tool."""
    from kali_core.collar.gateway import PermissionGateway
    gw = PermissionGateway()
    decision = gw.check("unknown_tool", "sensitive", {}, "general")
    assert decision.reason_key == "consent.reason.sensitive"
    assert decision.reason_params == {"tool": "unknown_tool"}


# ── Prompt-based tool call parsing ────────────────────────


def test_parse_tool_call_basic():
    from kali_core.mind.runtime import _parse_tool_call
    text = '[TOOL_CALL: fetch_dota2_build] {"hero": "Pudge"}'
    result = _parse_tool_call(text)
    assert result is not None
    assert len(result) == 1
    name, args, match = result[0]
    assert name == "fetch_dota2_build"
    assert args == {"hero": "Pudge"}


def test_parse_tool_call_no_match():
    from kali_core.mind.runtime import _parse_tool_call
    assert _parse_tool_call("Hello, how are you?") is None


def test_parse_tool_call_surrounded_by_text():
    from kali_core.mind.runtime import _parse_tool_call
    text = "Let me look that up. [TOOL_CALL: fetch_dota2_build] {\"hero\": \"Invoker\"}. Here is the data."
    result = _parse_tool_call(text)
    assert result is not None
    assert result[0][0] == "fetch_dota2_build"
    assert result[0][1] == {"hero": "Invoker"}


def test_parse_tool_call_array_args():
    from kali_core.mind.runtime import _parse_tool_call
    text = '[TOOL_CALL: some_tool] ["item1", "item2"]'
    result = _parse_tool_call(text)
    assert result is not None
    name, args, match = result[0]
    assert name == "some_tool"
    assert args == {"raw": '["item1", "item2"]'}


def test_parse_tool_call_bad_json():
    from kali_core.mind.runtime import _parse_tool_call
    text = '[TOOL_CALL: bad] {not json}'
    result = _parse_tool_call(text)
    assert result is not None
    name, args, match = result[0]
    assert name == "bad"
    assert args == {"raw": "{not json}"}


def test_parse_tool_call_multiple():
    from kali_core.mind.runtime import _parse_tool_call
    text = (
        '[TOOL_CALL: web_search] {"q": "weather"} and then '
        '[TOOL_CALL: fetch_dota2_build] {"hero": "Pudge"}'
    )
    result = _parse_tool_call(text)
    assert result is not None
    assert len(result) == 2
    assert result[0][0] == "web_search"
    assert result[1][0] == "fetch_dota2_build"


# ── _top_n_items helper ──────────────────────────────────


def test_top_n_items_dict():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    data = {"item_a": 0.9, "item_b": 0.5, "item_c": 0.8}
    result = _top_n_items(data, 2)
    assert result == ["item_a", "item_c"]
    assert len(result) == 2


def test_top_n_items_list():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    result = _top_n_items(["sword", "shield", "potion"], 2)
    assert result == ["sword", "shield"]


def test_top_n_items_empty_dict():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    assert _top_n_items({}, 5) == []


def test_top_n_items_empty_list():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    assert _top_n_items([], 5) == []


def test_top_n_items_none():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    assert _top_n_items(None, 5) == []


def test_top_n_items_list_fewer_than_n():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    result = _top_n_items(["only"], 5)
    assert result == ["only"]


def test_top_n_items_dict_non_numeric_values():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    data = {"a": "high", "b": "low"}
    result = _top_n_items(data, 2)
    assert len(result) == 2


def test_top_n_items_dict_mixed_types():
    from kali_core.claws.game.dota2_adapter import _top_n_items
    data = {"a": 0.9, "b": "text", "c": 0.5}
    result = _top_n_items(data, 3)
    assert result[0] == "a"
    assert "c" in result


# ── Match win rate ─────────────────────────────────────


def test_match_is_win_radiant_wins():
    from kali_core.claws.game.dota2_adapter import _match_is_win
    assert _match_is_win({"player_slot": 0, "radiant_win": True}) is True
    assert _match_is_win({"player_slot": 4, "radiant_win": True}) is True


def test_match_is_win_radiant_loses():
    from kali_core.claws.game.dota2_adapter import _match_is_win
    assert _match_is_win({"player_slot": 0, "radiant_win": False}) is False
    assert _match_is_win({"player_slot": 4, "radiant_win": False}) is False


def test_match_is_win_dire_wins():
    from kali_core.claws.game.dota2_adapter import _match_is_win
    assert _match_is_win({"player_slot": 128, "radiant_win": False}) is True
    assert _match_is_win({"player_slot": 132, "radiant_win": False}) is True


def test_match_is_win_dire_loses():
    from kali_core.claws.game.dota2_adapter import _match_is_win
    assert _match_is_win({"player_slot": 128, "radiant_win": True}) is False


# ── Item constants resolution ──────────────────────────


async def test_resolve_item_ids_with_keys():
    from kali_core.claws.game.dota2_adapter import _resolve_item_ids_with_keys

    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ID_TO_DNAME = {
        "1": "Blink Dagger",
        "13": "Gauntlets of Strength",
    }
    _dota_mod._ID_TO_KEY = {
        "1": "blink",
        "13": "gauntlets",
    }

    names, keys = _resolve_item_ids_with_keys(["1", "13", "999"])
    assert "Blink Dagger" in names
    assert "Gauntlets of Strength" in names
    assert "999" in names  # Unknown ID returns as-is.
    assert keys == ["blink", "gauntlets", ""]

    _dota_mod._ID_TO_DNAME = None
    _dota_mod._ID_TO_KEY = None


async def test_item_lookup_found():
    """Look up an item by display name using mock constants."""
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {
            "id": 1, "dname": "Blink Dagger", "cost": 2250,
            "components": None, "created": False, "desc": "Teleport.",
            "lore": "Fast dagger.", "abilities": [], "attrib": [],
            "cd": 15, "mc": False,
        },
    }
    _dota_mod._ID_TO_DNAME = {"1": "Blink Dagger"}

    tool = DotaBuildsTool()
    result = await tool.run({"item": "Blink Dagger"}, ToolContext(
        session_id="t", working_dir=".", profile="gaming",
    ))
    assert result.error is None
    assert result.output["dname"] == "Blink Dagger"
    assert result.output["cost"] == 2250
    assert result.artifact is not None

    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None


async def test_item_lookup_not_found():
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {}
    _dota_mod._ID_TO_DNAME = {}

    tool = DotaBuildsTool()
    result = await tool.run({"item": "FakeItemXYZ"}, ToolContext(
        session_id="t", working_dir=".", profile="gaming",
    ))
    assert result.error is not None
    assert "not find" in result.error

    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None


async def test_item_lookup_recipe_tree():
    """Overwhelming Blink has components [blink, reaver] which should be resolved."""
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {
            "id": 1, "dname": "Blink Dagger", "cost": 2250,
            "components": None, "created": False, "desc": "",
            "lore": "", "abilities": [], "attrib": [],
            "cd": 15, "mc": False,
        },
        "reaver": {
            "id": 215, "dname": "Reaver", "cost": 3200,
            "components": None, "created": False, "desc": "",
            "lore": "", "abilities": [], "attrib": [],
            "cd": False, "mc": False,
        },
        "overwhelming_blink": {
            "id": 600, "dname": "Overwhelming Blink", "cost": 6800,
            "components": ["blink", "reaver"], "created": True, "desc": "",
            "lore": "", "abilities": [], "attrib": [],
            "cd": 15, "mc": False,
        },
    }
    _dota_mod._ID_TO_DNAME = {"1": "Blink Dagger", "215": "Reaver", "600": "Overwhelming Blink"}

    tool = DotaBuildsTool()
    result = await tool.run({"item": "Overwhelming Blink"}, ToolContext(
        session_id="t", working_dir=".", profile="gaming",
    ))
    assert result.error is None
    assert result.output["dname"] == "Overwhelming Blink"

    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None


async def test_find_item_by_dname_uses_cache():
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250},
    }
    from kali_core.claws.game.dota2_adapter import _find_item_by_dname
    item = _find_item_by_dname("BLINK DAGGER")
    assert item is not None
    assert item.get("dname") == "Blink Dagger"
    _dota_mod._ITEM_CONSTANTS = None


async def test_find_item_by_dname_prefix():
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250},
    }
    from kali_core.claws.game.dota2_adapter import _find_item_by_dname
    item = _find_item_by_dname("Blink")
    assert item is not None
    assert item.get("dname") == "Blink Dagger"
    _dota_mod._ITEM_CONSTANTS = None


async def test_find_item_by_dname_prefix_opendota():
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250},
    }
    _dota_mod._ID_TO_DNAME = {"1": "Blink Dagger"}
    from kali_core.claws.game.dota2_adapter import _find_item_by_dname
    item = _find_item_by_dname("Blink")
    assert item is not None
    assert item.get("dname") == "Blink Dagger"
    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None
    _dota_mod._ITEM_CONSTANTS = None


async def test_find_item_by_dname_prefix():
    import kali_core.claws.game.dota as _dota_mod
    _dota_mod._ITEM_CONSTANTS = {
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250},
    }
    from kali_core.claws.game.dota2_adapter import _find_item_by_dname
    item = _find_item_by_dname("Blink")
    assert item is not None
    assert item.get("dname") == "Blink Dagger"
    _dota_mod._ITEM_CONSTANTS = None


async def test_find_item_by_dname_prefix():
    from kali_core.claws.game.dota2_adapter import _find_item_by_dname, _load_item_constants
    await _load_item_constants()
    item = _find_item_by_dname("Blink")
    assert item is not None
    assert item.get("dname") == "Blink Dagger"


# ── FetchGameResourceTool (unified) ────────────────────────


async def test_fetch_game_resource_uses_adapter_for_dota():
    """When game is Dota 2, the dedicated Dota2Adapter is used."""
    from kali_core.claws.game.fetch_resource import FetchGameResourceTool
    import kali_core.claws.game.dota2_adapter as _dota_mod
    _saved_constants = _dota_mod._ITEM_CONSTANTS
    _saved_id_map = _dota_mod._ID_TO_DNAME
    _saved_hero_const = _dota_mod._HERO_CONSTANTS
    _saved_ability_const = _dota_mod._ABILITY_CONSTANTS
    _saved_hero_abilities = _dota_mod._HERO_ABILITIES
    _dota_mod._ITEM_CONSTANTS = None
    _dota_mod._ID_TO_DNAME = None
    _dota_mod._HERO_CONSTANTS = None
    _dota_mod._ABILITY_CONSTANTS = None
    _dota_mod._HERO_ABILITIES = None

    tool = FetchGameResourceTool()
    mock_heroes = [{"id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge"}]
    mock_items_pop = {
        "start_game_items": {"13": 49},
        "mid_game_items": {"1": 42},
        "late_game_items": {"1": 13},
    }
    mock_matches = [
        {"player_slot": 0, "radiant_win": True},
        {"player_slot": 128, "radiant_win": False},
    ]
    mock_constants = {
        "gauntlets": {"id": 13, "dname": "Gauntlets of Strength", "cost": 140,
                      "components": None, "created": False, "desc": "", "lore": ""},
        "blink": {"id": 1, "dname": "Blink Dagger", "cost": 2250,
                  "components": None, "created": False, "desc": "", "lore": ""},
    }
    mock_hero_const = {
        "10": {
            "id": 10, "localized_name": "Pudge", "name": "npc_dota_hero_pudge",
            "primary_attr": "str", "attack_type": "Melee", "roles": ["Disabler"],
            "base_health": 120, "base_mana": 75, "base_attack_min": 45, "base_attack_max": 51,
            "base_armor": 0, "move_speed": 280, "attack_range": 175,
            "base_str": 25, "base_agi": 11, "base_int": 16,
            "str_gain": 3.0, "agi_gain": 1.4, "int_gain": 1.8,
        },
    }
    mock_ability_const = {}
    mock_hero_abilities = {}

    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.text = ""
        if "constants/items" in url:
            resp.json = MagicMock(return_value=mock_constants)
        elif "constants/heroes" in url and "abilities" not in url:
            resp.json = MagicMock(return_value=mock_hero_const)
        elif "constants/abilities" in url:
            resp.json = MagicMock(return_value=mock_ability_const)
        elif "constants/hero_abilities" in url:
            resp.json = MagicMock(return_value=mock_hero_abilities)
        elif "liquipedia" in url:
            resp.text = ""
        elif "heroes" in url and "itemPopularity" not in url and "matches" not in url:
            resp.json = MagicMock(return_value=mock_heroes)
        elif "itemPopularity" in url:
            resp.json = MagicMock(return_value=mock_items_pop)
        elif "matches" in url:
            resp.json = MagicMock(return_value=mock_matches)
        return resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "Dota 2", "query": "Pudge"}, ctx)
        assert result.error is None
        assert result.output["hero"] == "Pudge"
        # The adapter's build_resource is used as fallback when no LLM is available.
        # It may include internal fields like _artifact_id and _streamed.

    _dota_mod._ITEM_CONSTANTS = _saved_constants
    _dota_mod._ID_TO_DNAME = _saved_id_map
    _dota_mod._HERO_CONSTANTS = _saved_hero_const
    _dota_mod._ABILITY_CONSTANTS = _saved_ability_const
    _dota_mod._HERO_ABILITIES = _saved_hero_abilities


async def test_fetch_game_resource_falls_back_to_web():
    """When no dedicated adapter exists, web search is used."""
    from kali_core.claws.game.fetch_resource import FetchGameResourceTool

    tool = FetchGameResourceTool()
    mock_search_results = {
        "results": [
            {
                "title": "Ahri Guide",
                "url": "https://www.ign.com/ahri-guide",
                "content": "Ahri is a mobility-focused mid laner.",
            }
        ]
    }

    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json = MagicMock(return_value=mock_search_results)
        return resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "League of Legends", "query": "Ahri"}, ctx)
        assert result.error is None
        assert result.artifact is not None
        import json as _json
        content = _json.loads(result.artifact["content"])
        item = content["items"][0]
        assert item["widgetType"] == "game_resource"
        assert item["data"]["game"] == "league-of-legends"
        assert len(item["data"]["sections"]) > 0


async def test_fetch_game_resource_web_fallback_fails_gracefully():
    """When web search fails, a fallback schema with a note is returned."""
    from kali_core.claws.game.fetch_resource import FetchGameResourceTool

    tool = FetchGameResourceTool()

    async def mock_get(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
        result = await tool.run({"game": "League of Legends", "query": "Ahri"}, ctx)
        assert result.error is None
        assert result.artifact is not None
        import json as _json
        content = _json.loads(result.artifact["content"])
        item = content["items"][0]
        assert item["widgetType"] == "game_resource"
        assert len(item["data"]["sections"]) == 1
        text = item["data"]["sections"][0]["text"]
        assert "could not find" in text.lower()


async def test_fetch_game_resource_missing_params():
    from kali_core.claws.game.fetch_resource import FetchGameResourceTool
    tool = FetchGameResourceTool()
    ctx = ToolContext(session_id="t", working_dir=".", profile="gaming")
    result = await tool.run({"game": ""}, ctx)
    assert result.error is not None


async def test_fetch_game_resource_registered():
    _register_tools()
    names = [t.name for t in available_tools()]
    assert "fetch_game_resource" in names
