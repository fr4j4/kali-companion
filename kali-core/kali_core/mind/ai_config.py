"""AI configuration persistence layer.

Loads / saves the AI provider config from ai_config.json next to the
.sidecar file.  Falls back to environment-variable defaults (the legacy
behaviour) when the file does not exist so first-run is frictionless.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path

from kali_core.config import settings

logger = logging.getLogger("kali_core.mind.ai_config")

_CONFIG_PATH = Path(__file__).parent.parent.parent.parent / "ai_config.json"


@dataclass
class AIConfig:
    provider: str = "direct"
    api_url: str = "http://localhost:11434/v1"
    api_key: str = ""
    model: str = "glm-5.1"
    system_prompt_override: str | None = None
    max_tokens: int = 16384

    def to_env_map(self) -> dict[str, str]:
        """Return a dict suitable for updating os.environ / dotenv."""
        out = {
            "KALI_LLM_PROVIDER": self.provider,
            "KALI_LLM_API_URL": self.api_url,
            "KALI_LLM_API_KEY": self.api_key,
            "KALI_LLM_MODEL": self.model,
            "KALI_LLM_MAX_TOKENS": str(self.max_tokens),
        }
        if self.system_prompt_override is not None:
            out["KALI_LLM_SYSTEM_PROMPT"] = self.system_prompt_override
        return out


def load() -> AIConfig:
    """Load AI config from file, falling back to env vars."""
    if not _CONFIG_PATH.exists():
        logger.info("No ai_config.json found — using env-var defaults")
        return AIConfig(
            provider=settings.llm_provider,
            api_url=settings.llm_api_url,
            api_key=settings.llm_api_key,
            model=settings.llm_model,
        )

    try:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        cfg = AIConfig(**{k: v for k, v in raw.items() if k in AIConfig.__dataclass_fields__})
        logger.info("Loaded AI config from %s", _CONFIG_PATH)
        return cfg
    except Exception as exc:
        logger.warning("Failed to load ai_config.json (%s) — falling back to env vars", exc)
        return AIConfig(
            provider=settings.llm_provider,
            api_url=settings.llm_api_url,
            api_key=settings.llm_api_key,
            model=settings.llm_model,
        )


def save(cfg: AIConfig) -> None:
    """Persist AI config to file."""
    try:
        with open(_CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(asdict(cfg), fh, indent=2, ensure_ascii=False)
        logger.info("Saved AI config to %s", _CONFIG_PATH)
    except Exception as exc:
        logger.error("Failed to write ai_config.json: %s", exc)
        raise
