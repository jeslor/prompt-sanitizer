"""
Core Sanitizer class — the main public interface of prompt-sanitizer.

Ties together the regex engine, secrets engine, optional NER engine,
synthetic replacement, vault, and audit log.
"""
from __future__ import annotations

from typing import Callable

from .audit import AuditEvent, BaseAuditLog, MemoryAuditLog, _hash_value, _now_iso
from .engines.ner_engine import NEREngine
from .engines.regex_engine import RegexEngine
from .engines.secrets_engine import SecretsEngine
from .entities import EntityType
from .exceptions import PIIDetectedError
from .modes import Mode
from .result import DetectedEntity, SanitizeResult
from .synthetic import SyntheticEngine
from .vault import Vault


# ---------------------------------------------------------------------------
# Span deduplication
# ---------------------------------------------------------------------------

def _deduplicate(entities: list[DetectedEntity]) -> list[DetectedEntity]:
    """
    Remove overlapping spans.

    Strategy: sort by confidence descending (then span length descending),
    greedily keep non-overlapping entities, return sorted by start position.
    """
    if not entities:
        return entities

    ranked = sorted(
        entities,
        key=lambda e: (e.confidence, e.end - e.start),
        reverse=True,
    )

    kept: list[DetectedEntity] = []
    kept_spans: list[tuple[int, int]] = []

    for entity in ranked:
        overlaps = any(
            not (entity.end <= s or entity.start >= e)
            for s, e in kept_spans
        )
        if not overlaps:
            kept.append(entity)
            kept_spans.append((entity.start, entity.end))

    return sorted(kept, key=lambda e: e.start)


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

