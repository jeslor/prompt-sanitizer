from __future__ import annotations

from dataclasses import dataclass, field

from .entities import EntityType


@dataclass
class DetectedEntity:
    """A single PII span detected in text."""

    entity_type: EntityType
    """The type of PII detected."""

    original: str
    """The exact original string that was matched."""

    start: int
    """Start character index in the original text (inclusive)."""

    end: int
    """End character index in the original text (exclusive)."""

    confidence: float
    """Detection confidence score between 0.0 and 1.0."""

    layer: str
    """Which engine detected this: 'regex', 'secrets', or 'ner'."""

    replacement: str | None = None
    """The replacement value assigned during sanitization."""

    @property
    def span_length(self) -> int:
        return self.end - self.start

    def overlaps(self, other: DetectedEntity) -> bool:
        return not (self.end <= other.start or self.start >= other.end)

    def __repr__(self) -> str:
        return (
            f"DetectedEntity(type={self.entity_type.value!r}, "
            f"text={self.original!r}, confidence={self.confidence:.2f})"
        )


@dataclass
class SanitizeResult:
    """Result of a sanitize() call."""

    text: str
    """The sanitized (redacted) text."""

    original: str
    """The original input text."""

    entities: list[DetectedEntity] = field(default_factory=list)
    """All detected PII entities, sorted by start position."""

    tokens: dict[str, str] = field(default_factory=dict)
    """Mapping of original value → replacement token for all detected entities."""

    score: float = 0.0
    """Overall confidence score (max confidence across all detected entities)."""

    @property
    def has_pii(self) -> bool:
        """True if any PII was detected."""
        return len(self.entities) > 0

    @property
    def entity_types(self) -> list[EntityType]:
        """List of unique entity types found."""
        return list({e.entity_type for e in self.entities})

    def __repr__(self) -> str:
        types = [e.entity_type.value for e in self.entities]
        return f"SanitizeResult(has_pii={self.has_pii}, types={types}, score={self.score:.2f})"
