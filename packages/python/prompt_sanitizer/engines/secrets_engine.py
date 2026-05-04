"""
Secrets Engine — Layer 1 of prompt-sanitizer (secrets branch).

Detects credentials, API keys, tokens, and connection strings that should
never reach an LLM.  Runs alongside the regex engine on every call.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..entities import EntityType
from ..result import DetectedEntity


@dataclass
class _SecretPattern:
    entity_type: EntityType
    regex: re.Pattern[str]
    confidence: float
    label: str  # human-readable name for logging / audit


# fmt: off
_SECRET_PATTERNS: list[_SecretPattern] = [

    # ── JWT (header.payload.signature) ───────────────────────────────────────
    _SecretPattern(
        EntityType.JWT,
        re.compile(
            r"eyJ[a-zA-Z0-9_\-]{10,}"
            r"\."
            r"eyJ[a-zA-Z0-9_\-]{10,}"
            r"\."
            r"[a-zA-Z0-9_\-]{10,}",
        ),
        confidence=0.99,
        label="JWT",
    ),

    # ── Bearer token (Authorization header value) ────────────────────────────
    _SecretPattern(
        EntityType.BEARER_TOKEN,
        re.compile(
            r"(?i)(?:Authorization\s*:\s*)?Bearer\s+"
            r"([a-zA-Z0-9_\-\.]{20,})",
        ),
        confidence=0.92,
        label="Bearer token",
    ),

    # ── AWS Access Key ID ────────────────────────────────────────────────────
    _SecretPattern(
        EntityType.AWS_ACCESS_KEY,
        re.compile(
            r"(?<![A-Z0-9])"
            r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)"
            r"[A-Z0-9]{16}"
            r"(?![A-Z0-9])",
        ),
        confidence=0.99,
        label="AWS access key ID",
    ),

    # ── AWS Secret Access Key (context-anchored) ─────────────────────────────
    _SecretPattern(
        EntityType.AWS_SECRET_KEY,
        re.compile(
            r"(?i)(?:aws_secret(?:_access)?_key|secret_access_key)\s*[=:\"'\s]\s*"
            r"([a-zA-Z0-9+/]{40})",
        ),
        confidence=0.97,
        label="AWS secret access key",
    ),

    # ── OpenAI API key (legacy sk-xxx and new sk-proj-xxx) ───────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"sk-(?:proj-|org-)?[a-zA-Z0-9_\-T]{20,}"),
        confidence=0.97,
        label="OpenAI API key",
    ),

    # ── Anthropic API key ────────────────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"sk-ant-(?:api\d{2}-)?[a-zA-Z0-9_\-]{20,}"),
        confidence=0.99,
        label="Anthropic API key",
    ),

    # ── GitHub Personal Access Token (classic) ───────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"ghp_[a-zA-Z0-9]{36}"),
        confidence=0.99,
        label="GitHub PAT (classic)",
    ),

    # ── GitHub Fine-grained PAT ──────────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"github_pat_[a-zA-Z0-9_]{82}"),
        confidence=0.99,
        label="GitHub fine-grained PAT",
    ),

    # ── GitHub OAuth / server-to-server / refresh ────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"(?:gho|ghs|ghr)_[a-zA-Z0-9]{36}"),
        confidence=0.99,
        label="GitHub OAuth/server token",
    ),

    # ── Slack bot / user / app tokens ────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"xox[baprs]-(?:[0-9a-zA-Z]{4,}-)+[0-9a-zA-Z]{4,}"),
        confidence=0.98,
        label="Slack token",
    ),

    # ── Stripe secret / publishable key ─────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}"),
        confidence=0.99,
        label="Stripe API key",
    ),

    # ── Twilio Account SID / Auth Token ─────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"AC[a-f0-9]{32}"),
        confidence=0.90,
        label="Twilio Account SID",
    ),
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(
            r"(?i)(?:auth_token|TWILIO_AUTH_TOKEN)\s*[=:\"'\s]\s*([a-f0-9]{32})",
        ),
        confidence=0.97,
        label="Twilio Auth Token",
    ),

    # ── Google API / service account key ────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"AIza[0-9A-Za-z_\-]{35}"),
        confidence=0.99,
        label="Google API key",
    ),

    # ── SendGrid API key ─────────────────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}"),
        confidence=0.99,
        label="SendGrid API key",
    ),

    # ── Mailchimp API key ────────────────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"[a-f0-9]{32}-us\d{1,2}"),
        confidence=0.90,
        label="Mailchimp API key",
    ),

    # ── HuggingFace token ─────────────────────────────────────────────────────
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(r"hf_[a-zA-Z0-9]{34,}"),
        confidence=0.99,
        label="HuggingFace token",
    ),

    # ── PEM private key header (triggers on the header alone) ────────────────
    _SecretPattern(
        EntityType.PRIVATE_KEY,
        re.compile(
            r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----",
        ),
        confidence=0.99,
        label="PEM private key",
    ),

    # ── Database connection strings ──────────────────────────────────────────
    _SecretPattern(
        EntityType.DB_CONNECTION,
        re.compile(
            r"(?i)"
            r"(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|"
            r"mssql|sqlserver|oracle|clickhouse|cassandra|couchdb|neo4j)"
            r"://"
            r"[^\s'\"`<>\n]{8,}",  # at least 8 chars — avoids localhost:// false positives
        ),
        confidence=0.97,
        label="Database connection string",
    ),

    # ── Generic secret in .env / config style assignments ────────────────────
    # e.g.  SECRET_KEY="abc123..."  /  api_key = 'xyz...'
    _SecretPattern(
        EntityType.API_KEY,
        re.compile(
            r"(?i)(?:secret[_\-]?key|api[_\-]?key|access[_\-]?token|auth[_\-]?token|"
            r"private[_\-]?key|client[_\-]?secret)\s*[=:\"'\s]+\s*"
            r"([a-zA-Z0-9_\-\.+/]{16,})",
        ),
        confidence=0.80,
        label="Generic secret assignment",
    ),
]
# fmt: on


class SecretsEngine:
    """
    Detects credentials, tokens, and connection strings in text.

    Runs on every sanitize() call regardless of Mode.
    Results are merged with the RegexEngine output before deduplication.
    """

    def __init__(self) -> None:
        self._patterns: list[_SecretPattern] = list(_SECRET_PATTERNS)

    def add_pattern(
        self,
        entity_type: EntityType,
        pattern: str,
        label: str = "custom secret",
        confidence: float = 0.85,
        flags: int = 0,
    ) -> None:
        """Register a custom secrets pattern."""
        self._patterns.append(
            _SecretPattern(entity_type, re.compile(pattern, flags), confidence, label)
        )

    def detect(self, text: str) -> list[DetectedEntity]:
        """Scan *text* for secrets and return a list of DetectedEntity."""
        entities: list[DetectedEntity] = []

        for pat in self._patterns:
            for m in pat.regex.finditer(text):
                # If the pattern has a capturing group, use it; otherwise full match
                try:
                    matched = m.group(1)
                    start, end = m.start(1), m.end(1)
                except IndexError:
                    matched = m.group(0)
                    start, end = m.start(), m.end()

                entities.append(
                    DetectedEntity(
                        entity_type=pat.entity_type,
                        original=matched,
                        start=start,
                        end=end,
                        confidence=pat.confidence,
                        layer="secrets",
                    )
                )

        return entities
