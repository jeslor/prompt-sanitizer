"""
Synthetic Replacement Engine.

Generates realistic fake values per EntityType using the Faker library.
If Faker is not installed, falls back to sequential placeholder tokens
like ``[EMAIL_1]``, ``[PERSON_2]``, etc.

The vault ensures that within a session the same original always maps
to the same fake value (determinism).
"""
from __future__ import annotations

from collections import defaultdict

from .entities import EntityType

try:
    from faker import Faker as _Faker  # type: ignore[import]
    _HAS_FAKER = True
except ImportError:
    _HAS_FAKER = False


class SyntheticEngine:
    """
    Generates context-appropriate fake replacement values.

    Usage::

        engine = SyntheticEngine(locale="en_US")
        fake_email = engine.generate(EntityType.EMAIL, "john.doe@acme.com")
        # → "xavier.chen@mailnull.net"
    """

    def __init__(self, locale: str = "en_US") -> None:
        self._locale = locale
        self._fake = _Faker(locale) if _HAS_FAKER else None
        # Per-type counters for placeholder fallback
        self._counters: dict[EntityType, int] = defaultdict(int)

    # ── Public ───────────────────────────────────────────────────────────────

    def generate(self, entity_type: EntityType, original: str = "") -> str:
        """Return a fake value for *entity_type*."""
        if self._fake is not None:
            return self._faker_value(entity_type, original)
        return self._placeholder(entity_type)

    # ── Faker-backed generation ───────────────────────────────────────────────

    def _faker_value(self, entity_type: EntityType, original: str) -> str:
        f = self._fake
        assert f is not None

        match entity_type:
            case EntityType.PERSON:
                return f.name()
            case EntityType.EMAIL:
                return f.ascii_safe_email()
            case EntityType.PHONE:
                return f.phone_number()
            case EntityType.SSN:
                # Generate a structurally valid but fake SSN
                return f"{f.random_int(100, 899):03d}-{f.random_int(10, 99):02d}-{f.random_int(1000, 9999):04d}"
            case EntityType.CREDIT_CARD:
                return _fake_luhn_card(f)
            case EntityType.IBAN:
                return f"GB{f.random_int(10,99):02d}MOCK{f.random_int(10000000, 99999999):08d}{f.random_int(100000000000, 999999999999):012d}"
            case EntityType.IP_ADDRESS:
                return f"{f.random_int(1,254)}.{f.random_int(0,255)}.{f.random_int(0,255)}.{f.random_int(1,254)}"
            case EntityType.MAC_ADDRESS:
                return ":".join(f"{f.random_int(0,255):02x}" for _ in range(6))
            case EntityType.URL:
                return f"https://{f.domain_name()}/{f.uri_path()}"
            case EntityType.ADDRESS:
                return f.address().replace("\n", ", ")
            case EntityType.ZIP_CODE:
                return f.postcode()
            case EntityType.DATE:
                return f.date(pattern="%m/%d/%Y")
            case EntityType.DATE_OF_BIRTH:
                return f.date_of_birth(minimum_age=18, maximum_age=80).strftime("%m/%d/%Y")
            case EntityType.CRYPTO_ADDRESS:
                # Fake-looking ETH address (not valid on chain)
                return "0x" + "".join(f"{f.random_int(0,15):x}" for _ in range(40))
            case EntityType.PASSPORT:
                return f"{chr(f.random_int(65,90))}{f.random_int(10000000, 99999999)}"
            case EntityType.DRIVING_LICENSE:
                return f"{chr(f.random_int(65,90))}{f.random_int(100000, 999999)}"
            case EntityType.API_KEY:
                return "sk-" + "".join(
                    f.random_element("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
                    for _ in range(48)
                )
            case EntityType.JWT:
                return "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJSRURBQ1RFRCJ9.REDACTED_SIGNATURE"
            case EntityType.BEARER_TOKEN:
                return "REDACTED_" + "".join(
                    f.random_element("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(16)
                )
            case EntityType.AWS_ACCESS_KEY:
                return "AKIAIOSFODNN7EXAMPLE"
            case EntityType.AWS_SECRET_KEY:
                return "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
            case EntityType.PRIVATE_KEY:
                return "-----BEGIN PRIVATE KEY-----\nREDACTED\n-----END PRIVATE KEY-----"
            case EntityType.DB_CONNECTION:
                return f"postgresql://user:password@localhost:5432/{f.word()}"
            case _:
                return self._placeholder(entity_type)

    # ── Placeholder fallback (no Faker) ──────────────────────────────────────

    def _placeholder(self, entity_type: EntityType) -> str:
        self._counters[entity_type] += 1
        return f"[{entity_type.value}_{self._counters[entity_type]}]"


# ---------------------------------------------------------------------------
# Luhn-valid fake credit card generator
# ---------------------------------------------------------------------------

def _fake_luhn_card(f: object) -> str:  # type: ignore[type-arg]
    """Generate a 16-digit Luhn-valid fake card number (Visa prefix)."""
    import random
    prefix = [4]  # Visa
    digits = prefix + [random.randint(0, 9) for _ in range(14)]
    # Calculate check digit
    odd = digits[-1::-2]
    even = digits[-2::-2]
    total = sum(odd) + sum(sum(divmod(d * 2, 10)) for d in even)
    check = (10 - (total % 10)) % 10
    digits.append(check)
    raw = "".join(str(d) for d in digits)
    return f"{raw[:4]} {raw[4:8]} {raw[8:12]} {raw[12:]}"
