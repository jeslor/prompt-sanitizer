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
