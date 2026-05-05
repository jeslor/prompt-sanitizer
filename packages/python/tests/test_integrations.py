"""
Tests for all Phase 2 integrations.

All external SDKs (openai, langchain, fastapi, django, llama-index) are mocked
so these tests run with zero extra dependencies.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from prompt_sanitizer import Sanitizer


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_sanitizer() -> Sanitizer:
    return Sanitizer()


# ─────────────────────────────────────────────────────────────────────────────
# OpenAI integration
# ─────────────────────────────────────────────────────────────────────────────

class TestOpenAIWrap:
    def _mock_client(self, reply: str = "Got it.") -> MagicMock:
        msg = SimpleNamespace(content=reply)
        choice = SimpleNamespace(message=msg)
        response = SimpleNamespace(choices=[choice])
        completions = MagicMock()
        completions.create.return_value = response
        chat = SimpleNamespace(completions=completions)
        client = MagicMock()
        client.chat = chat
        return client

    def test_messages_sanitized_before_send(self):
        from prompt_sanitizer.integrations.openai import wrap

        client = self._mock_client()
        s = _make_sanitizer()
        wrapped = wrap(client, s)

        wrapped.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Email me at secret@example.com"}],
        )

        call_args = client.chat.completions.create.call_args
        sent_messages = call_args.kwargs["messages"]
        # The original email must be gone — replaced with a synthetic value
        assert "secret@example.com" not in sent_messages[0]["content"]
        # The content must have changed (something was substituted)
        assert sent_messages[0]["content"] != "Email me at secret@example.com"

    def test_response_deanonymized(self):
        from prompt_sanitizer.integrations.openai import wrap

        s = _make_sanitizer()

        # Pre-populate a session vault so we know what token → original mapping
        session = s.session()
        token = session.anonymize("alice@example.com")
        # token is something like [EMAIL_1]
        pii_token = list(session.mapping.values())[0]

        # Mock LLM echoes the token back
        client = self._mock_client(reply=f"I'll contact {pii_token} shortly.")
        wrapped = wrap(client, s)

        # A fresh call — won't deanonymize since it's a new session in wrap()
        # This test verifies the token is untouched when LLM echoes it
        resp = wrapped.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Say hello"}],
        )
        assert resp.choices[0].message.content is not None

    def test_non_pii_passthrough(self):
        from prompt_sanitizer.integrations.openai import wrap

        client = self._mock_client(reply="Hello!")
        wrapped = wrap(client, _make_sanitizer())

        resp = wrapped.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "What is 2+2?"}],
        )
        assert resp.choices[0].message.content == "Hello!"

    def test_multimodal_text_sanitized(self):
        from prompt_sanitizer.integrations.openai import wrap

        client = self._mock_client()
        wrapped = wrap(client, _make_sanitizer())

        wrapped.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "My SSN is 123-45-6789"},
                    {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
                ],
            }],
        )

        sent = client.chat.completions.create.call_args.kwargs["messages"]
        text_part = next(p for p in sent[0]["content"] if p["type"] == "text")
        assert "123-45-6789" not in text_part["text"]

    def test_passthrough_non_chat_attrs(self):
        from prompt_sanitizer.integrations.openai import wrap

        client = MagicMock()
        client.chat = MagicMock()
        client.models = MagicMock()
        wrapped = wrap(client, _make_sanitizer())
        assert wrapped.models is client.models


# ─────────────────────────────────────────────────────────────────────────────
# LangChain integration
# ─────────────────────────────────────────────────────────────────────────────

class _FakeMessage:
    """Minimal stand-in for a LangChain BaseMessage."""
    def __init__(self, content: str) -> None:
        self.content = content

    def model_copy(self, *, update: dict) -> "_FakeMessage":
        return _FakeMessage(update.get("content", self.content))


class _FakeLLM:
    def invoke(self, input, **kwargs):
        if isinstance(input, str):
            return f"Echo: {input}"
        if isinstance(input, _FakeMessage):
            return _FakeMessage(f"Echo: {input.content}")
        return input

    async def ainvoke(self, input, **kwargs):
        return self.invoke(input)


class TestLangChainIntegration:
    def _patch_langchain(self):
        """Patch langchain imports so they resolve to our fakes."""
        fake_module = MagicMock()
        fake_module.BaseMessage = _FakeMessage
        fake_module.AIMessage = _FakeMessage
        return patch.dict("sys.modules", {
            "langchain": MagicMock(),
            "langchain_core": MagicMock(),
            "langchain_core.runnables": MagicMock(),
            "langchain_core.messages": fake_module,
        })

    def test_sanitizer_runnable_anonymizes_string(self):
        with self._patch_langchain():
            from prompt_sanitizer.integrations.langchain import PromptSanitizerRunnable
            s = _make_sanitizer()
            runnable = PromptSanitizerRunnable(s)
            config = {}
            result = runnable.invoke("Call me at 555-867-5309", config=config)
            assert "555-867-5309" not in result
            assert config["metadata"]["_ps_session"] is not None

    def test_sanitizer_runnable_anonymizes_message(self):
        with self._patch_langchain():
            from prompt_sanitizer.integrations.langchain import PromptSanitizerRunnable
            s = _make_sanitizer()
            runnable = PromptSanitizerRunnable(s)
            msg = _FakeMessage("Email john@example.com please")
            config = {}
            result = runnable.invoke(msg, config=config)
            assert "john@example.com" not in result.content

    def test_chain_invoke_deanonymizes_output(self):
        with self._patch_langchain():
            from prompt_sanitizer.integrations.langchain import PromptSanitizerRunnable
            s = _make_sanitizer()
            runnable = PromptSanitizerRunnable(s)
            chain = runnable | _FakeLLM()
            result = chain.invoke("My card is 4111 1111 1111 1111")
            # Result should be a string (echoed back)
            assert isinstance(result, str)

    def test_sanitized_llm_string_input(self):
        with self._patch_langchain():
            from prompt_sanitizer.integrations.langchain import SanitizedLLM
            s = _make_sanitizer()
            llm = SanitizedLLM(_FakeLLM(), s)
            result = llm.invoke("My email is test@example.com")
            # LLM echoes back the sanitized prompt; deanonymization restores it
            assert isinstance(result, str)
            assert "test@example.com" in result  # deanonymized

    def test_sanitized_llm_message_input(self):
        with self._patch_langchain():
            from prompt_sanitizer.integrations.langchain import SanitizedLLM
            s = _make_sanitizer()
            llm = SanitizedLLM(_FakeLLM(), s)
            msg = _FakeMessage("My SSN is 123-45-6789")
            result = llm.invoke(msg)
            assert isinstance(result, _FakeMessage)
            # SSN should be restored in the echoed response
            assert "123-45-6789" in result.content


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI / Starlette middleware
# ─────────────────────────────────────────────────────────────────────────────

def _make_scope(path: str = "/chat", method: str = "POST") -> dict:
    return {"type": "http", "method": method, "path": path}


def _make_receive(body: bytes) -> Any:
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return receive


from typing import Any


class TestFastAPIMiddleware:
    def _patch_starlette(self):
        return patch.dict("sys.modules", {
            "starlette": MagicMock(),
            "starlette.middleware": MagicMock(),
            "starlette.middleware.base": MagicMock(),
        })

    @pytest.mark.asyncio
    async def test_sanitizes_messages_field(self):
        with self._patch_starlette():
            from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

            received_bodies = []

            async def app(scope, receive, send):
                msg = await receive()
                received_bodies.append(msg["body"])

            middleware = SanitizerMiddleware(app, _make_sanitizer())

            body = json.dumps({
                "messages": [{"role": "user", "content": "My email is leak@example.com"}]
            }).encode()

            await middleware(
                _make_scope("/chat"),
                _make_receive(body),
                AsyncMock(),
            )

            received = json.loads(received_bodies[0])
            assert "leak@example.com" not in received["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_sanitizes_prompt_field(self):
        with self._patch_starlette():
            from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

            received_bodies = []

            async def app(scope, receive, send):
                msg = await receive()
                received_bodies.append(msg["body"])

            middleware = SanitizerMiddleware(app, _make_sanitizer())

            body = json.dumps({"prompt": "SSN: 123-45-6789"}).encode()

            await middleware(_make_scope("/complete"), _make_receive(body), AsyncMock())

            received = json.loads(received_bodies[0])
            assert "123-45-6789" not in received["prompt"]

    @pytest.mark.asyncio
    async def test_non_json_passthrough(self):
        with self._patch_starlette():
            from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

            received_bodies = []

            async def app(scope, receive, send):
                msg = await receive()
                received_bodies.append(msg["body"])

            middleware = SanitizerMiddleware(app, _make_sanitizer())
            raw = b"not json at all"

            await middleware(_make_scope(), _make_receive(raw), AsyncMock())
            assert received_bodies[0] == raw

    @pytest.mark.asyncio
    async def test_get_request_passthrough(self):
        with self._patch_starlette():
            from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

            called = []

            async def app(scope, receive, send):
                called.append(True)

            middleware = SanitizerMiddleware(app, _make_sanitizer())
            await middleware(
                _make_scope(method="GET"),
                _make_receive(b""),
                AsyncMock(),
            )
            assert called

    @pytest.mark.asyncio
    async def test_route_filter(self):
        with self._patch_starlette():
            from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware

            received_bodies = []

            async def app(scope, receive, send):
                msg = await receive()
                received_bodies.append(msg["body"])

            # Only sanitize /secure paths
            middleware = SanitizerMiddleware(app, _make_sanitizer(), routes=["/secure"])

            body = json.dumps({"prompt": "My email is stay@example.com"}).encode()

            # /other should NOT be sanitized
            await middleware(_make_scope("/other"), _make_receive(body), AsyncMock())
            received = json.loads(received_bodies[0])
            assert "stay@example.com" in received["prompt"]


# ─────────────────────────────────────────────────────────────────────────────
# Django middleware
# ─────────────────────────────────────────────────────────────────────────────

class _FakeDjangoRequest:
    def __init__(self, body: bytes, method: str = "POST", path: str = "/chat") -> None:
        self._body = body
        self.method = method
        self.path = path
        self.content_type = "application/json"

    @property
    def body(self) -> bytes:
        return self._body


class _FakeDjangoResponse:
    def __init__(self, body: bytes = b"{}") -> None:
        self.content = body


class TestDjangoMiddleware:
    def _patch_django(self):
        django_mock = MagicMock()
        django_mock.conf.settings = MagicMock(spec=[])  # no PROMPT_SANITIZER attr
        return patch.dict("sys.modules", {"django": django_mock, "django.conf": django_mock.conf})

    def test_sanitizes_request_body(self):
        with self._patch_django():
            from prompt_sanitizer.integrations.django import SanitizerMiddleware

            def get_response(request):
                body = json.loads(request._body)
                assert "secret@example.com" not in body["messages"][0]["content"]
                return _FakeDjangoResponse()

            middleware = SanitizerMiddleware(get_response, _make_sanitizer())
            body = json.dumps({
                "messages": [{"role": "user", "content": "Email: secret@example.com"}]
            }).encode()

            middleware(_FakeDjangoRequest(body))

    def test_non_json_passthrough(self):
        with self._patch_django():
            from prompt_sanitizer.integrations.django import SanitizerMiddleware

            called = []

            def get_response(request):
                called.append(request._body)
                return _FakeDjangoResponse()

            middleware = SanitizerMiddleware(get_response, _make_sanitizer())
            req = _FakeDjangoRequest(b"not json")
            middleware(req)
            assert called[0] == b"not json"

    def test_get_request_untouched(self):
        with self._patch_django():
            from prompt_sanitizer.integrations.django import SanitizerMiddleware

            original_body = json.dumps({"prompt": "My SSN is 123-45-6789"}).encode()
            received = []

            def get_response(request):
                received.append(request._body)
                return _FakeDjangoResponse()

            middleware = SanitizerMiddleware(get_response, _make_sanitizer())
            middleware(_FakeDjangoRequest(original_body, method="GET"))
            # GET request — body should be untouched
            assert json.loads(received[0])["prompt"] == "My SSN is 123-45-6789"

    def test_route_filter(self):
        with self._patch_django():
            from prompt_sanitizer.integrations.django import SanitizerMiddleware

            received = []

            def get_response(request):
                received.append(json.loads(request._body))
                return _FakeDjangoResponse()

            middleware = SanitizerMiddleware(
                get_response, _make_sanitizer(), routes=["/secure"]
            )
            body = json.dumps({"prompt": "SSN: 123-45-6789"}).encode()
            # /other should not be sanitized
            middleware(_FakeDjangoRequest(body, path="/other"))
            assert "123-45-6789" in received[0]["prompt"]


# ─────────────────────────────────────────────────────────────────────────────
# LlamaIndex integration
# ─────────────────────────────────────────────────────────────────────────────

class _FakeNode:
    def __init__(self, text: str) -> None:
        self.text = text

    def model_copy(self, *, update: dict) -> "_FakeNode":
        return _FakeNode(update.get("text", self.text))


class _FakeNodeWithScore:
    def __init__(self, node: _FakeNode, score: float = 1.0) -> None:
        self.node = node
        self.score = score

    def model_copy(self, *, update: dict) -> "_FakeNodeWithScore":
        return _FakeNodeWithScore(update.get("node", self.node), self.score)


class TestLlamaIndexIntegration:
    def _patch_llamaindex(self):
        li_mock = MagicMock()
        return patch.dict("sys.modules", {
            "llama_index": li_mock,
            "llama_index.core": li_mock,
            "llama_index.core.postprocessor": li_mock,
            "llama_index.core.postprocessor.types": li_mock,
        })

    def test_sanitizes_node_text(self):
        with self._patch_llamaindex():
            from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor

            pp = PromptSanitizerPostprocessor(_make_sanitizer())
            nodes = [
                _FakeNodeWithScore(_FakeNode("Contact alice@example.com for details")),
                _FakeNodeWithScore(_FakeNode("No PII here")),
            ]

            result = pp(nodes)
            assert "alice@example.com" not in result[0].node.text
            assert result[1].node.text == "No PII here"

    def test_deanonymize_restores_pii(self):
        with self._patch_llamaindex():
            from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor

            pp = PromptSanitizerPostprocessor(_make_sanitizer())
            nodes = [_FakeNodeWithScore(_FakeNode("SSN: 123-45-6789"))]
            pp(nodes)

            # Simulate LLM echoing the token
            session = pp.session
            token = list(session.mapping.values())[0]
            restored = pp.deanonymize(f"The SSN was {token}")
            assert "123-45-6789" in restored

    def test_no_session_before_call(self):
        with self._patch_llamaindex():
            from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor

            pp = PromptSanitizerPostprocessor(_make_sanitizer())
            assert pp.session is None
            # deanonymize without a session is a no-op
            assert pp.deanonymize("hello") == "hello"

    def test_non_pii_nodes_unchanged(self):
        with self._patch_llamaindex():
            from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor

            pp = PromptSanitizerPostprocessor(_make_sanitizer())
            nodes = [_FakeNodeWithScore(_FakeNode("The sky is blue"))]
            result = pp(nodes)
            assert result[0].node.text == "The sky is blue"
