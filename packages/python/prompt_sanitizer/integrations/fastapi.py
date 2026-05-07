"""
FastAPI / Starlette middleware for prompt-sanitizer.

Automatically sanitizes all incoming request bodies (JSON ``messages`` arrays
or plain ``prompt`` strings) before they reach your route handlers.

Usage::

    from fastapi import FastAPI
    from prompt_sanitizer import Sanitizer
    from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

    app = FastAPI()
    app.add_middleware(SanitizerMiddleware, sanitizer=Sanitizer())

    @app.post("/chat")
    async def chat(body: dict):
        # body["messages"][0]["content"] is already sanitized here
        ...

Configuration options::

    app.add_middleware(
        SanitizerMiddleware,
        sanitizer=Sanitizer(),
        routes=["/chat", "/complete"],   # only sanitize these paths (default: all)
        restore_response=False,          # deanonymize response body (default: False)
    )

Requires::

    pip install ai-prompt-sanitizer[integrations]
    pip install fastapi   # or starlette
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Sequence

if TYPE_CHECKING:
    from ..sanitizer import Sanitizer


def _require_starlette() -> None:
    try:
        from starlette.middleware.base import BaseHTTPMiddleware  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "Starlette/FastAPI is not installed. Run: pip install fastapi"
        ) from exc


def _sanitize_body(body: dict, session: Any) -> dict:
    """Sanitize known LLM-style JSON body shapes in-place (returns new dict)."""
    import copy
    body = copy.deepcopy(body)

    # OpenAI-style: {"messages": [{"role": ..., "content": ...}]}
    if "messages" in body and isinstance(body["messages"], list):
        for msg in body["messages"]:
            if isinstance(msg.get("content"), str):
                msg["content"] = session.anonymize(msg["content"])

    # Simple prompt string: {"prompt": "..."}
    if "prompt" in body and isinstance(body["prompt"], str):
        body["prompt"] = session.anonymize(body["prompt"])

    # input / inputs (e.g. HuggingFace-style)
    for key in ("input", "inputs", "text", "query"):
        if key in body and isinstance(body[key], str):
            body[key] = session.anonymize(body[key])

    return body


# We need Any for type hints below since starlette may not be installed
from typing import Any


class SanitizerMiddleware:
    """
    ASGI middleware that sanitizes request bodies containing PII.

    Works with FastAPI, Starlette, and any ASGI-compatible framework.

    Parameters
    ----------
    app:
        The ASGI application to wrap.
    sanitizer:
        A :class:`~prompt_sanitizer.Sanitizer` instance.
    routes:
        Optional list of path prefixes to sanitize. If ``None`` (default),
        all ``POST`` / ``PUT`` / ``PATCH`` requests with JSON bodies are processed.
    restore_response:
        If ``True``, deanonymize the response body using the same session.
        Useful when the LLM echoes back the tokens and you want the client to
        see real values. Default: ``False``.
    """

    def __init__(
        self,
        app: Any,
        sanitizer: "Sanitizer",
        routes: Sequence[str] | None = None,
        restore_response: bool = False,
    ) -> None:
        _require_starlette()
        self.app = app
        self._sanitizer = sanitizer
        self._routes = list(routes) if routes else None
        self._restore = restore_response

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")

        should_process = (
            method in ("POST", "PUT", "PATCH")
            and (
                self._routes is None
                or any(path.startswith(r) for r in self._routes)
            )
        )

        if not should_process:
            await self.app(scope, receive, send)
            return

        # Buffer request body
        body_bytes = await _read_body(receive)

        try:
            body_json = json.loads(body_bytes)
        except (json.JSONDecodeError, ValueError):
            # Not JSON — pass through unchanged
            await self.app(scope, _replay_body(receive, body_bytes), send)
            return

        session = self._sanitizer.session()
        sanitized_body = _sanitize_body(body_json, session)
        sanitized_bytes = json.dumps(sanitized_body).encode()

        if self._restore:
            send = _deanonymize_send(send, session)

        await self.app(scope, _replay_body(receive, sanitized_bytes), send)


async def _read_body(receive: Any) -> bytes:
    body = b""
    more = True
    while more:
        message = await receive()
        body += message.get("body", b"")
        more = message.get("more_body", False)
    return body


def _replay_body(receive: Any, body: bytes) -> Any:
    """Return a new receive callable that replays the given body bytes."""
    sent = False

    async def _receive() -> dict:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return _receive


def _deanonymize_send(send: Any, session: Any) -> Any:
    """Wrap the send callable to deanonymize JSON response bodies."""

    response_body = b""

    async def _send(message: dict) -> None:
        nonlocal response_body
        if message["type"] == "http.response.body":
            response_body += message.get("body", b"")
            if not message.get("more_body", False):
                try:
                    obj = json.loads(response_body)
                    restored = _restore_response_obj(obj, session)
                    message = {
                        **message,
                        "body": json.dumps(restored).encode(),
                    }
                except (json.JSONDecodeError, ValueError):
                    pass
        await send(message)

    return _send


def _restore_response_obj(obj: Any, session: Any) -> Any:
    if isinstance(obj, str):
        return session.deanonymize(obj)
    if isinstance(obj, dict):
        return {k: _restore_response_obj(v, session) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_restore_response_obj(item, session) for item in obj]
    return obj
