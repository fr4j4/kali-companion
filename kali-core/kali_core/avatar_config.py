"""Shared avatar appearance: one JSON blob the core stores and fans out to every client.

The canvas customizer, the Electron floating avatar and the native avatar agent all render
from this blob, so a change made in the app shows up everywhere without a restart.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("kali_core.avatar_config")

_DEFAULT_PATH = Path(__file__).parent.parent.parent / "avatar_config.json"
MAX_BYTES = 8 * 1024


def config_path() -> Path:
    override = os.environ.get("KALI_AVATAR_CONFIG")
    return Path(override) if override else _DEFAULT_PATH


def sanitize(config: Any) -> dict[str, Any] | None:
    """Return a JSON-safe dict, or None when the payload is not an acceptable config."""
    if not isinstance(config, dict):
        return None
    try:
        encoded = json.dumps(config, ensure_ascii=False)
    except (TypeError, ValueError):
        return None
    if len(encoded.encode("utf-8")) > MAX_BYTES:
        return None
    return config


def load() -> dict[str, Any] | None:
    try:
        return sanitize(json.loads(config_path().read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return None


def save(config: dict[str, Any]) -> None:
    path = config_path()
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        logger.warning("could not persist avatar config: %s", exc)
