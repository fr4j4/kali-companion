from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class ImageRequest:
    key: str
    game: str
    type: str
    url: str
    path: str


@dataclass
class ResourceSchema:
    game: str
    type: str
    title: str
    image: dict[str, Any] | None = None
    sections: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class GameAdapter(Protocol):
    game: str

    async def build_resource(
        self, query: str, ctx: Any = None
    ) -> ResourceSchema | None:
        ...

    def build_image_requests(
        self, schema: ResourceSchema
    ) -> list[ImageRequest]:
        ...


_ADAPTER_REGISTRY: dict[str, GameAdapter] = {}


def register_adapter(adapter_cls):
    instance = adapter_cls() if isinstance(adapter_cls, type) else adapter_cls
    _ADAPTER_REGISTRY[instance.game] = instance
    return adapter_cls


def get_adapter(game: str) -> GameAdapter | None:
    return _ADAPTER_REGISTRY.get(game)


def get_all_adapters() -> list[GameAdapter]:
    return list(_ADAPTER_REGISTRY.values())


__all__ = [
    "ImageRequest", "ResourceSchema", "GameAdapter",
    "register_adapter", "get_adapter", "get_all_adapters",
]
