from enum import Enum


class EntityType(str, Enum):
    """All PII / sensitive entity types that prompt-sanitizer can detect."""

    # ── Personal identifiers ────────────────────────────────────────────────
    PERSON = "PERSON"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    DATE_OF_BIRTH = "DATE_OF_BIRTH"
    AGE = "AGE"

    # ── Location ────────────────────────────────────────────────────────────
    ADDRESS = "ADDRESS"
    ZIP_CODE = "ZIP_CODE"

    # ── Financial ───────────────────────────────────────────────────────────
    CREDIT_CARD = "CREDIT_CARD"
    IBAN = "IBAN"
    BANK_ACCOUNT = "BANK_ACCOUNT"
    CRYPTO_ADDRESS = "CRYPTO_ADDRESS"

    # ── Government IDs ──────────────────────────────────────────────────────
    SSN = "SSN"
    PASSPORT = "PASSPORT"
    DRIVING_LICENSE = "DRIVING_LICENSE"

    # ── Network / Digital ───────────────────────────────────────────────────
    IP_ADDRESS = "IP_ADDRESS"
    MAC_ADDRESS = "MAC_ADDRESS"
    URL = "URL"

    # ── Secrets & credentials ────────────────────────────────────────────────
    API_KEY = "API_KEY"
    JWT = "JWT"
    BEARER_TOKEN = "BEARER_TOKEN"
    AWS_ACCESS_KEY = "AWS_ACCESS_KEY"
    AWS_SECRET_KEY = "AWS_SECRET_KEY"
    PRIVATE_KEY = "PRIVATE_KEY"
    DB_CONNECTION = "DB_CONNECTION"

    # ── Temporal ────────────────────────────────────────────────────────────
    DATE = "DATE"

    # ── User-defined ────────────────────────────────────────────────────────
    CUSTOM = "CUSTOM"
