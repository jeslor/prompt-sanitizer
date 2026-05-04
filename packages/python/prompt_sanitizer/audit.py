"""
Audit Log — optional structured event log for compliance.

Stores a hashed record of every PII detection event.
The original PII value is **never** stored — only a SHA-256 prefix hash,
making the audit log itself safe to store and export.

Two backends are provided:
- ``MemoryAuditLog``  — in-process list, for development / testing
- ``SQLiteAuditLog``  — persists to a local SQLite DB (uses stdlib sqlite3)

A ``BaseAuditLog`` ABC allows custom backends (e.g. PostgreSQL, S3).

Usage::

    audit = SQLiteAuditLog("~/.prompt-sanitizer/audit.db")
    sanitizer = Sanitizer(mode=Mode.FULL, audit_log=audit)
    ...
    report = audit.export(format="json", since="30d")
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal


# ---------------------------------------------------------------------------
# AuditEvent — what we store (never the raw PII)
# ---------------------------------------------------------------------------

@dataclass
class AuditEvent:
    timestamp: str          # ISO-8601 UTC
    entity_type: str        # EntityType.value
    confidence: float       # detection confidence
    layer: str              # "regex" | "secrets" | "ner"
    redaction_method: str   # "synthetic" | "placeholder" | "original" (warn mode)
    text_hash: str          # SHA-256[:16] of the original PII value (NOT the value itself)
    session_id: str | None  # optional caller-supplied session identifier


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _hash_value(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:16]


def _parse_since(since: str | datetime | None) -> datetime | None:
    if since is None:
        return None
    if isinstance(since, datetime):
        return since
    # Parse shorthand like "7d", "30d", "1h".
    # Add a 1-second grace buffer so that events recorded just before the
    # cutoff is computed are still included (avoids sub-second race conditions).
    if since.endswith("d"):
        return datetime.now(tz=timezone.utc) - timedelta(days=int(since[:-1])) - timedelta(seconds=1)
    if since.endswith("h"):
        return datetime.now(tz=timezone.utc) - timedelta(hours=int(since[:-1])) - timedelta(seconds=1)
    # Try ISO string
    return datetime.fromisoformat(since)


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class BaseAuditLog(ABC):
    """Implement this to plug in a custom audit log backend."""

    @abstractmethod
    def record(self, event: AuditEvent) -> None: ...

    @abstractmethod
    def export(
        self,
        format: Literal["json", "csv"] = "json",
        since: str | datetime | None = None,
        session_id: str | None = None,
    ) -> str: ...

    @abstractmethod
    def count(self, since: str | datetime | None = None) -> int: ...


# ---------------------------------------------------------------------------
# In-memory backend
# ---------------------------------------------------------------------------

class MemoryAuditLog(BaseAuditLog):
    """Stores events in a Python list. Resets on process restart."""

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

    def record(self, event: AuditEvent) -> None:
        self._events.append(event)

    def _filter(
        self,
        since: str | datetime | None,
        session_id: str | None,
    ) -> list[AuditEvent]:
        cutoff = _parse_since(since)
        events = self._events
        if cutoff:
            events = [
                e for e in events
                if datetime.fromisoformat(e.timestamp) >= cutoff
            ]
        if session_id:
            events = [e for e in events if e.session_id == session_id]
        return events

    def export(
        self,
        format: Literal["json", "csv"] = "json",
        since: str | datetime | None = None,
        session_id: str | None = None,
    ) -> str:
        events = self._filter(since, session_id)
        if format == "json":
            return json.dumps([asdict(e) for e in events], indent=2)
        # CSV
        if not events:
            return ""
        fields = list(asdict(events[0]).keys())
        lines = [",".join(fields)]
        for e in events:
            row = asdict(e)
            lines.append(",".join(str(row[f]) for f in fields))
        return "\n".join(lines)

    def count(self, since: str | datetime | None = None) -> int:
        return len(self._filter(since, None))


# ---------------------------------------------------------------------------
# SQLite backend
# ---------------------------------------------------------------------------

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS audit_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    confidence      REAL NOT NULL,
    layer           TEXT NOT NULL,
    redaction_method TEXT NOT NULL,
    text_hash       TEXT NOT NULL,
    session_id      TEXT
);
"""


class SQLiteAuditLog(BaseAuditLog):
    """Persists events to a local SQLite database file."""

    def __init__(self, db_path: str | Path = "~/.prompt-sanitizer/audit.db") -> None:
        self._path = Path(db_path).expanduser()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(_CREATE_TABLE)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        return conn

    def record(self, event: AuditEvent) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO audit_events "
                "(timestamp, entity_type, confidence, layer, redaction_method, text_hash, session_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    event.timestamp,
                    event.entity_type,
                    event.confidence,
                    event.layer,
                    event.redaction_method,
                    event.text_hash,
                    event.session_id,
                ),
            )

    def _rows(
        self,
        since: str | datetime | None,
        session_id: str | None,
    ) -> list[dict]:
        cutoff = _parse_since(since)
        params: list[object] = []
        where_clauses: list[str] = []

        if cutoff:
            where_clauses.append("timestamp >= ?")
            params.append(cutoff.isoformat())
        if session_id:
            where_clauses.append("session_id = ?")
            params.append(session_id)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM audit_events {where} ORDER BY timestamp", params
            ).fetchall()
        return [dict(row) for row in rows]

    def export(
        self,
        format: Literal["json", "csv"] = "json",
        since: str | datetime | None = None,
        session_id: str | None = None,
    ) -> str:
        rows = self._rows(since, session_id)
        if format == "json":
            return json.dumps(rows, indent=2)
        if not rows:
            return ""
        fields = list(rows[0].keys())
        lines = [",".join(fields)]
        for row in rows:
            lines.append(",".join(str(row[f]) for f in fields))
        return "\n".join(lines)

    def count(self, since: str | datetime | None = None) -> int:
        return len(self._rows(since, None))
