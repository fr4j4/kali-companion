"""Anti-spoiler filter for game info.

Detects and redacts spoiler content from game-related text.
Configurable strictness via KALI_SPOILER_STRICTNESS env var.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("kali_core.claws.game.spoiler_filter")

_STRICTNESS = os.getenv("KALI_SPOILER_STRICTNESS", "normal")

SPOILER_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bending\b", re.IGNORECASE),
    re.compile(r"\bfinal\s+boss\b", re.IGNORECASE),
    re.compile(r"\bplot\s+twist\b", re.IGNORECASE),
    re.compile(r"\bdies?\b", re.IGNORECASE),
    re.compile(r"\bkilled?\b", re.IGNORECASE),
    re.compile(r"\bbetray(al|s|ed)\b", re.IGNORECASE),
    re.compile(r"\brevealed?\s+to\s+be\b", re.IGNORECASE),
    re.compile(r"\bsecretly\b", re.IGNORECASE),
    re.compile(r"\bsacrifices?\b", re.IGNORECASE),
    re.compile(r"\bsurvives?\b", re.IGNORECASE),
]

SPOILER_DOMAINS: list[str] = [
    "fandom.com",
    "gamefaqs.com",
    "reddit.com",
    "tvtropes.org",
    "spoiler.io",
    "gamerant.com",
]

_REDACTED = "[SPOILER REDACTED]"


def filter_text(text: str) -> tuple[str, int]:
    """Redact spoiler content. Returns (filtered_text, count)."""
    if _STRICTNESS == "off":
        return text, 0

    count = 0
    for pattern in SPOILER_PATTERNS:
        if pattern.search(text):
            if _STRICTNESS == "strict":
                text = pattern.sub(_REDACTED, text)
                count += 1
            else:
                # Normal: only redact sentence-level spoilers.
                lines = text.split("\n")
                new_lines: list[str] = []
                for line in lines:
                    if pattern.search(line):
                        if len(line) < 120:
                            new_lines.append(_REDACTED)
                            count += 1
                        else:
                            new_lines.append(line)
                    else:
                        new_lines.append(line)
                text = "\n".join(new_lines)
    return text, count


def is_spoiler_domain(url: str) -> bool:
    """Check if a URL belongs to a known spoiler-risk domain."""
    for domain in SPOILER_DOMAINS:
        if domain in url.lower():
            return True
    return False
