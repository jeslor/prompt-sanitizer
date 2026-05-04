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
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from .vault import Vault

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
        Optional identifier included in audit log events.
    """

    def __init__(self, sanitizer: "Sanitizer", session_id: str | None = None) -> None:
        self._sanitizer = sanitizer
        self._vault = Vault()
        self.session_id = session_id

    # ── Core operations ──────────────────────────────────────────────────────

    def anonymize(self, text: str) -> str:
        """
        Sanitize *text*, returning the redacted version.

        Replacements are stored in the session vault for later deanonymization.
        """
        result = self._sanitizer._run(text, self._vault, session_id=self.session_id)
        return result.text

    def anonymize_with_result(self, text: str) -> "SanitizeResult":
        """Like :meth:`anonymize` but returns the full :class:`SanitizeResult`."""
        return self._sanitizer._run(text, self._vault, session_id=self.session_id)

    def deanonymize(self, text: str) -> str:
        """
        Restore all known replacement tokens in *text* to their originals.

        Pass the LLM's response here to get a human-readable output with
        real names/values restored.
        """
        return self._vault.restore(text)

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
