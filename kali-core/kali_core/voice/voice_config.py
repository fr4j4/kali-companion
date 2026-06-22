"""VoiceConfigManager — loads and validates per-voice JSON configs.

Each voice has its own JSON with model, params (length_scale, noise_scale,
noise_w_scale), modes (mapping mode name → effects list), and an optional
default_mode. Ported and simplified from lapis-tts
`src/voice_config/manager.py`.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("kali_core.voice.config_manager")


class VoiceConfigManager:
    """Loads per-voice JSON configs from a directory."""

    def __init__(self, configs_dir: Path | str) -> None:
        self.configs_dir = Path(configs_dir)
        self._configs: dict[str, dict[str, Any]] = {}
        self._load_configs()

    def _load_configs(self) -> None:
        if not self.configs_dir.exists():
            logger.warning("Voice configs directory does not exist: %s", self.configs_dir)
            return
        for json_file in sorted(self.configs_dir.glob("*.json")):
            try:
                with json_file.open("r", encoding="utf-8") as f:
                    config = json.load(f)
                errors = self._validate(config)
                if errors:
                    logger.error(
                        "Skipping invalid config %s: %s",
                        json_file.name,
                        "; ".join(errors),
                    )
                    continue
                voice_id = config["voice_id"]
                self._configs[voice_id] = config
                logger.info("Voice config loaded: %s", voice_id)
            except json.JSONDecodeError as e:
                logger.error("Invalid JSON in %s: %s", json_file, e)
            except Exception as e:
                logger.error("Error loading config %s: %s", json_file, e)

    def _validate(self, config: dict) -> list[str]:
        errors: list[str] = []
        for required in ("voice_id", "name", "model", "params", "modes"):
            if required not in config:
                errors.append(f"Missing required field '{required}'")
        if "params" in config and isinstance(config["params"], dict):
            for key in ("length_scale", "noise_scale", "noise_w_scale"):
                if key not in config["params"]:
                    errors.append(f"Missing '{key}' in params")
        if "modes" in config and (
            not isinstance(config["modes"], dict) or not config["modes"]
        ):
            errors.append("'modes' must be a non-empty object")
        return errors

    def get_voice(self, voice_id: str) -> dict[str, Any] | None:
        return self._configs.get(voice_id)

    def list_voices(self, include_inactive: bool = False) -> list[dict]:
        voices: list[dict] = []
        for voice_id, config in self._configs.items():
            if not include_inactive and not config.get("active", True):
                continue
            voices.append(
                {
                    "voice_id": voice_id,
                    "name": config.get("name", voice_id),
                    "description": config.get("description", ""),
                    "model": config.get("model", ""),
                    "modes": list(config.get("modes", {}).keys()),
                    "default_mode": config.get("default_mode", "normal"),
                    "active": config.get("active", True),
                }
            )
        return voices

    def has_voice(self, voice_id: str) -> bool:
        return voice_id in self._configs

    def get_modes(self, voice_id: str) -> list[str]:
        config = self._configs.get(voice_id)
        if not config:
            return []
        return list(config.get("modes", {}).keys())

    def get_effects_for_mode(self, voice_id: str, mode: str) -> list[str]:
        """Return the list of effect names for a voice's mode."""
        config = self._configs.get(voice_id)
        if not config:
            return []
        modes = config.get("modes", {})
        mode_cfg = modes.get(mode) or modes.get(config.get("default_mode", "normal"), {})
        return list(mode_cfg.get("effects", []))

    def get_params(self, voice_id: str) -> dict[str, float]:
        config = self._configs.get(voice_id)
        if not config:
            return {"length_scale": 1.0, "noise_scale": 0.667, "noise_w_scale": 0.8}
        default = {"length_scale": 1.0, "noise_scale": 0.667, "noise_w_scale": 0.8}
        return config.get("params", default)