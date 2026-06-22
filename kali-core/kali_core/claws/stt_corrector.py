"""STT corrector tool — fixes common mis-transcriptions of English game terms.

Uses fuzzy matching against a curated list of multi-game terms and highly
recognizable hero names. Only corrects when the original word is not a
valid Spanish word, avoiding false positives in regular conversation.
"""

from __future__ import annotations

import logging
import re

from rapidfuzz import fuzz

from .base import ToolContext, ToolResult

logger = logging.getLogger("kali_core.claws.stt_corrector")

# English game terms that span many genres and are frequently misheard
# by Spanish STT models. These are NOT tied to any specific game.
_GAME_TERMS: set[str] = {
    # Role / mechanic terms (universal across games)
    "build", "mid", "top", "bot", "jungle", "support", "carry",
    "tank", "healer", "dps", "mage", "assassin", "warrior", "ranger",
    "buffer", "debuff", "farm", "gank", "lane", "wave", "spawn",
    "respawn", "cooldown", "mana", "hp", "mp", "xp", "armor",
    "shield", "heal", "stealth", "crit", "aura", "passive",
    "ultimate", "combo", "stun", "slow", "silence", "root",
    "agility", "strength", "intelligence", "movement", "attack",
    "defense", "damage", "healing", "ranged", "melee",
    # Highly recognizable hero / character names that are commonly
    # mis-transcribed and unlikely to collide with Spanish words.
    "sniper", "pudge", "invoker", "phantom", "shadow", "blade",
    "void", "storm", "spirit", "crystal", "vengeful", "lina",
    "zeus", "axe", "ursa", "riki", "slark", "timber", "tinker",
    "gyrocopter", "spectre", "morphling", "antimage", "bloodseeker",
    "drow", "windranger", "faceless", "bounty", "phantom", "slardar",
    "sand", "earth", "ember", "templar", "obsidian", "outworld",
    "puck", "pugna", "necrophos", "viper", "clinkz", "brood",
    "weaver", "skitter", "night", "bane", "enigma", "warlock",
    "witch", "lich", "lich", "leshrac", "death", "prophet",
    "nature", "chen", "enchantress", "keeper", "kotl", "jakiro",
    "oracle", "winter", "wyvern", "dark", "willow", "hoodwink",
    "mars", "dawnbreaker", "primal", "beast", "snapfire",
    "void", "spectre", "faceless", "morphling", "terror",
    "chaos", "illusion", "naga", "siren", "tidehunter", "kunkka",
    "centaur", "bristleback", "axe", "legion", "commander",
    "tusk", "earthshaker", "tiny", "clockwerk", "timbersaw",
    "phoenix", "io", "wisp", "chen", "enchantress", "nature",
    "prophet", "lone", "druid", "lycan", "beastmaster",
    "visage", "brewmaster", "disruptor", "kaldr", "ancient",
    "apparition", "gyrocopter", "sniper", "tinker", "clockwerk",
}

# Common Spanish words that could collide with game terms above.
# These should NEVER be "corrected".
_SPANISH_SAFE: set[str] = {
    "luna", "tiny", "sombra", "sombras", "sombría", "arena", "arena",
    "tormenta", "tormentas", "espíritu", "espíritus", "cristal",
    "cristales", "muerte", "muertes", "naturaleza", "guerrero",
    "guerreros", "torre", "torres", "niebla", "nieblas", "brisa",
    "brisas", "noche", "noches", "aurora", "auroras", "sirena",
    "sirenas", "hielo", "hielos", "fuego", "fuegos", "tierra",
    "tierras", "rayo", "rayos", "viento", "vientos", "ola", "olas",
    "mar", "mares", "roca", "rocas", "flor", "flores", "hoja",
    "hojas", "rama", "ramas", "fruta", "frutas", "ave", "aves",
    "pez", "peces", "lobo", "lobos", "oso", "osos", "águila",
    "águilas", "serpiente", "serpientes", "dragón", "dragones",
    "demonio", "demonios", "ángel", "ángeles", "rey", "reinas",
    "reina", "reyes", "príncipe", "princesa", "príncipes",
    "princesas", "caballero", "caballeros", "magia", "magias",
    "hechizo", "hechizos", "poción", "pociones", "veneno",
    "venenos", "venenoso", "escarcha", "escarchas", "llama",
    "llamas", "brasa", "brasas", "ceniza", "cenizas",
    "polvo", "polvos", "humo", "humos", "niebla", "nieblas",
    "eco", "ecos", "eco", "ecos", "eco", "ecos",
    "como", "cómo",
}

