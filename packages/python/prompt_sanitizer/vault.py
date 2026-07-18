from __future__ import annotations

import re
import threading
from typing import Optional, TypedDict

from .exceptions import VaultCollisionError

_PLACEHOLDER_RE = re.compile(r"^\[([A-Z_]+)_(\d+)\]$")


class VaultData(TypedDict):
    """Plain-data view of a vault's mappings + counters, for persistence."""

    mappings: dict[str, str]
    counters: dict[str, int]


class Vault:
    """
    Thread-safe bidirectional in-memory store for a sanitization session.

    Maps original PII values → their replacement tokens and vice-versa.
    Deterministic within a session: the same original always maps to the
    same replacement.

    Each vault also owns its own per-entity-type placeholder counters (the
    "1" in ``[PERSON_1]``), so a vault is a fully self-contained unit that
    can be serialized and restored later (e.g. via a ``VaultStore``, after a
    process restart) without colliding with counters from unrelated sessions.
    """

    def __init__(self) -> None:
        self._forward: dict[str, str] = {}  # original  → replacement
        self._reverse: dict[str, str] = {}  # replacement → original
        self._counters: dict[str, int] = {}  # entity type → next index
        self._lock = threading.Lock()

    # ── Write ────────────────────────────────────────────────────────────────

    def add(self, original: str, replacement: str) -> str:
        """
        Store an original → replacement mapping.

        If the original is already mapped, the existing replacement is
        returned (determinism guarantee).  Returns the active replacement.

        Raises :class:`VaultCollisionError` if *replacement* is already
        mapped to a *different* original — silently overwriting it would
        make the old placeholder deanonymize to the wrong value.
        """
        with self._lock:
            if original in self._forward:
                return self._forward[original]

            claimed_by = self._reverse.get(replacement)
            if claimed_by is not None and claimed_by != original:
                raise VaultCollisionError(replacement, claimed_by, original)

            self._forward[original] = replacement
            self._reverse[replacement] = original
            return replacement

    def next_count(self, entity_type: str) -> int:
        """
        Return the next counter value for *entity_type* (starting at 1) and
        advance it. Used to number placeholders like ``[PERSON_1]``.
        """
        with self._lock:
            n = self._counters.get(entity_type, 0) + 1
            self._counters[entity_type] = n
            return n

    def ensure_counter_at_least(self, entity_type: str, n: int) -> None:
        """
        Ensure this vault's counter for *entity_type* is at least *n*.

        Used when hydrating from a persisted snapshot to guarantee newly
        generated placeholders never reuse an already-restored token.
        """
        with self._lock:
            if n > self._counters.get(entity_type, 0):
                self._counters[entity_type] = n

    # ── Read ─────────────────────────────────────────────────────────────────

    def get_replacement(self, original: str) -> Optional[str]:
        """Return the replacement for *original*, or None if not stored."""
        return self._forward.get(original)

    def get_original(self, replacement: str) -> Optional[str]:
        """Return the original value for *replacement*, or None if not stored."""
        return self._reverse.get(replacement)

    # ── Restore ──────────────────────────────────────────────────────────────

    def restore(self, text: str) -> str:
        """
        Replace all known replacement tokens in *text* with their originals.

        Replacements are applied longest-first to avoid partial substitutions
        (e.g., ``[EMAIL_1]`` before ``[EMAIL]``).
        """
        with self._lock:
            result = text
            for replacement, original in sorted(
                self._reverse.items(), key=lambda x: len(x[0]), reverse=True
            ):
                result = result.replace(replacement, original)
        return result

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def clear(self) -> None:
        """Remove all stored mappings and reset counters."""
        with self._lock:
            self._forward.clear()
            self._reverse.clear()
            self._counters.clear()

    # ── Helpers ──────────────────────────────────────────────────────────────

    def __len__(self) -> int:
        return len(self._forward)

    def __contains__(self, original: str) -> bool:
        return original in self._forward

    def snapshot(self) -> dict[str, str]:
        """Return a copy of the forward mapping (original → replacement)."""
        with self._lock:
            return dict(self._forward)

    def counter_snapshot(self) -> dict[str, int]:
        """Return a copy of the per-entity-type counters."""
        with self._lock:
            return dict(self._counters)

    def to_data(self) -> VaultData:
        """Plain-data view of this vault's mappings + counters, for persistence."""
        return {"mappings": self.snapshot(), "counters": self.counter_snapshot()}

    def hydrate(self, data: VaultData) -> None:
        """
        Populate this (normally freshly-constructed, empty) vault from
        previously-persisted data.

        Counters are restored from ``data["counters"]`` directly, then
        additionally reconciled by scanning ``data["mappings"]`` for
        ``[TYPE_N]``-shaped tokens and bumping the counter for ``TYPE`` to
        at least ``N`` — defense in depth for a hand-rolled VaultStore that
        persists mappings but forgets counters. This reconciliation can't
        disambiguate the small set of secret types that share one
        placeholder pattern (e.g. API_KEY / SECRET_KEY / OAUTH_TOKEN all
        falling back to a generic bracketed token) — explicit counter
        persistence is what makes those safe; the reconciliation pass is a
        best-effort backstop, not a substitute for it.
        """
        with self._lock:
            for original, replacement in data["mappings"].items():
                self._forward[original] = replacement
                self._reverse[replacement] = original
            for entity_type, n in data["counters"].items():
                if n > self._counters.get(entity_type, 0):
                    self._counters[entity_type] = n
            for replacement in data["mappings"].values():
                match = _PLACEHOLDER_RE.match(replacement)
                if match:
                    entity_type, n_str = match.group(1), match.group(2)
                    n = int(n_str)
                    if n > self._counters.get(entity_type, 0):
                        self._counters[entity_type] = n
