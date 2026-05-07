from enum import Enum


class Mode(str, Enum):
    """Detection mode controlling the engine layers that run."""

    FAST = "fast"
    """Regex + secrets only. Sub-millisecond. Zero ML dependencies.
    Catches: email, phone, SSN, credit card, IBAN, IP, crypto, MAC,
    API keys, JWTs, AWS keys, DB connection strings, private keys."""

    SMART = "smart"
    """Regex + secrets + NER (Piiranha mDeBERTa-v3). ~50-200ms on CPU.
    Additionally catches: names, organisations, context-dependent PII.
    Requires: pip install ai-prompt-sanitizer[nlp]"""

    FULL = "full"
    """Everything in SMART plus synthetic replacements and audit logging."""
