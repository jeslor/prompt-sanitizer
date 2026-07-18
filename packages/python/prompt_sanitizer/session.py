"""
Session — bidirectional anonymize/deanonymize for multi-turn LLM workflows.

A Session holds a shared Vault so that:
- The same original PII value always maps to the same token within a session.
- LLM responses can be deanonymized back to the originals.

Usage::

    s = Sanitizer(mode=Mode.SMART)

    session = s.session()
    clean_prompt = session.anonymize(user_prompt)
    llm_response = call_llm(clean_prompt)
    final = session.deanonymize(llm_response)

    # Context manager — vault cleared on exit
    with s.session() as sess:
        clean = sess.anonymize(text)
        ...

By default a session's vault lives only in process memory. Pass a
``store`` (see :mod:`prompt_sanitizer.vault_store`) to reattach to the same
mapping later — e.g. after a process restart — by ``session_id``::

    store = SQLiteVaultStore("./vault.db")
    session = s.session(session_id="user-42", store=store)
    clean = session.anonymize(user_prompt)
    session.persist()
    # ...later, possibly in a new process:
    resumed = s.session(session_id="user-42", store=store)
    final = resumed.deanonymize(llm_reply)
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from .exceptions import VaultStoreError
from .vault import Vault
from .vault_store import BaseVaultStore, assert_supported_version, to_vault_snapshot

if TYPE_CHECKING:
    from .result import SanitizeResult
    from .sanitizer import Sanitizer


class Session:
    """
    Maintains a shared :class:`Vault` across multiple anonymize/deanonymize calls.

    Parameters
    ----------
    sanitizer:
        The parent :class:`Sanitizer` instance.
    session_id:
        Optional identifier included in audit log events, and required to
        use ``store``.
    store:
        Optional :class:`BaseVaultStore`. If given (with ``session_id``),
        any previously-persisted vault for this session is loaded
        synchronously before the session is returned to the caller.
    auto_persist:
        If True, persist to ``store`` at the end of every ``anonymize()``
        call. Default False — call :meth:`persist` explicitly.
    """

    def __init__(
        self,
        sanitizer: "Sanitizer",
        session_id: str | None = None,
        store: Optional[BaseVaultStore] = None,
        auto_persist: bool = False,
    ) -> None:
        self._sanitizer = sanitizer
        self._vault = Vault()
        self.session_id = session_id
        self._store = store
        self._auto_persist = auto_persist
        self._hydrate()

    def _hydrate(self) -> None:
        if self._store is None or self.session_id is None:
            return
        snapshot = self._store.load(self.session_id)
        if snapshot is None:
            return
        assert_supported_version(snapshot)
        self._vault.hydrate({"mappings": snapshot.mappings, "counters": snapshot.counters})

    # ── Core operations ──────────────────────────────────────────────────────

    def anonymize(self, text: str) -> str:
        """
        Sanitize *text*, returning the redacted version.

        Replacements are stored in the session vault for later deanonymization.
        """
        result = self._sanitizer._run(text, self._vault, session_id=self.session_id)
        if self._auto_persist:
            self.persist()
        return result.text

    def anonymize_with_result(self, text: str) -> "SanitizeResult":
        """Like :meth:`anonymize` but returns the full :class:`SanitizeResult`."""
        result = self._sanitizer._run(text, self._vault, session_id=self.session_id)
        if self._auto_persist:
            self.persist()
        return result

    def deanonymize(self, text: str) -> str:
        """
        Restore all known replacement tokens in *text* to their originals.

        Pass the LLM's response here to get a human-readable output with
        real names/values restored.
        """
        return self._vault.restore(text)

    def persist(self) -> None:
        """
        Persist the current vault state to this session's store.

        Raises :class:`VaultStoreError` if this session wasn't created with
        both a ``session_id`` and a ``store``.
        """
        if self._store is None or self.session_id is None:
            raise VaultStoreError(
                "Session.persist() requires both session_id and store to "
                "have been passed to Sanitizer.session()."
            )
        self._store.save(self.session_id, to_vault_snapshot(self.session_id, self._vault.to_data()))

    def forget(self) -> None:
        """
        Delete this session's persisted snapshot from its store, if any.
        Does not clear the in-memory vault — call :meth:`reset` for that too.
        """
        if self._store is None or self.session_id is None:
            return
        self._store.delete(self.session_id)

    def reset(self) -> None:
        """Clear the vault, starting a fresh mapping for this session."""
        self._vault.clear()

    # ── Introspection ────────────────────────────────────────────────────────

    @property
    def vault(self) -> Vault:
        """Direct access to the underlying vault (read-only recommended)."""
        return self._vault

    @property
    def mapping(self) -> dict[str, str]:
        """Snapshot of the current original → replacement mapping."""
        return self._vault.snapshot()

    def __len__(self) -> int:
        """Number of PII values currently stored in the session vault."""
        return len(self._vault)

    # ── Context manager ──────────────────────────────────────────────────────

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *_) -> None:
        self.reset()

    def __repr__(self) -> str:
        return f"Session(id={self.session_id!r}, mappings={len(self)})"
