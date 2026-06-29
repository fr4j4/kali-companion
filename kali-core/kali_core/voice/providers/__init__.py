"""TTS provider registry — factory, discovery, and fallback chain.

Mirrors ear/providers/__init__.py. Provider construction is lazy: the
qwen3 subprocess is not spawned until get_tts_provider("qwen3") is
called for the first time. Singletons are cached so switching back to a
previously-constructed provider is instant.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import TTSProvider

_providers: dict[str, "TTSProvider"] = {}

TTS_FALLBACK_CHAIN: dict[str, str] = {
    "qwen3": "piper",
    "http": "piper",
    "piper": "unavailable",
    "unavailable": "unavailable",
}

_PROVIDER_DISPLAY_NAMES: dict[str, str] = {
    "piper": "Piper",
    "qwen3": "Qwen3-TTS",
    "http": "HTTP",
    "unavailable": "Unavailable",
}


def get_tts_provider(provider_id: str) -> "TTSProvider":
    """Return (or create) the singleton TTS provider for *provider_id*."""
    if provider_id in _providers:
        return _providers[provider_id]
    if provider_id == "piper":
        from .piper import PiperTTSProvider
        _providers[provider_id] = PiperTTSProvider()
    elif provider_id == "qwen3":
        from .qwen import QwenTTSProvider
        _providers[provider_id] = QwenTTSProvider()
    elif provider_id == "http":
        from .http import HTTPTTSProvider
        _providers[provider_id] = HTTPTTSProvider()
    elif provider_id == "unavailable":
        from .null import NullTTSProvider
        _providers[provider_id] = NullTTSProvider()
    else:
        raise ValueError(f"Unknown TTS provider: {provider_id}")
    return _providers[provider_id]


def list_tts_providers() -> list[dict]:
    """Return metadata for every known TTS provider."""
    return [
        {"id": pid, "display_name": name, "active": pid in _providers}
        for pid, name in _PROVIDER_DISPLAY_NAMES.items()
    ]


def get_tts_fallback(provider_id: str) -> str:
    """Return the next provider id to try if *provider_id* fails to start."""
    return TTS_FALLBACK_CHAIN.get(provider_id, "unavailable")


def reset_registry() -> None:
    """Clear all cached provider singletons (for tests)."""
    for prov in _providers.values():
        shutdown = getattr(prov, "shutdown", None)
        if callable(shutdown):
            try:
                shutdown()
            except Exception:
                pass
    _providers.clear()


__all__ = [
    "get_tts_provider",
    "list_tts_providers",
    "get_tts_fallback",
    "TTS_FALLBACK_CHAIN",
    "reset_registry",
]