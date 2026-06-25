"""Port scanner for local LLM API endpoints.

Two-phase scan: first a fast socket-level sweep to find open ports,
then HTTP GET /v1/models only on those open ports.  This is orders of
magnitude faster than probing every port with HTTP (socket sweep of
4000 ports takes ~0.5s; HTTP probing takes 60s+).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger("kali_core.mind.scanner")

DEFAULT_PORT_FROM = 8000
DEFAULT_PORT_TO = 12300
SOCKET_TIMEOUT_MS = 200
HTTP_TIMEOUT_S = 3.0
SOCKET_CONCURRENCY = 500

_PATHS = ("/v1/models", "/models")


@dataclass
class LocalEndpoint:
    port: int
    url: str
    vendor: str
    models: list[str]


def _guess_vendor(data: dict, text: str) -> str:
    obj = str(data.get("object", ""))
    combined = f"{obj} {text}".lower()
    if "ollama" in combined:
        return "ollama"
    if "llama.cpp" in combined or "llama-cpp" in combined:
        return "llama.cpp"
    if "lmstudio" in combined or "lm studio" in combined:
        return "lmstudio"
    if "vllm" in combined:
        return "vllm"
    if "unsloth" in combined:
        return "unsloth"
    return "openai-compatible"


def _parse_models(data: dict) -> list[str]:
    raw = data.get("data", data.get("models", []))
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for m in raw:
        if isinstance(m, dict) and "id" in m:
            out.append(str(m["id"]))
        elif isinstance(m, str):
            out.append(m)
    return out


async def _socket_open(host: str, port: int, timeout: float) -> bool:
    """Return True if a TCP connection can be opened on host:port."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except (OSError, asyncio.TimeoutError, ConnectionRefusedError):
        return False
    except Exception:
        return False


async def _http_probe(client: httpx.AsyncClient, host: str, port: int, timeout: float) -> LocalEndpoint | None:
    """Probe a single open port for OpenAI-compatible /models endpoints."""
    for path in _PATHS:
        url = f"http://{host}:{port}{path}"
        try:
            resp = await client.get(url, timeout=timeout)
            if resp.status_code != 200:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            models = _parse_models(data)
            vendor = _guess_vendor(data, resp.text[:500])
            return LocalEndpoint(
                port=port,
                url=f"http://{host}:{port}/v1",
                vendor=vendor,
                models=models,
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError):
            continue
        except Exception:
            continue
    return None


async def scan_local(
    host: str = "127.0.0.1",
    port_from: int = DEFAULT_PORT_FROM,
    port_to: int = DEFAULT_PORT_TO,
    timeout_ms: float = SOCKET_TIMEOUT_MS,
    max_concurrency: int = SOCKET_CONCURRENCY,
) -> list[LocalEndpoint]:
    """Two-phase scan: fast socket sweep, then HTTP probe only open ports."""
    ports = list(range(port_from, port_to + 1))
    if not ports:
        return []

    socket_timeout = timeout_ms / 1000.0
    sem = asyncio.Semaphore(max_concurrency)

    # Phase 1: fast socket sweep
    async def _wrapped_socket(port: int) -> bool:
        async with sem:
            return await _socket_open(host, port, socket_timeout)

    open_results = await asyncio.gather(
        *[_wrapped_socket(p) for p in ports], return_exceptions=True
    )
    open_ports = [p for p, ok in zip(ports, open_results) if ok is True]
    logger.info("Socket sweep: %d open ports in range %d-%d: %s", len(open_ports), port_from, port_to, open_ports)

    if not open_ports:
        return []

    # Phase 2: HTTP probe only open ports
    results: list[LocalEndpoint] = []
    async with httpx.AsyncClient() as client:
        found = await asyncio.gather(
            *[_http_probe(client, host, p, HTTP_TIMEOUT_S) for p in open_ports],
            return_exceptions=True,
        )
        for endpoint in found:
            if isinstance(endpoint, LocalEndpoint):
                results.append(endpoint)
                logger.debug("Found LLM endpoint at %s:%d — %s", host, endpoint.port, endpoint.vendor)

    results.sort(key=lambda e: e.port)
    return results


async def list_models(api_url: str, api_key: str = "") -> list[str]:
    """Fetch the model list from an arbitrary OpenAI-compatible endpoint."""
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    base = api_url.rstrip("/")
    for path in ("/v1/models", "/models"):
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{base}{path}", headers=headers, timeout=10.0)
            if resp.status_code != 200:
                continue
            data = resp.json()
            models = _parse_models(data)
            if models:
                return models
        except Exception:
            continue
    return []