class Sanitizer:
    """
    Main entry point for prompt-sanitizer.

    Parameters
    ----------
    mode:
        ``Mode.FAST``  — regex + secrets only (default, zero ML deps).
        ``Mode.SMART`` — adds Piiranha NER for names & context PII.
        ``Mode.FULL``  — SMART + synthetic replacements + audit logging.
    locale:
        BCP-47 locale string used by the synthetic engine (e.g. ``"en_US"``).
    entities:
        Whitelist of EntityType values to detect.  ``None`` means all.
    on_detect:
        ``"redact"``  — replace PII with synthetic/placeholder values (default).
        ``"warn"``    — return original text, populate entities list.
        ``"block"``   — raise ``PIIDetectedError`` if any PII is found.
    audit_log:
        Optional ``BaseAuditLog`` instance.  If ``None``, a ``MemoryAuditLog``
        is created when ``mode=Mode.FULL``; ignored otherwise.
    """

    def __init__(
        self,
        mode: Mode = Mode.FAST,
        locale: str = "en_US",
        entities: list[EntityType] | None = None,
        on_detect: str = "redact",
        audit_log: BaseAuditLog | None = None,
    ) -> None:
        self.mode = mode
        self.locale = locale
        self.on_detect = on_detect

        self._allowed_entities: set[EntityType] | None = (
            set(entities) if entities else None
        )

        # Always-on engines
        self._regex = RegexEngine()
        self._secrets = SecretsEngine()

        # Optional NER (lazy-loads on first SMART/FULL call)
        self._ner: NEREngine | None = NEREngine() if mode in (Mode.SMART, Mode.FULL) else None

        # Synthetic engine (used in FULL mode or when on_detect="redact")
        self._synthetic = SyntheticEngine(locale=locale)

        # Audit log
        self._audit: BaseAuditLog | None
        if audit_log is not None:
            self._audit = audit_log
        elif mode == Mode.FULL:
            self._audit = MemoryAuditLog()
        else:
            self._audit = None

    # ── Public API ───────────────────────────────────────────────────────────

    @property
    def audit(self) -> BaseAuditLog | None:
        """Access the audit log (only available when mode=FULL or audit_log was supplied)."""
        return self._audit

    def sanitize(self, text: str, session_id: str | None = None) -> SanitizeResult:
        """
        Sanitize *text* and return a :class:`SanitizeResult`.

        A fresh :class:`Vault` is created for each standalone ``sanitize()``
        call.  For multi-turn sessions (anonymize → LLM → deanonymize) use
        :meth:`session` instead.
        """
        vault = Vault()
        return self._run(text, vault, session_id=session_id)

    def sanitize_batch(
        self, texts: list[str], session_id: str | None = None
    ) -> list[SanitizeResult]:
        """Sanitize a list of texts.  Each text gets its own vault."""
        return [self.sanitize(t, session_id=session_id) for t in texts]

    def session(self, session_id: str | None = None) -> "Session":
        """
        Create a :class:`Session` for multi-turn anonymize/deanonymize workflows.

        The session maintains a shared vault so that the same PII value is
        always replaced with the same token, and LLM responses can be
        deanonymized back to the originals.
        """
        from .session import Session
        return Session(self, session_id=session_id)

    def add_entity(
        self,
        name: str,
        pattern: str | None = None,
        confidence: float = 0.85,
    ) -> None:
        """
        Register a custom entity type with a regex pattern.

        Parameters
        ----------
        name:
            A string name for the entity (used as the EntityType label).
        pattern:
            A regex pattern string.
        confidence:
            Detection confidence score (0–1).
        """
        self._regex.add_pattern(
            EntityType.CUSTOM,
            pattern or r".+",
            confidence=confidence,
        )

    def guard(
        self,
        on_detect: str = "redact",
    ) -> Callable:
        """
        Decorator factory that sanitizes the first string argument of the
        wrapped function before it is called.

        Usage::

            @sanitizer.guard(on_detect="redact")
            def call_llm(prompt: str) -> str: ...

            @sanitizer.guard(on_detect="block")
            async def chat(message: str) -> str: ...
        """
        import functools
        import inspect

        def decorator(fn: Callable) -> Callable:
            if inspect.iscoroutinefunction(fn):
                @functools.wraps(fn)
                async def async_wrapper(*args, **kwargs):  # type: ignore[return]
                    args, kwargs = _apply_guard(self, on_detect, args, kwargs)
                    return await fn(*args, **kwargs)
                return async_wrapper
            else:
                @functools.wraps(fn)
                def sync_wrapper(*args, **kwargs):  # type: ignore[return]
                    args, kwargs = _apply_guard(self, on_detect, args, kwargs)
                    return fn(*args, **kwargs)
                return sync_wrapper

        return decorator

    # ── Internal ─────────────────────────────────────────────────────────────

    def _run(
        self,
        text: str,
        vault: Vault,
        session_id: str | None = None,
    ) -> SanitizeResult:
        """Core sanitization pipeline."""
        # 1. Collect entities from all active layers
        raw_entities: list[DetectedEntity] = []
        raw_entities.extend(self._regex.detect(text))
        raw_entities.extend(self._secrets.detect(text))
        if self._ner is not None:
            raw_entities.extend(self._ner.detect(text))

        # 2. Filter to allowed entity types
        if self._allowed_entities:
            raw_entities = [
                e for e in raw_entities if e.entity_type in self._allowed_entities
            ]

        # 3. Deduplicate overlapping spans
        entities = _deduplicate(raw_entities)

        # 4. Handle on_detect modes
        if self.on_detect == "block" and entities:
            raise PIIDetectedError(entities)

        if self.on_detect == "warn":
            score = max((e.confidence for e in entities), default=0.0)
            return SanitizeResult(
                text=text,
                original=text,
                entities=entities,
                tokens={},
                score=score,
            )

        # on_detect == "redact" (default)
        # 5. Assign replacements (from vault or synthetic engine)
        for entity in entities:
            existing = vault.get_replacement(entity.original)
            if existing:
                entity.replacement = existing
            else:
                fake = self._synthetic.generate(entity.entity_type, entity.original)
                entity.replacement = vault.add(entity.original, fake)

        # 6. Reconstruct text right-to-left to preserve offsets
        result_chars = list(text)
        for entity in reversed(entities):
            result_chars[entity.start : entity.end] = list(entity.replacement or "")
        sanitized_text = "".join(result_chars)

        # 7. Build tokens dict
        tokens = {e.original: e.replacement or "" for e in entities}

        # 8. Record audit events
        if self._audit is not None:
            for entity in entities:
                self._audit.record(
                    AuditEvent(
                        timestamp=_now_iso(),
                        entity_type=entity.entity_type.value,
                        confidence=entity.confidence,
                        layer=entity.layer,
                        redaction_method="synthetic" if entity.replacement and
                            not entity.replacement.startswith("[") else "placeholder",
                        text_hash=_hash_value(entity.original),
                        session_id=session_id,
                    )
                )

        score = max((e.confidence for e in entities), default=0.0)
        return SanitizeResult(
            text=sanitized_text,
            original=text,
            entities=entities,
            tokens=tokens,
            score=score,
        )


# ---------------------------------------------------------------------------
# Guard helper
# ---------------------------------------------------------------------------

def _apply_guard(
    sanitizer: Sanitizer,
    on_detect: str,
    args: tuple,
    kwargs: dict,
) -> tuple[tuple, dict]:
    """Find the first string arg, sanitize it, substitute back."""
    args = list(args)  # type: ignore[assignment]
    for i, arg in enumerate(args):  # type: ignore[arg-type]
        if isinstance(arg, str):
            result = sanitizer._run(arg, Vault())
            if on_detect == "block" and result.has_pii:
                raise PIIDetectedError(result.entities)
            args[i] = result.text  # type: ignore[index]
            break
    return tuple(args), kwargs  # type: ignore[return-value]
