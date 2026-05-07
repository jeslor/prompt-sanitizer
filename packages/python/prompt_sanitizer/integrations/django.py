"""
Django middleware for prompt-sanitizer.

Sanitizes incoming request bodies (JSON ``messages`` / ``prompt`` fields) on
POST/PUT/PATCH requests before they reach Django views.

Usage — add to ``settings.py``::

    MIDDLEWARE = [
        ...
        "prompt_sanitizer.integrations.django.SanitizerMiddleware",
    ]

    # Optional configuration (defaults shown):
    PROMPT_SANITIZER = {
        "sanitizer": None,          # use a Sanitizer() instance or None for default
        "routes": None,             # list of path prefixes or None for all
        "restore_response": False,  # deanonymize JSON response bodies
    }

Or configure the middleware explicitly in ``urls.py``::

    from prompt_sanitizer import Sanitizer
    from prompt_sanitizer.integrations.django import SanitizerMiddleware

    sanitizer_instance = Sanitizer()

    # In MIDDLEWARE use a factory:
    class MyMiddleware(SanitizerMiddleware):
        _sanitizer_instance = sanitizer_instance

Requires::

    pip install ai-prompt-sanitizer[integrations]
    pip install django
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Sequence

if TYPE_CHECKING:
    from ..sanitizer import Sanitizer


def _require_django() -> None:
    try:
        import django  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "Django is not installed. Run: pip install django"
        ) from exc


def _get_default_sanitizer() -> "Sanitizer":
    """Return the sanitizer configured in Django settings, or a default one."""
    try:
        from django.conf import settings
        cfg = getattr(settings, "PROMPT_SANITIZER", {})
        if cfg.get("sanitizer"):
            return cfg["sanitizer"]
    except Exception:
        pass
    from prompt_sanitizer import Sanitizer
    return Sanitizer()


def _sanitize_body(body: dict, session: Any) -> dict:
    import copy
    body = copy.deepcopy(body)

    if "messages" in body and isinstance(body["messages"], list):
        for msg in body["messages"]:
            if isinstance(msg.get("content"), str):
                msg["content"] = session.anonymize(msg["content"])

    for key in ("prompt", "input", "inputs", "text", "query"):
        if key in body and isinstance(body[key], str):
            body[key] = session.anonymize(body[key])

    return body


class SanitizerMiddleware:
    """
    Django WSGI middleware for automatic PII sanitization.

    Parameters
    ----------
    get_response:
        The next middleware or view callable (injected by Django).
    sanitizer:
        Optional :class:`~prompt_sanitizer.Sanitizer`. Defaults to the instance
        in ``settings.PROMPT_SANITIZER["sanitizer"]`` or a fresh ``Sanitizer()``.
    routes:
        Optional list of path prefixes to process. ``None`` means all routes.
    restore_response:
        If ``True``, deanonymize JSON response bodies. Default: ``False``.
    """

    def __init__(
        self,
        get_response: Any,
        sanitizer: "Sanitizer | None" = None,
        routes: Sequence[str] | None = None,
        restore_response: bool = False,
    ) -> None:
        _require_django()
        self.get_response = get_response
        self._sanitizer = sanitizer or _get_default_sanitizer()
        self._routes = list(routes) if routes else None
        self._restore = restore_response

        # Read from Django settings if available
        try:
            from django.conf import settings
            cfg = getattr(settings, "PROMPT_SANITIZER", {})
            if self._routes is None and cfg.get("routes"):
                self._routes = cfg["routes"]
            if not self._restore and cfg.get("restore_response"):
                self._restore = cfg["restore_response"]
        except Exception:
            pass

    def __call__(self, request: Any) -> Any:
        method = request.method or ""
        path = request.path or ""

        should_process = (
            method in ("POST", "PUT", "PATCH")
            and (
                self._routes is None
                or any(path.startswith(r) for r in self._routes)
            )
            and request.content_type
            and "application/json" in request.content_type
        )

        session = None

        if should_process:
            try:
                body_json = json.loads(request.body)
                session = self._sanitizer.session()
                sanitized = _sanitize_body(body_json, session)
                # Patch request._body so views see the sanitized payload
                request._body = json.dumps(sanitized).encode()
                # Also patch POST-parsed data if present
                request._stream_read = True
            except (json.JSONDecodeError, ValueError):
                pass

        response = self.get_response(request)

        if session and self._restore:
            try:
                obj = json.loads(response.content)
                restored = _restore_response_obj(obj, session)
                response.content = json.dumps(restored).encode()
            except (json.JSONDecodeError, ValueError, AttributeError):
                pass

        return response


def _restore_response_obj(obj: Any, session: Any) -> Any:
    if isinstance(obj, str):
        return session.deanonymize(obj)
    if isinstance(obj, dict):
        return {k: _restore_response_obj(v, session) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_restore_response_obj(item, session) for item in obj]
    return obj
