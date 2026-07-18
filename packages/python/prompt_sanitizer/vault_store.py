"""
Pluggable persistence for session vaults.

A Vault normally lives only in process memory — it's gone on restart,
worker swap, or serverless cold start. A VaultStore lets ``Session``
reattach to a previously-persisted vault by ``session_id``, so a multi-turn
conversation's PII mapping survives beyond one process's lifetime.

No store is active unless you explicitly pass one — this is opt-in and
changes nothing for existing callers. The bundled stores below write the
*actual original values* (that's the point — restoration needs them), so
treat the underlying db/file with the same sensitivity as the source PII.

Two backends are provided, mirroring :mod:`prompt_sanitizer.audit`:
- ``MemoryVaultStore`` — in-process dict, same-process reattach only
- ``SQLiteVaultStore`` — persists to a local SQLite DB (uses stdlib sqlite3)

A ``BaseVaultStore`` ABC allows custom backends (e.g. Redis, Postgres).
"""
from __future__ import annotations

import json
import sqlite3
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .exceptions import VaultStoreError
from .vault import VaultData

# Current on-disk/on-wire shape of a persisted vault. Bump on breaking changes.
VAULT_SNAPSHOT_VERSION = 1


@dataclass
class VaultSnapshot:
    version: int
    session_id: str
    updated_at: str
    mappings: dict[str, str]
    counters: dict[str, int]


def to_vault_snapshot(session_id: str, data: VaultData) -> VaultSnapshot:
    """Build a fresh :class:`VaultSnapshot` envelope around a vault's data."""
    return VaultSnapshot(
        version=VAULT_SNAPSHOT_VERSION,
        session_id=session_id,
        updated_at=datetime.now(tz=timezone.utc).isoformat(),
        mappings=dict(data["mappings"]),
        counters=dict(data["counters"]),
    )


def assert_supported_version(snapshot: VaultSnapshot) -> None:
    """Raises :class:`VaultStoreError` if ``snapshot.version`` isn't understood."""
    if snapshot.version != VAULT_SNAPSHOT_VERSION:
        raise VaultStoreError(
            f"Vault snapshot for session '{snapshot.session_id}' has version "
            f"{snapshot.version}, but this build of prompt-sanitizer only "
            f"understands version {VAULT_SNAPSHOT_VERSION}."
        )


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class BaseVaultStore(ABC):
    """Implement this to plug in a custom vault persistence backend."""

    @abstractmethod
    def load(self, session_id: str) -> Optional[VaultSnapshot]: ...

    @abstractmethod
    def save(self, session_id: str, snapshot: VaultSnapshot) -> None: ...

    @abstractmethod
    def delete(self, session_id: str) -> None: ...


# ---------------------------------------------------------------------------
# In-memory backend
# ---------------------------------------------------------------------------

class MemoryVaultStore(BaseVaultStore):
    """
    Same-process-only reference store — a plain dict keyed by session_id.

    Useful for reattaching a session by id within one long-lived process
    (e.g. a server holding many users' sessions) or in tests. Does NOT
    survive a process restart; for that, use :class:`SQLiteVaultStore` or
    implement ``BaseVaultStore`` against your own infrastructure.
    """

    def __init__(self) -> None:
        self._snapshots: dict[str, VaultSnapshot] = {}

    def load(self, session_id: str) -> Optional[VaultSnapshot]:
        snapshot = self._snapshots.get(session_id)
        return VaultSnapshot(**asdict(snapshot)) if snapshot else None

    def save(self, session_id: str, snapshot: VaultSnapshot) -> None:
        self._snapshots[session_id] = VaultSnapshot(**asdict(snapshot))

    def delete(self, session_id: str) -> None:
        self._snapshots.pop(session_id, None)


# ---------------------------------------------------------------------------
# SQLite backend
# ---------------------------------------------------------------------------

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS vault_snapshots (
    session_id TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    mappings   TEXT NOT NULL,
    counters   TEXT NOT NULL
);
"""


class SQLiteVaultStore(BaseVaultStore):
    """Persists one row per session to a local SQLite database file."""

    def __init__(self, db_path: str | Path = "~/.prompt-sanitizer/vault.db") -> None:
        self._path = Path(db_path).expanduser()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(_CREATE_TABLE)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        return conn

    def load(self, session_id: str) -> Optional[VaultSnapshot]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM vault_snapshots WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None:
            return None
        try:
            return VaultSnapshot(
                version=row["version"],
                session_id=row["session_id"],
                updated_at=row["updated_at"],
                mappings=json.loads(row["mappings"]),
                counters=json.loads(row["counters"]),
            )
        except (json.JSONDecodeError, KeyError) as err:
            raise VaultStoreError(
                f"Failed to parse stored vault snapshot for session '{session_id}'"
            ) from err

    def save(self, session_id: str, snapshot: VaultSnapshot) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO vault_snapshots (session_id, version, updated_at, mappings, counters) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(session_id) DO UPDATE SET "
                "version=excluded.version, updated_at=excluded.updated_at, "
                "mappings=excluded.mappings, counters=excluded.counters",
                (
                    session_id,
                    snapshot.version,
                    snapshot.updated_at,
                    json.dumps(snapshot.mappings),
                    json.dumps(snapshot.counters),
                ),
            )

    def delete(self, session_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM vault_snapshots WHERE session_id = ?", (session_id,))
