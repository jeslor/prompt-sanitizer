from __future__ import annotations

import threading
from typing import Optional


class Vault:
    """
    Thread-safe bidirectional in-memory store for a sanitization session.

    Maps original PII values → their replacement tokens and vice-versa.
    Deterministic within a session: the same original always maps to the
    same replacement.  The vault is never persisted — it lives only in memory.
    """

    def __init__(self) -> None:
        self._forward: dict[str, str] = {}  # original  → replacement
        self._reverse: dict[str, str] = {}  # replacement → original
        self._lock = threading.Lock()

    # ── Write ────────────────────────────────────────────────────────────────

    def add(self, original: str, replacement: str) -> str:
        """
        Store an original → replacement mapping.

        If the original is already mapped, the existing replacement is
        returned (determinism guarantee).  Returns the active replacement.
        """
        with self._lock:
            if original not in self._forward:
                self._forward[original] = replacement
                self._reverse[replacement] = original
            return self._forward[original]

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
        """Remove all stored mappings."""
        with self._lock:
            self._forward.clear()
            self._reverse.clear()

    # ── Helpers ──────────────────────────────────────────────────────────────

    def __len__(self) -> int:
        return len(self._forward)

    def __contains__(self, original: str) -> bool:
        return original in self._forward

    def snapshot(self) -> dict[str, str]:
        """Return a copy of the forward mapping (original → replacement)."""
        with self._lock:
            return dict(self._forward)