# Threshold for fuzzy matching (0-100). High enough to avoid false
# positives but lenient enough to catch "snaiper" → "sniper".
_FUZZY_THRESHOLD = 88


def _is_spanish_word(word: str) -> bool:
    """Check if a lowercase word appears in the Spanish safe-list."""
    return word.lower() in _SPANISH_SAFE


def _should_correct(word: str, candidates: set[str]) -> str | None:
    """Return the best correction for a word, or None if no good match.

    A word is only corrected when:
    1. It fuzzy-matches a known game term above the threshold.
    2. The match is NOT an exact match (word is already correct).
    3. The word itself is NOT a valid Spanish word.
    """
    lower = word.lower()
    if _is_spanish_word(lower):
        return None

    # If the word is already an exact match, no correction needed.
    if lower in candidates:
        return None

    best_score = 0
    best_match: str | None = None

    for candidate in candidates:
        score = fuzz.ratio(lower, candidate)
        if score > best_score:
            best_score = score
            best_match = candidate

    if best_score >= _FUZZY_THRESHOLD and best_match is not None:
        # Preserve original casing: if the original word started with
        # uppercase, keep it uppercase in the correction.
        if word[0].isupper():
            best_match = best_match[0].upper() + best_match[1:]
        return best_match

    return None


def correct_stt_text(text: str) -> tuple[str, list[dict]]:
    """Apply STT correction to a text string.

    Returns ``(corrected_text, changes)`` where each change is a dict
    with ``original`` and ``corrected`` keys.
    """
    if not text:
        return text, []

    words = text.split()
    changes: list[dict] = []
    corrected_words: list[str] = []

    for word in words:
        stripped = word.strip(".,!?;:\"'()[]{}")
        if not stripped or not stripped.isalpha():
            corrected_words.append(word)
            continue

        correction = _should_correct(stripped, _GAME_TERMS)
        if correction is not None:
            changes.append({"original": stripped, "corrected": correction})
            suffix = word[len(stripped):]
            corrected_words.append(correction + suffix)
        else:
            corrected_words.append(word)

    return " ".join(corrected_words), changes


class SttCorrectorTool:
    """Post-process STT output to fix common game-term mis-transcriptions."""

    name = "stt_correct"
    description = (
        "Fix mis-transcribed English game terms in STT output. "
        "Called automatically on every STT result. "
        "Does not require user invocation."
    )
    schema = {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Raw STT text to correct.",
            },
        },
        "required": ["text"],
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        text = params.get("text", "")
        if not text:
            return ToolResult(output={"corrected": False, "text": ""})

        words = text.split()
        changes: list[dict] = []
        corrected_words: list[str] = []

        for word in words:
            # Skip punctuation-only tokens.
            stripped = word.strip(".,!?;:\"'()[]{}")
            if not stripped or not stripped.isalpha():
                corrected_words.append(word)
                continue

            correction = _should_correct(stripped, _GAME_TERMS)
            if correction is not None:
                changes.append({"original": stripped, "corrected": correction})
                # Preserve any trailing punctuation.
                suffix = word[len(stripped):]
                corrected_words.append(correction + suffix)
            else:
                corrected_words.append(word)

        if changes:
            logger.info("STT corrections: %s", changes)
            return ToolResult(output={
                "corrected": True,
                "text": " ".join(corrected_words),
                "changes": changes,
            })

        return ToolResult(output={"corrected": False, "text": text})