"""Generic image download handler — fetches game images from CDN sources.

Images are downloaded in the background via the JobManager, cached on disk
at ``~/.local/share/kali/images/{game}/``, and indexed in the ``game_images``
SQLite table. The frontend receives ``image_ready`` WS events when each
image becomes available.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from kali_core.nest.store import SessionStore

logger = logging.getLogger("kali_core.claws.game.image_cache")

TIMEOUT = 15.0


async def _download_one(
    url: str,
    dest: Path,
) -> bool:
    """Download a single image. Returns True on success."""
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
        return True
    except Exception as e:
        logger.warning("Failed to download %s: %s", url, e)
        return False


async def download_game_images_handler(
    job: Any,
    log: Any,
    progress: Any,
    result_fn: Any,
    emit: Any,
) -> None:
    """JobManager handler: download a batch of game images.

    Expects ``job.params`` to contain::
        {
            "images": [
                {"key": "dota:hero:pudge", "game": "dota", "type": "hero",
                 "url": "https://...", "path": "dota/heroes/pudge.png"},
            ],
            "images_dir": "/home/.../.local/share/kali/images",
            "db_path": "/home/.../.local/share/kali/kali.db"
        }
    """
    params = job.params
    images: list[dict] = params.get("images", [])
    images_dir = Path(params.get("images_dir", ""))
    db_path = params.get("db_path", "")
    store = SessionStore(db_path)

    if not images:
        await log("No images to download")
        await result_fn({"downloaded": 0, "cached": 0, "failed": 0})
        return

    total = len(images)
    downloaded = 0
    cached = 0
    failed = 0
    ready_paths: list[dict] = []

    await log(f"Starting download of {total} image(s)")

    for i, img in enumerate(images):
        key = img["key"]
        game = img.get("game", "unknown")
        url = img["url"]
        rel_path = img["path"]
        dest = images_dir / rel_path

        cached_img = await store.get_game_image(key)
        if cached_img and dest.exists():
            cached += 1
            ready_paths.append({"key": key, "path": rel_path})
            await log(f"Cached: {key}")
            if emit is not None:
                await emit({"event": "image_ready", "key": key, "path": rel_path})
        else:
            await log(f"Downloading: {key} from {url}")
            success = await _download_one(url, dest)
            if success:
                downloaded += 1
                await store.add_game_image(key, game, img.get("type", ""), rel_path, url)
                ready_paths.append({"key": key, "path": rel_path})
                await log(f"Downloaded: {key}")
                if emit is not None:
                    await emit({"event": "image_ready", "key": key, "path": rel_path})
            else:
                failed += 1
                await log(f"Failed: {key}")

        pct = int((i + 1) / total * 100)
        await progress(pct)

    await log(f"Done: {downloaded} downloaded, {cached} cached, {failed} failed")
    await result_fn({
        "downloaded": downloaded,
        "cached": cached,
        "failed": failed,
        "ready": ready_paths,
    })