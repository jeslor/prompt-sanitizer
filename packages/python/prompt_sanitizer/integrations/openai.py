"""
OpenAI SDK integration for prompt-sanitizer.

Transparently wraps any ``openai.OpenAI`` or ``openai.AsyncOpenAI`` client so
that every ``chat.completions.create`` call automatically:

1. Anonymizes all ``content`` fields in ``messages`` before sending to OpenAI.
2. Deanonymizes the response ``content`` before returning it to the caller.

The caller sees real PII in the response; OpenAI never does.

Usage::

    import openai
    from prompt_sanitizer import Sanitizer
    from prompt_sanitizer.integrations.openai import wrap

    client = wrap(openai.OpenAI(), Sanitizer())

    # Works exactly like the normal openai client:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "My email is john@example.com"}],
    )
    print(response.choices[0].message.content)  # real email restored in reply

Async usage::

    client = wrap(openai.AsyncOpenAI(), Sanitizer())
    response = await client.chat.completions.create(...)

Requires::

    pip install ai-prompt-sanitizer[integrations]
    pip install openai
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..sanitizer import Sanitizer


def _sanitize_messages(messages: list[dict], session: Any) -> list[dict]:
    """Return a copy of messages with all content fields anonymized."""
    sanitized = []
    for msg in messages:
        m = dict(msg)
        if isinstance(m.get("content"), str):
            m["content"] = session.anonymize(m["content"])
        elif isinstance(m.get("content"), list):
            # Multi-modal messages: handle text parts only
            parts = []
            for part in m["content"]:
                p = dict(part)
                if p.get("type") == "text" and isinstance(p.get("text"), str):
                    p["text"] = session.anonymize(p["text"])
                parts.append(p)
            m["content"] = parts
        sanitized.append(m)
    return sanitized


def _deanonymize_response(response: Any, session: Any) -> Any:
    """Restore PII tokens in all message content fields of a response."""
    for choice in getattr(response, "choices", []):
        msg = getattr(choice, "message", None)
        if msg and isinstance(getattr(msg, "content", None), str):
            object.__setattr__(msg, "content", session.deanonymize(msg.content))
    return response


class _SanitizedCompletions:
    """Proxy for ``client.chat.completions`` that sanitizes in/out."""

    def __init__(self, completions: Any, sanitizer: "Sanitizer") -> None:
        self._completions = completions
        self._sanitizer = sanitizer

    def create(self, *, messages: list[dict], **kwargs: Any) -> Any:
        session = self._sanitizer.session()
        clean_messages = _sanitize_messages(messages, session)
        response = self._completions.create(messages=clean_messages, **kwargs)
        return _deanonymize_response(response, session)

    async def acreate(self, *, messages: list[dict], **kwargs: Any) -> Any:
        session = self._sanitizer.session()
        clean_messages = _sanitize_messages(messages, session)
        response = await self._completions.create(messages=clean_messages, **kwargs)
        return _deanonymize_response(response, session)


class _SanitizedChat:
    def __init__(self, chat: Any, sanitizer: "Sanitizer") -> None:
        self.completions = _SanitizedCompletions(chat.completions, sanitizer)


class _SanitizedClient:
    """
    Proxy wrapping an openai client with automatic PII sanitization.

    All other attributes (``models``, ``embeddings``, etc.) are passed through
    transparently to the underlying client.
    """

    def __init__(self, client: Any, sanitizer: "Sanitizer") -> None:
        self._client = client
        self.chat = _SanitizedChat(client.chat, sanitizer)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def wrap(client: Any, sanitizer: "Sanitizer") -> _SanitizedClient:
    """
    Wrap an ``openai.OpenAI`` or ``openai.AsyncOpenAI`` client.

    Parameters
    ----------
    client:
        An instantiated OpenAI client.
    sanitizer:
        A :class:`~prompt_sanitizer.Sanitizer` instance.

    Returns
    -------
    _SanitizedClient
        A drop-in replacement that sanitizes all ``chat.completions.create``
        calls transparently.
    """
    return _SanitizedClient(client, sanitizer)
