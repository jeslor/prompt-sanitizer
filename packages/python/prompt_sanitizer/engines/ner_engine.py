"""
NER Engine — Layer 2 of prompt-sanitizer (optional, Mode.SMART / Mode.FULL).

Lazy-loads the Piiranha mDeBERTa-v3 model (iiiorg/piiranha-v1) from
HuggingFace on first use.  The model is cached at
~/.prompt-sanitizer/models/ and never re-downloaded.

Requires: pip install ai-prompt-sanitizer[nlp]
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..entities import EntityType
from ..exceptions import MissingDependencyError
from ..result import DetectedEntity

if TYPE_CHECKING:
    pass

# ---------------------------------------------------------------------------
# HuggingFace model ID and local cache location
# ---------------------------------------------------------------------------

_MODEL_ID = "iiiorg/piiranha-v1-detect-personal-information"
_CACHE_DIR = Path.home() / ".prompt-sanitizer" / "models"

# ---------------------------------------------------------------------------
# Map Piiranha label names → our EntityType
# ---------------------------------------------------------------------------

_LABEL_MAP: dict[str, EntityType] = {
    "I-GIVENNAME": EntityType.PERSON,
    "B-GIVENNAME": EntityType.PERSON,
    "I-SURNAME": EntityType.PERSON,
    "B-SURNAME": EntityType.PERSON,
    "I-USERNAME": EntityType.PERSON,
    "B-USERNAME": EntityType.PERSON,
    "I-EMAIL": EntityType.EMAIL,
    "B-EMAIL": EntityType.EMAIL,
    "I-TELEPHONENUM": EntityType.PHONE,
    "B-TELEPHONENUM": EntityType.PHONE,
    "I-IDNUM": EntityType.SSN,
    "B-IDNUM": EntityType.SSN,
    "I-CREDITCARDNUMBER": EntityType.CREDIT_CARD,
    "B-CREDITCARDNUMBER": EntityType.CREDIT_CARD,
    "I-DRIVERLICENSENUM": EntityType.DRIVING_LICENSE,
    "B-DRIVERLICENSENUM": EntityType.DRIVING_LICENSE,
    "I-SOCIALNUM": EntityType.SSN,
    "B-SOCIALNUM": EntityType.SSN,
    "I-STREET": EntityType.ADDRESS,
    "B-STREET": EntityType.ADDRESS,
    "I-CITY": EntityType.ADDRESS,
    "B-CITY": EntityType.ADDRESS,
    "I-STATE": EntityType.ADDRESS,
    "B-STATE": EntityType.ADDRESS,
    "I-ZIPCODE": EntityType.ZIP_CODE,
    "B-ZIPCODE": EntityType.ZIP_CODE,
    "I-PASSWORD": EntityType.API_KEY,
    "B-PASSWORD": EntityType.API_KEY,
    "I-IP": EntityType.IP_ADDRESS,
    "B-IP": EntityType.IP_ADDRESS,
    "I-URL": EntityType.URL,
    "B-URL": EntityType.URL,
}


class NEREngine:
    """
    Wraps the Piiranha transformer model for context-aware PII detection.

    The model is loaded lazily — only when detect() is first called.
    """

    def __init__(self) -> None:
        self._pipeline: Any | None = None
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return

        try:
            from transformers import pipeline  # type: ignore[import]
        except ImportError:
            raise MissingDependencyError("transformers", "nlp")

        os.makedirs(_CACHE_DIR, exist_ok=True)

        self._pipeline = pipeline(
            task="token-classification",
            model=_MODEL_ID,
            aggregation_strategy="simple",
            cache_dir=str(_CACHE_DIR),
        )
        self._loaded = True

    def detect(self, text: str) -> list[DetectedEntity]:
        """
        Run the NER model on *text* and return a list of DetectedEntity.

        Falls back to an empty list (with a warning) if the model is not
        installed — the caller (Sanitizer) degrades to FAST mode silently.
        """
        try:
            self._ensure_loaded()
        except MissingDependencyError:
            import warnings
            warnings.warn(
                "prompt-sanitizer[nlp] not installed — NER layer skipped. "
                "Install with: pip install ai-prompt-sanitizer[nlp]",
                stacklevel=3,
            )
            return []

        assert self._pipeline is not None  # guaranteed after _ensure_loaded
        raw: list[dict[str, Any]] = self._pipeline(text)  # type: ignore[operator]

        entities: list[DetectedEntity] = []
        for item in raw:
            label: str = item.get("entity_group", item.get("entity", ""))
            entity_type = _LABEL_MAP.get(label)
            if entity_type is None:
                continue

            word: str = item["word"]
            start: int = item["start"]
            end: int = item["end"]
            score: float = float(item["score"])

            # Recover exact original text using char offsets (handles sub-word tokens)
            original = text[start:end]

            entities.append(
                DetectedEntity(
                    entity_type=entity_type,
                    original=original,
                    start=start,
                    end=end,
                    confidence=round(score, 4),
                    layer="ner",
                )
            )

        return entities
