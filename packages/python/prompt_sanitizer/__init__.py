"""
prompt_sanitizer — Lightweight, tiered, bidirectional PII sanitizer for LLM pipelines.

Quick start::

    from prompt_sanitizer import Sanitizer, Mode

    s = Sanitizer()                        # fast mode, zero ML deps
    result = s.sanitize("Email john@example.com or call 555-867-5309")
    print(result.text)    # redacted
    print(result.tokens)  # {"john@example.com": "...", "555-867-5309": "..."}

Bidirectional (LLM workflow)::

    session = s.session()
    clean   = session.anonymize(user_prompt)
    reply   = call_llm(clean)
    final   = session.deanonymize(reply)

Decorator guard::

    @s.guard(on_detect="redact")
    def call_openai(prompt: str) -> str: ...
"""

from .audit import AuditEvent, BaseAuditLog, MemoryAuditLog, SQLiteAuditLog
from .entities import EntityType
from .exceptions import MissingDependencyError, PIIDetectedError
from .modes import Mode
from .result import DetectedEntity, SanitizeResult
from .sanitizer import Sanitizer
from .session import Session
from .vault import Vault

__version__ = "0.1.0"
__all__ = [
    "Sanitizer",
    "Session",
    "Mode",
    "EntityType",
    "SanitizeResult",
    "DetectedEntity",
    "Vault",
    "PIIDetectedError",
    "MissingDependencyError",
    "BaseAuditLog",
    "MemoryAuditLog",
    "SQLiteAuditLog",
    "AuditEvent",
    # integrations (imported lazily — only available when extras installed)
    "openai_wrapper",
    "langchain_integration",
    "fastapi_middleware",
    "django_middleware",
    "llamaindex_integration",
]

