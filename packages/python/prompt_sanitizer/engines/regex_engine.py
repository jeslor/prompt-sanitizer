"""
Regex Engine — Layer 1 of prompt-sanitizer.

Detects structured PII (email, phone, SSN, credit cards, IBANs, IPs,
crypto addresses, MAC addresses, URLs, passport numbers, driving licences,
and date-of-birth patterns) using regular expressions with optional
checksum validation (Luhn for credit cards, IBAN mod-97).

All patterns run on every sanitize() call regardless of Mode.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..entities import EntityType
from ..result import DetectedEntity


# ---------------------------------------------------------------------------
# Luhn algorithm — credit card validation
# ---------------------------------------------------------------------------

def _luhn_valid(card: str) -> bool:
    digits = [int(d) for d in card if d.isdigit()]
    if len(digits) < 13:
        return False
    odd = digits[-1::-2]
    even = digits[-2::-2]
    total = sum(odd) + sum(sum(divmod(d * 2, 10)) for d in even)
    return total % 10 == 0


# ---------------------------------------------------------------------------
# IBAN mod-97 validation
# ---------------------------------------------------------------------------

def _iban_valid(iban: str) -> bool:
    raw = iban.replace(" ", "").replace("-", "").upper()
    if len(raw) < 15 or len(raw) > 34:
        return False
    rearranged = raw[4:] + raw[:4]
    numeric = "".join(str(ord(c) - 55) if c.isalpha() else c for c in rearranged)
    try:
        return int(numeric) % 97 == 1
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Pattern registry
# ---------------------------------------------------------------------------

@dataclass
class _Pattern:
    entity_type: EntityType
    regex: re.Pattern[str]
    confidence: float
    validator: object = None  # optional callable(match_str) -> bool


# fmt: off
_PATTERNS: list[_Pattern] = [
    # ── Email ────────────────────────────────────────────────────────────────
    _Pattern(
        EntityType.EMAIL,
        re.compile(
            r"(?<![a-zA-Z0-9._%+\-])"
            r"[a-zA-Z0-9._%+\-]{1,64}"
            r"@"
            r"[a-zA-Z0-9.\-]{1,253}"
            r"\.[a-zA-Z]{2,}"
            r"(?![a-zA-Z0-9._%+\-@])",
            re.IGNORECASE,
        ),
        confidence=0.99,
    ),

    # ── US phone (many formats) ──────────────────────────────────────────────
    _Pattern(
        EntityType.PHONE,
        re.compile(
            r"(?<!\d)"
            r"(?:\+?1[\s.\-]?)?"
            r"(?:\([2-9]\d{2}\)|[2-9]\d{2})"
            r"[\s.\-]?"
            r"\d{3}"
            r"[\s.\-]?"
            r"\d{4}"
            r"(?!\d)",
        ),
        confidence=0.85,
    ),

    # ── International phone — compact E.164 e.g. +447946123456 ───────────────
    _Pattern(
        EntityType.PHONE,
        re.compile(r"(?<!\d)\+[1-9]\d{6,14}(?!\d)"),
        confidence=0.80,
    ),

    # ── International phone — spaced/dashed e.g. +44 20 7946 0958 ────────────
    _Pattern(
        EntityType.PHONE,
        re.compile(
            r"(?<!\d)"
            r"\+[1-9]\d{0,3}"           # country code
            r"(?:[\s.\-]\d{2,4}){2,4}"  # 2–4 groups of digits separated by space/dash/dot
            r"(?!\d)",
        ),
        confidence=0.78,
    ),

    # ── US SSN ───────────────────────────────────────────────────────────────
    _Pattern(
        EntityType.SSN,
        re.compile(
            r"(?<!\d)"
            r"(?!000|666|9\d{2})\d{3}"
            r"[\s\-]"
            r"(?!00)\d{2}"
            r"[\s\-]"
            r"(?!0000)\d{4}"
            r"(?!\d)",
        ),
        confidence=0.95,
    ),

    # ── Credit / debit card (Luhn-validated) ─────────────────────────────────
    _Pattern(
        EntityType.CREDIT_CARD,
        re.compile(
            r"(?<!\d)"
            r"(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|3(?:0[0-5]|[68][0-9])[0-9]|"
            r"6(?:011|5[0-9]{2})|(?:2131|1800|35\d{3}))"
            r"[\s\-]?"
            r"(?:\d{4}[\s\-]?){2}"
            r"\d{1,4}"
            r"(?!\d)",
        ),
        confidence=0.95,
        validator=lambda m: _luhn_valid(m),
    ),

    # ── IBAN (mod-97 validated) ───────────────────────────────────────────────
    _Pattern(
        EntityType.IBAN,
        re.compile(
            r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4}\b",
            re.IGNORECASE,
        ),
        confidence=0.92,
        validator=lambda m: _iban_valid(m),
    ),

    # ── IPv4 ─────────────────────────────────────────────────────────────────
    _Pattern(
        EntityType.IP_ADDRESS,
        re.compile(
            r"(?<!\d)"
            r"(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
            r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)"
            r"(?!\d)",
        ),
        confidence=0.90,
    ),

    # ── IPv6 (full and compressed forms) ─────────────────────────────────────
    _Pattern(
        EntityType.IP_ADDRESS,
        re.compile(
            r"(?<![:\w])"
            r"(?:"
            r"(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}"
            r"|(?:[0-9a-fA-F]{1,4}:){1,7}:"
            r"|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}"
            r"|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}"
            r"|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}"
            r"|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}"
            r"|[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,4}[0-9a-fA-F]{1,4}"
            r"|::ffff(?::0{1,4})?:(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
            r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)"
            r")"
            r"(?![:\w])",
            re.IGNORECASE,
        ),
        confidence=0.90,
    ),

    # ── MAC address ──────────────────────────────────────────────────────────
    _Pattern(
        EntityType.MAC_ADDRESS,
        re.compile(
            r"(?<![:\w])"
            r"(?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}"
            r"(?![:\w])",
            re.IGNORECASE,
        ),
        confidence=0.90,
    ),

    # ── URL (http/https) ─────────────────────────────────────────────────────
    _Pattern(
        EntityType.URL,
        re.compile(
            r"https?://"
            r"(?:[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]|(?:%[0-9a-fA-F]{2}))+",
            re.IGNORECASE,
        ),
        confidence=0.85,
    ),

    # ── Bitcoin address (P2PKH, P2SH, Bech32) ────────────────────────────────
    _Pattern(
        EntityType.CRYPTO_ADDRESS,
        re.compile(
            r"(?<![a-zA-Z0-9])"
            r"(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}"
            r"|bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87})"
            r"(?![a-zA-Z0-9])",
        ),
        confidence=0.88,
    ),

    # ── Ethereum address ─────────────────────────────────────────────────────
    _Pattern(
        EntityType.CRYPTO_ADDRESS,
        re.compile(r"(?<![a-fA-F0-9])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])"),
        confidence=0.92,
    ),

    # ── US Passport ──────────────────────────────────────────────────────────
    _Pattern(
        EntityType.PASSPORT,
        re.compile(r"(?<![A-Z0-9])[A-Z]{1,2}\d{7,9}(?![A-Z0-9])"),
        confidence=0.72,
    ),

    # ── UK Passport ──────────────────────────────────────────────────────────
    _Pattern(
        EntityType.PASSPORT,
        re.compile(r"(?<!\d)\d{9}(?!\d)"),
        confidence=0.60,  # low — 9-digit numbers are common
    ),

    # ── US ZIP code (with context boost — basic pattern only) ─────────────────
    _Pattern(
        EntityType.ZIP_CODE,
        re.compile(r"(?<!\d)\d{5}(?:-\d{4})?(?!\d)"),
        confidence=0.55,  # low standalone confidence
    ),

    # ── Date patterns (various formats) ──────────────────────────────────────
    _Pattern(
        EntityType.DATE,
        re.compile(
            r"(?<!\d)"
            r"(?:"
            r"\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}"    # DD/MM/YYYY, MM-DD-YY
            r"|\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}"      # YYYY-MM-DD (ISO)
            r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+"
            r"\d{1,2},?\s+\d{4}"                        # Month DD, YYYY
            r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
            r"\s+\d{4}"                                 # DD Month YYYY
            r")"
            r"(?!\d)",
            re.IGNORECASE,
        ),
        confidence=0.75,
    ),
]
# fmt: on


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class RegexEngine:
    """
    Runs all regex patterns against the input text and returns detected entities.

    Custom patterns can be added at runtime via ``add_pattern()``.
    """

    def __init__(self) -> None:
        self._patterns: list[_Pattern] = list(_PATTERNS)
        self._counters: dict[EntityType, int] = {}

    def add_pattern(
        self,
        entity_type: EntityType,
        pattern: str,
        confidence: float = 0.80,
        flags: int = re.IGNORECASE,
    ) -> None:
        """Register a custom regex pattern."""
        self._patterns.append(
            _Pattern(entity_type, re.compile(pattern, flags), confidence)
        )

    def detect(self, text: str) -> list[DetectedEntity]:
        """
        Run all patterns against *text* and return a list of DetectedEntity.

        Overlapping matches from different patterns are kept — deduplication
        happens in the Sanitizer which has the full multi-engine view.
        """
        entities: list[DetectedEntity] = []

        for pat in self._patterns:
            for m in pat.regex.finditer(text):
                matched = m.group(0)

                # Run optional validator (e.g. Luhn check)
                if pat.validator is not None and not pat.validator(matched):
                    continue

                entities.append(
                    DetectedEntity(
                        entity_type=pat.entity_type,
                        original=matched,
                        start=m.start(),
                        end=m.end(),
                        confidence=pat.confidence,
                        layer="regex",
                    )
                )

        return entities
