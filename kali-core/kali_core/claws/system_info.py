"""system_info — RAM, CPU, disks, GPU and uptime of a machine, read-only.

Runs on whichever machine the call is routed to (see ``kali_core.targets``): this module is the
server side, the desktop agent has its own implementation with the same output shape. The model
never has to improvise ``free -h``, and the answer always says what it measured.
"""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import socket
from pathlib import Path
from typing import Any

from .base import ToolContext, ToolResult
from ..targets import TARGET_SCHEMA

_MB = 1024 * 1024
_SKIP_FS = {"tmpfs", "devtmpfs", "overlay", "squashfs", "proc", "sysfs", "cgroup", "cgroup2", "efivarfs"}


def parse_meminfo(text: str) -> dict[str, int]:
    """``/proc/meminfo`` → values in MB (only the keys we report)."""
    wanted = {"MemTotal": "total_mb", "MemAvailable": "available_mb", "SwapTotal": "swap_total_mb", "SwapFree": "swap_free_mb"}
    out: dict[str, int] = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        if key in wanted:
            parts = rest.split()
            if parts and parts[0].isdigit():
                out[wanted[key]] = int(parts[0]) // 1024  # kB → MB
    return out


def parse_cpuinfo(text: str) -> tuple[str | None, int]:
    model, cores = None, 0
    for line in text.splitlines():
        key, _, value = line.partition(":")
        key = key.strip()
        if key == "processor":
            cores += 1
        elif key == "model name" and model is None:
            model = value.strip()
    return model, cores


def parse_cgroup_limit(raw: str | None) -> int | None:
    """cgroup memory limit file → MB, or None when unlimited/unknown."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw or raw == "max":
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    # cgroup v1 reports "no limit" as a number close to 2**63.
    if value <= 0 or value >= 1 << 60:
        return None
    return value // _MB


def _read(path: str) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _container() -> dict[str, Any] | None:
    in_container = os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")
    limit = parse_cgroup_limit(_read("/sys/fs/cgroup/memory.max"))
    if limit is None:
        limit = parse_cgroup_limit(_read("/sys/fs/cgroup/memory/memory.limit_in_bytes"))
    if not in_container and limit is None:
        return None
    return {"in_container": in_container, "memory_limit_mb": limit}


def _disks() -> list[dict[str, Any]]:
    disks: list[dict[str, Any]] = []
    mounts = _read("/proc/mounts")
    seen: set[str] = set()
    for line in (mounts or "").splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[2] in _SKIP_FS or not parts[1].startswith("/"):
            continue
        mount = parts[1].replace("\\040", " ")
        if mount in seen or mount.startswith(("/proc", "/sys", "/dev", "/run", "/snap")):
            continue
        seen.add(mount)
        try:
            usage = shutil.disk_usage(mount)
        except OSError:
            continue
        if usage.total < 512 * _MB:
            continue
        disks.append({
            "mount": mount,
            "fs": parts[2],
            "total_gb": round(usage.total / 1024**3, 1),
            "free_gb": round(usage.free / 1024**3, 1),
        })
    if not disks:
        try:
            usage = shutil.disk_usage(os.path.abspath(os.sep))
            disks.append({"mount": os.path.abspath(os.sep), "fs": None,
                          "total_gb": round(usage.total / 1024**3, 1), "free_gb": round(usage.free / 1024**3, 1)})
        except OSError:
            pass
    return disks[:12]


async def _gpus() -> list[dict[str, Any]]:
    if shutil.which("nvidia-smi") is None:
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
    except (OSError, TimeoutError):
        return []
    gpus = []
    for line in stdout.decode("utf-8", errors="replace").splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
            gpus.append({"name": parts[0], "vram_total_mb": int(parts[1]), "vram_used_mb": int(parts[2])})
    return gpus


def _os_name() -> str:
    release = _read("/etc/os-release") or ""
    for line in release.splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip().strip('"')
    return f"{platform.system()} {platform.release()}".strip()


async def collect() -> dict[str, Any]:
    """Facts about the machine this process runs on."""
    memory: dict[str, Any] = {}
    meminfo = _read("/proc/meminfo")
    if meminfo:
        memory = parse_meminfo(meminfo)
    else:
        try:  # not Linux: psutil if the install has it
            import psutil

            vm = psutil.virtual_memory()
            memory = {"total_mb": vm.total // _MB, "available_mb": vm.available // _MB}
        except ImportError:
            pass
    if "total_mb" in memory and "available_mb" in memory:
        memory["used_mb"] = memory["total_mb"] - memory["available_mb"]

    model, cores = parse_cpuinfo(_read("/proc/cpuinfo") or "")
    cpu: dict[str, Any] = {"model": model or platform.processor() or None, "logical_cores": cores or os.cpu_count()}
    try:
        cpu["load_avg"] = [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        pass

    info: dict[str, Any] = {
        "host": socket.gethostname(),
        "os": _os_name(),
        "kernel": platform.release(),
        "cpu": cpu,
        "memory": memory,
        "disks": _disks(),
        "gpus": await _gpus(),
    }
    uptime = _read("/proc/uptime")
    if uptime:
        try:
            info["uptime_s"] = int(float(uptime.split()[0]))
        except (ValueError, IndexError):
            pass
    container = _container()
    if container is not None:
        info["container"] = container
        if container["memory_limit_mb"] and memory.get("total_mb"):
            # `free` inside a container shows the host; the limit is what the process can really use.
            info["memory"]["effective_limit_mb"] = min(container["memory_limit_mb"], memory["total_mb"])
    return info


class SystemInfoTool:
    name = "system_info"
    description = (
        "Read the hardware and load of a machine: RAM (total, used, available), CPU, disks, GPU, OS "
        "and uptime. Use it for questions like 'how much RAM do I have', 'what GPU', 'how much disk "
        "is left' instead of running shell commands. By default it reports the USER'S PC; pass "
        "target='server' only when asked about the machine that hosts Kali. The result says which "
        "machine it measured in `origin`: always tell the user."
    )
    schema = {
        "type": "object",
        "properties": {"target": TARGET_SCHEMA},
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        return ToolResult(output=await collect())
