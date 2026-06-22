"""JobManager — generic background job system.

Jobs are async tasks that run independently of the chat turn lifecycle.
They report progress and logs via WebSocket events and can be cancelled
by the user. Jobs are persisted to SQLite so they survive reconnections.

Usage:
    mgr = JobManager(job_store, emit_callback)
    mgr.register_handler("dota_image_download", download_handler)
    job_id = await mgr.spawn("dota_image_download", {"images": [...]}, session_id)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from kali_core.nest.job_store import JobStore

logger = logging.getLogger("kali_core.mind.jobs")

JobHandler = Callable[
    ["Job", Callable[[str], Awaitable[None]], Callable[[int], Awaitable[None]], Callable[[dict], Awaitable[None]], Any],
    Awaitable[Any],
]


@dataclass
class Job:
    """A single background job instance."""

    id: str
    type: str
    status: str = "pending"  # pending, running, done, error, cancelled
    params: dict[str, Any] = field(default_factory=dict)
    result: Any = None
    error: str | None = None
    progress: int = 0
    session_id: str | None = None
    created_at: str = ""
    started_at: str = ""
    finished_at: str = ""
    log_lines: list[str] = field(default_factory=list)
    task: asyncio.Task | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "params": self.params,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "session_id": self.session_id,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    """Manages background jobs: spawning, cancellation, progress, logs."""

    def __init__(
        self,
        job_store: JobStore,
        emit_callback: Callable[[dict], Awaitable[None]] | None = None,
    ) -> None:
        self._store = job_store
        self._emit = emit_callback
        self._jobs: dict[str, Job] = {}
        self._handlers: dict[str, JobHandler] = {}

    def set_emit_callback(self, cb: Callable[[dict], Awaitable[None]]) -> None:
        self._emit = cb

    def register_handler(self, job_type: str, handler: JobHandler) -> None:
        """Register an async handler for a job type."""
        self._handlers[job_type] = handler

    async def spawn(
        self,
        job_type: str,
        params: dict[str, Any],
        session_id: str | None = None,
    ) -> str:
        """Create a job, persist it, and launch it in the background.

        Returns the job ID immediately — the job runs asynchronously.
        """
        job_id = f"job_{uuid.uuid4().hex[:8]}"
        now = datetime.now(UTC).isoformat()

        job = Job(
            id=job_id,
            type=job_type,
            params=params,
            session_id=session_id,
            created_at=now,
        )
        self._jobs[job_id] = job

        await self._store.add_job(job_id, job_type, params, session_id)

        handler = self._handlers.get(job_type)
        if handler is None:
            job.status = "error"
            job.error = f"No handler registered for job type '{job_type}'"
            await self._store.update_job(job_id, status="error", error=job.error, finished_at=now)
            await self._emit_job_done(job)
            return job_id

        task = asyncio.create_task(self._run_job(job, handler))
        job.task = task
        return job_id

    async def _run_job(self, job: Job, handler: JobHandler) -> None:
        """Execute a job handler and manage its lifecycle."""
        now = datetime.now(UTC).isoformat()
        job.status = "running"
        job.started_at = now
        await self._store.update_job(job.id, status="running", started_at=now)
        await self._emit_event({
            "event": "job_start",
            "id": job.id,
            "type": job.type,
            "params": job.params,
            "session_id": job.session_id,
        })

        async def log_fn(msg: str) -> None:
            job.log_lines.append(msg)
            await self._store.add_log(job.id, msg)
            await self._emit_event({
                "event": "job_log",
                "id": job.id,
                "line": msg,
            })

        async def progress_fn(pct: int) -> None:
            job.progress = max(0, min(100, pct))
            await self._store.update_job(job.id, progress=job.progress)
            await self._emit_event({
                "event": "job_progress",
                "id": job.id,
                "progress": job.progress,
            })

        async def result_fn(result: dict) -> None:
            job.result = result
            await self._store.update_job(job.id, result=result)

        async def emit_fn(payload: dict) -> None:
            await self._emit_event(payload)

        try:
            await handler(job, log_fn, progress_fn, result_fn, emit_fn)
            finished = datetime.now(UTC).isoformat()
            job.status = "done"
            job.finished_at = finished
            job.progress = 100
            await self._store.update_job(
                job.id, status="done", progress=100, finished_at=finished,
                result=job.result,
            )
            await self._emit_job_done(job)
        except asyncio.CancelledError:
            finished = datetime.now(UTC).isoformat()
            job.status = "cancelled"
            job.finished_at = finished
            await self._store.update_job(job.id, status="cancelled", finished_at=finished)
            await self._emit_job_done(job)
            raise
        except Exception as e:
            logger.exception("Job %s failed", job.id)
            finished = datetime.now(UTC).isoformat()
            job.status = "error"
            job.error = str(e)
            job.finished_at = finished
            await self._store.update_job(
                job.id, status="error", error=str(e), finished_at=finished,
            )
            await self._emit_job_done(job)

    async def _emit_job_done(self, job: Job) -> None:
        await self._emit_event({
            "event": "job_done",
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "progress": job.progress,
            "result": job.result,
            "error": job.error,
        })

    async def _emit_event(self, payload: dict) -> None:
        if self._emit is not None:
            try:
                await self._emit(payload)
            except Exception:
                logger.warning("Failed to emit job event", exc_info=True)

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running job. Returns True if cancelled."""
        job = self._jobs.get(job_id)
        if job is None or job.task is None:
            return False
        if job.task.done():
            return False
        job.task.cancel()
        return True

    def get_job(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    async def list_jobs(self) -> list[dict]:
        """Return all jobs (from DB for persistence)."""
        return await self._store.list_jobs()

    async def get_logs(self, job_id: str) -> list[dict]:
        return await self._store.get_logs(job_id)