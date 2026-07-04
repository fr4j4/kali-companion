"""SessionStore — CRUD over a local SQLite database.

Persists sessions and messages so they survive restarts. Used by the
server to list sessions and replay conversation history.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite


class SessionStore:
    """Persists sessions and messages to SQLite."""

    def __init__(self, db_path: str = "~/.local/share/kali/kali.db") -> None:
        self._db_path = str(Path(db_path).expanduser())

    async def _ensure_db(self) -> None:
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New chat',
                    created TEXT NOT NULL,
                    updated TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL,
                    window_type TEXT NOT NULL DEFAULT '',
                    language TEXT NOT NULL DEFAULT '',
                    created TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                )
            """)
            # Migration: add window_type column if missing (older DBs).
            try:
                await db.execute("ALTER TABLE artifacts ADD COLUMN window_type TEXT NOT NULL DEFAULT ''")
            except Exception as e:
                if "duplicate column" not in str(e).lower():
                    raise
            # Migration: add language column if missing (older DBs).
            try:
                await db.execute("ALTER TABLE artifacts ADD COLUMN language TEXT NOT NULL DEFAULT ''")
            except Exception as e:
                if "duplicate column" not in str(e).lower():
                    raise
            await db.execute("""
                CREATE TABLE IF NOT EXISTS game_images (
                    key TEXT PRIMARY KEY,
                    game TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    cached_at TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS custom_voices (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL DEFAULT 'qwen3',
                    instructions TEXT NOT NULL,
                    seed INTEGER NOT NULL DEFAULT -1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.execute(
                "UPDATE custom_voices SET provider='qwen3' WHERE provider='qwen3-voicedesign'"
            )
            await db.commit()

    async def create_session(self, title: str = "New chat") -> dict:
        """Create a new session and return its metadata."""
        await self._ensure_db()
        sid = f"sess_{uuid.uuid4().hex[:8]}"
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "INSERT INTO sessions (id, title, created, updated) VALUES (?, ?, ?, ?)",
                (sid, title, now, now),
            )
            await db.commit()
        return {"id": sid, "title": title, "created": now, "updated": now}

    async def list_sessions(self) -> list[dict]:
        """Return all sessions ordered by most recent first."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, title, created, updated FROM sessions ORDER BY updated DESC"
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def add_message(self, session_id: str, role: str, content: str) -> dict:
        """Append a message to a session and bump its updated time."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "INSERT INTO messages (session_id, role, content, created) VALUES (?, ?, ?, ?)",
                (session_id, role, content, now),
            )
            await db.execute(
                "UPDATE sessions SET updated = ? WHERE id = ?",
                (now, session_id),
            )
            await db.commit()
            msg_id = cursor.lastrowid
        return {"id": msg_id, "session_id": session_id, "role": role, "content": content}

    async def set_title_if_default(self, session_id: str, title: str) -> bool:
        """Update the session title only if it is still the default.

        Returns True if the title was actually changed.
        """
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "UPDATE sessions SET title = ? WHERE id = ? AND title = 'New chat'",
                (title, session_id),
            )
            await db.commit()
            return cursor.rowcount > 0

    async def get_messages(self, session_id: str) -> list[dict]:
        """Return all messages for a session in chronological order."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT id, session_id, role, content, created
                   FROM messages WHERE session_id = ? ORDER BY id""",
                (session_id,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def add_artifact(
        self,
        session_id: str,
        artifact_id: str,
        type: str,
        title: str,
        content: str,
        window_type: str = "",
        language: str = "",
    ) -> dict:
        """Persist an artifact so it can be replayed on session reattach."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT OR REPLACE INTO artifacts
                   (id, session_id, type, title, content, window_type, language, created)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (artifact_id, session_id, type, title, content, window_type, language, now),
            )
            await db.commit()
        return {
            "id": artifact_id,
            "session_id": session_id,
            "type": type,
            "title": title,
            "content": content,
            "window_type": window_type,
            "language": language,
            "created": now,
        }

    async def get_artifacts(self, session_id: str) -> list[dict]:
        """Return all artifacts for a session in creation order."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT id, session_id, type, title, content, window_type, language, created
                   FROM artifacts WHERE session_id = ? ORDER BY created""",
                (session_id,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def get_artifact(self, session_id: str, artifact_id: str) -> dict | None:
        """Return a single artifact by id, scoped to the given session."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT id, session_id, type, title, content, window_type, language, created
                   FROM artifacts WHERE id = ? AND session_id = ?""",
                (artifact_id, session_id),
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def update_artifact_content(
        self,
        session_id: str,
        artifact_id: str,
        content: str,
        title: str | None = None,
    ) -> dict | None:
        """Update an existing artifact's content (and optionally title).

        Returns the updated row as a dict, or None if the artifact was not
        found in the given session.
        """
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            if title is not None:
                cursor = await db.execute(
                    """UPDATE artifacts
                       SET content = ?, title = ?, created = ?
                       WHERE id = ? AND session_id = ?""",
                    (content, title, now, artifact_id, session_id),
                )
            else:
                cursor = await db.execute(
                    """UPDATE artifacts
                       SET content = ?, created = ?
                       WHERE id = ? AND session_id = ?""",
                    (content, now, artifact_id, session_id),
                )
            await db.commit()
            if cursor.rowcount == 0:
                return None
        return await self.get_artifact(session_id, artifact_id)

    # ── Game image cache ───────────────────────────────────

    async def add_game_image(
        self,
        key: str,
        game: str,
        type: str,
        file_path: str,
        source_url: str,
    ) -> dict:
        """Register a cached game image."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT OR REPLACE INTO game_images
                   (key, game, type, file_path, source_url, cached_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (key, game, type, file_path, source_url, now),
            )
            await db.commit()
        return {
            "key": key,
            "game": game,
            "type": type,
            "file_path": file_path,
            "source_url": source_url,
            "cached_at": now,
        }

    async def get_game_image(self, key: str) -> dict | None:
        """Check if a game image is cached."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM game_images WHERE key = ?",
                (key,),
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def session_exists(self, session_id: str) -> bool:
        """Check if a session exists by ID."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
            row = await cursor.fetchone()
            return row is not None

    async def delete_session(self, session_id: str) -> None:
        """Delete a session, its messages, and its artifacts."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM artifacts WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            await db.commit()

    async def delete_all_sessions(self) -> None:
        """Delete all sessions, messages, and artifacts."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("DELETE FROM messages")
            await db.execute("DELETE FROM artifacts")
            await db.execute("DELETE FROM sessions")
            await db.commit()

    # ── Custom Voices ───────────────────────────────────────

    async def list_custom_voices(self, provider: str | None = None) -> list[dict]:
        """Return all custom voices, optionally filtered by provider."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            if provider:
                cursor = await db.execute(
                    "SELECT * FROM custom_voices WHERE provider = ? ORDER BY created_at DESC",
                    (provider,),
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM custom_voices ORDER BY created_at DESC"
                )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]

    async def create_custom_voice(
        self,
        name: str,
        provider: str,
        instructions: str,
        seed: int = -1,
    ) -> dict:
        """Create a new custom voice."""
        await self._ensure_db()
        vid = f"cv_{uuid.uuid4().hex[:8]}"
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """INSERT INTO custom_voices
                   (id, name, provider, instructions, seed, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (vid, name, provider, instructions, seed, now, now),
            )
            await db.commit()
        return {
            "id": vid,
            "name": name,
            "provider": provider,
            "instructions": instructions,
            "seed": seed,
            "created_at": now,
            "updated_at": now,
        }

    async def get_custom_voice(self, voice_id: str) -> dict | None:
        """Return a single custom voice by id."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM custom_voices WHERE id = ?",
                (voice_id,),
            )
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def update_custom_voice(
        self,
        voice_id: str,
        name: str | None = None,
        instructions: str | None = None,
        seed: int | None = None,
    ) -> dict | None:
        """Update an existing custom voice. Only provided fields are updated."""
        await self._ensure_db()
        now = datetime.now(UTC).isoformat()
        async with aiosqlite.connect(self._db_path) as db:
            existing = await db.execute(
                "SELECT * FROM custom_voices WHERE id = ?",
                (voice_id,),
            )
            row = await existing.fetchone()
            if not row:
                return None
            current = dict(row)
            await db.execute(
                """UPDATE custom_voices
                   SET name = ?, instructions = ?, seed = ?, updated_at = ?
                   WHERE id = ?""",
                (
                    name if name is not None else current["name"],
                    instructions if instructions is not None else current["instructions"],
                    seed if seed is not None else current["seed"],
                    now,
                    voice_id,
                ),
            )
            await db.commit()
        return await self.get_custom_voice(voice_id)

    async def delete_custom_voice(self, voice_id: str) -> bool:
        """Delete a custom voice. Returns True if deleted, False if not found."""
        await self._ensure_db()
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "DELETE FROM custom_voices WHERE id = ?",
                (voice_id,),
            )
            await db.commit()
            return cursor.rowcount > 0
