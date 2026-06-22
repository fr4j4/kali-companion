"""JobStore — persists background jobs and their logs to SQLite.

Jobs are long-running background tasks (e.g. image downloads) that
run independently of the chat turn lifecycle. They are tracked so
the UI can show progress, logs, and allow cancellation.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiosqlite


class JobStore:
    """Persists jobs and job logs to SQLite."""

    def __init__(self, db_path: str = "~/.local/share/kali/kali.db") -> None:
        self._db_path = str(Path(db_path).expanduser())

    async def _ensure_db(self) -> None:
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    params TEXT NOT NULL DEFAULT '{}',
                    result TEXT,
                    error TEXT,
                    progress INTEGER NOT NULL DEFAULT 0,
                    session_id TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS job_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    line TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (job_id) REFERENCES jobs(id)
                )
            """)
            await db.commit()

    async def add_job(
        self,
        job_id: str,
        job_type: str,
        params: dict[str, Any],
        session_id: str | None = None,
    ) -> dict:
        """Insert a new job record."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO jobs (id, type, status, params, progress, session_id, created_at)
                   VALUES (?, ?, 'pending', ?, 0, ?, ?)""",
                (job_id, job_type, json.dumps(params), session_id, now),
            )
            await db.commit()
        return {
            "id": job_id,
            "type": job_type,
            "status": "pending",
            "params": params,
            "progress": 0,
            "session_id": session_id,
            "created_at": now,
        }

    async def update_job(
        self,
        job_id: str,
        status: str | None = None,
        progress: int | None = None,
        result: Any = None,
        error: str | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
    ) -> None:
        """Update select fields of a job."""
        await self._ensure_db()
        sets: list[str] = []
        vals: list[Any] = []
        if status is not None:
            sets.append("status = ?")
            vals.append(status)
        if progress is not None:
            sets.append("progress = ?")
            vals.append(progress)
        if result is not None:
            sets.append("result = ?")
            vals.append(json.dumps(result))
        if error is not None:
            sets.append("error = ?")
            vals.append(error)
        if started_at is not None:
            sets.append("started_at = ?")
            vals.append(started_at)
        if finished_at is not None:
            sets.append("finished_at = ?")
            vals.append(finished_at)
        if not sets:
            return
        vals.append(job_id)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?",
                vals,
            )
            await db.commit()

    async def get_job(self, job_id: str) -> dict | None:
        """Return a single job by ID."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM jobs WHERE id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            d = dict(row)
            d["params"] = json.loads(d.get("params") or "{}")
            if d.get("result"):
                d["result"] = json.loads(d["result"])
            return d

    async def list_jobs(self, limit: int = 50) -> list[dict]:
        """Return recent jobs, newest first."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
            rows = await cursor.fetchall()
            result = []
            for row in rows:
                d = dict(row)
                d["params"] = json.loads(d.get("params") or "{}")
                if d.get("result"):
                    d["result"] = json.loads(d["result"])
                result.append(d)
            return result

    async def add_log(self, job_id: str, line: str) -> dict:
        """Append a log line to a job."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "INSERT INTO job_logs (job_id, line, created_at) VALUES (?, ?, ?)",
                (job_id, line, now),
            )
            await db.commit()
            return {"id": cursor.lastrowid, "job_id": job_id, "line": line, "created_at": now}

    async def get_logs(self, job_id: str) -> list[dict]:
        """Return all log lines for a job in chronological order."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM job_logs WHERE job_id = ? ORDER BY id",
                (job_id,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]