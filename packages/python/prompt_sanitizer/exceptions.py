from __future__ import annotations

from .entities import EntityType
from .result import DetectedEntity


class PIIDetectedError(Exception):
    """Raised when PII is detected and the sanitizer is configured with on_detect='block'."""

    def __init__(self, entities: list[DetectedEntity]) -> None:
        self.entities = entities
        types = sorted({e.entity_type.value for e in entities})
        count = len(entities)
        super().__init__(
            f"PII detected (block mode): {count} instance(s) of [{', '.join(types)}]"
        )


class MissingDependencyError(ImportError):
    """Raised when an optional dependency required for the chosen Mode is not installed."""

    def __init__(self, package: str, extra: str) -> None:
        super().__init__(
            f"Package '{package}' is required but not installed. "
            f"Install it with: pip install ai-prompt-sanitizer[{extra}]"
        )


class VaultCollisionError(Exception):
    """
    Raised when a replacement token already maps to a *different* original
    value inside a :class:`Vault`.

    This should only happen if a vault was hydrated from a persisted
    snapshot without correctly restoring/reconciling its counters. It is
    a loud failure by design: silently overwriting the mapping would make
    an old placeholder deanonymize to the wrong value.
    """

    def __init__(self, replacement: str, existing_original: str, incoming_original: str) -> None:
        self.replacement = replacement
        self.existing_original = existing_original
        self.incoming_original = incoming_original
        super().__init__(
            f"Replacement token '{replacement}' is already mapped to a different "
            f"original value. This usually means a Vault's counters were not "
            f"restored correctly from a persisted snapshot."
        )


class VaultStoreError(Exception):
    """Raised when a VaultStore load/save/delete fails, or a snapshot's version is unsupported."""
