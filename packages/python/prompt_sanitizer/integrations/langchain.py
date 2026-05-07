"""
LangChain integration for prompt-sanitizer.

Provides two components:

1. **PromptSanitizerRunnable** — a ``Runnable[str, str]`` that sanitizes text
   and passes through a downstream chain, then deanonymizes the output.
   Drop it at the start of any LCEL chain.

2. **SanitizedLLM** — wraps any LangChain ``BaseLLM`` / ``BaseChatModel`` and
   handles anonymize-before / deanonymize-after transparently.

Usage::

    from langchain_openai import ChatOpenAI
    from prompt_sanitizer import Sanitizer
    from prompt_sanitizer.integrations.langchain import PromptSanitizerRunnable

    sanitizer = Sanitizer()
    llm = ChatOpenAI(model="gpt-4o")

    # LCEL pipeline — sanitizer runs first, LLM runs second
    chain = PromptSanitizerRunnable(sanitizer) | llm

    response = chain.invoke("My SSN is 123-45-6789, help me understand my taxes")
    # LLM never sees the real SSN; response has it restored

Requires::

    pip install ai-prompt-sanitizer[integrations]
    pip install langchain
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator, Optional

if TYPE_CHECKING:
    from ..sanitizer import Sanitizer


def _require_langchain() -> None:
    try:
        import langchain  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "LangChain is not installed. Run: pip install langchain"
        ) from exc


class PromptSanitizerRunnable:
    """
    A LangChain ``Runnable`` that sanitizes the input string, invokes the next
    element in the chain, and deanonymizes the output.

    Parameters
    ----------
    sanitizer:
        A :class:`~prompt_sanitizer.Sanitizer` instance.

    Examples
    --------
    ::

        chain = PromptSanitizerRunnable(sanitizer) | llm
        result = chain.invoke("Call me at 555-867-5309")
    """

    def __init__(self, sanitizer: "Sanitizer") -> None:
        _require_langchain()
        from langchain_core.runnables import RunnableSerializable  # noqa: F401
        self._sanitizer = sanitizer

    # ── Runnable protocol ─────────────────────────────────────────────────────

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        from langchain_core.messages import BaseMessage

        session = self._sanitizer.session()

        if isinstance(input, str):
            clean = session.anonymize(input)
        elif isinstance(input, BaseMessage):
            clean = input.model_copy(update={"content": session.anonymize(input.content)})
        elif isinstance(input, list):
            clean = [
                (
                    m.model_copy(update={"content": session.anonymize(m.content)})
                    if isinstance(m, BaseMessage)
                    else m
                )
                for m in input
            ]
        else:
            clean = input

        # Store session on config so downstream can deanonymize
        if config is None:
            config = {}
        config.setdefault("metadata", {})["_ps_session"] = session
        return clean

    def __or__(self, other: Any) -> "_SanitizerChain":
        return _SanitizerChain(self, other)

    def __ror__(self, other: Any) -> "_SanitizerChain":
        return _SanitizerChain(other, self)


class _SanitizerChain:
    """Simple two-step chain: sanitizer | downstream."""

    def __init__(self, sanitizer_runnable: PromptSanitizerRunnable, downstream: Any) -> None:
        self._san = sanitizer_runnable
        self._down = downstream

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        config = config or {}
        clean = self._san.invoke(input, config=config, **kwargs)
        session = config.get("metadata", {}).get("_ps_session")

        result = self._down.invoke(clean, config=config, **kwargs)

        if session is None:
            return result

        # Deanonymize string or message output
        from langchain_core.messages import BaseMessage, AIMessage

        if isinstance(result, str):
            return session.deanonymize(result)
        if isinstance(result, BaseMessage):
            return result.model_copy(
                update={"content": session.deanonymize(result.content)}
            )
        if hasattr(result, "content") and isinstance(result.content, str):
            object.__setattr__(result, "content", session.deanonymize(result.content))
        return result

    async def ainvoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        config = config or {}
        clean = self._san.invoke(input, config=config, **kwargs)
        session = config.get("metadata", {}).get("_ps_session")

        result = await self._down.ainvoke(clean, config=config, **kwargs)

        if session is None:
            return result

        from langchain_core.messages import BaseMessage

        if isinstance(result, str):
            return session.deanonymize(result)
        if isinstance(result, BaseMessage):
            return result.model_copy(
                update={"content": session.deanonymize(result.content)}
            )
        return result

    def __or__(self, other: Any) -> "_SanitizerChain":
        # Chain further: wrap downstream into a new chain
        class _Extended(_SanitizerChain):
            def invoke(self_, input: Any, config: Any = None, **kwargs: Any) -> Any:
                mid = self.invoke(input, config=config, **kwargs)
                return other.invoke(mid, config=config, **kwargs)
        return _Extended(self._san, other)


class SanitizedLLM:
    """
    Wraps any LangChain ``BaseLLM`` or ``BaseChatModel``, sanitizing inputs and
    deanonymizing outputs.

    Parameters
    ----------
    llm:
        Any LangChain LLM or chat model.
    sanitizer:
        A :class:`~prompt_sanitizer.Sanitizer` instance.

    Examples
    --------
    ::

        from langchain_openai import ChatOpenAI
        llm = SanitizedLLM(ChatOpenAI(), Sanitizer())
        response = llm.invoke("My email is bob@corp.com")
    """

    def __init__(self, llm: Any, sanitizer: "Sanitizer") -> None:
        _require_langchain()
        self._llm = llm
        self._sanitizer = sanitizer

    def invoke(self, input: Any, **kwargs: Any) -> Any:
        session = self._sanitizer.session()
        from langchain_core.messages import BaseMessage

        if isinstance(input, str):
            clean = session.anonymize(input)
        elif isinstance(input, BaseMessage):
            clean = input.model_copy(update={"content": session.anonymize(input.content)})
        elif isinstance(input, list):
            clean = [
                m.model_copy(update={"content": session.anonymize(m.content)})
                if isinstance(m, BaseMessage) else m
                for m in input
            ]
        else:
            clean = input

        result = self._llm.invoke(clean, **kwargs)

        if isinstance(result, str):
            return session.deanonymize(result)
        if isinstance(result, BaseMessage):
            return result.model_copy(
                update={"content": session.deanonymize(result.content)}
            )
        return result

    async def ainvoke(self, input: Any, **kwargs: Any) -> Any:
        session = self._sanitizer.session()
        from langchain_core.messages import BaseMessage

        if isinstance(input, str):
            clean = session.anonymize(input)
        elif isinstance(input, BaseMessage):
            clean = input.model_copy(update={"content": session.anonymize(input.content)})
        else:
            clean = input

        result = await self._llm.ainvoke(clean, **kwargs)

        if isinstance(result, str):
            return session.deanonymize(result)
        if isinstance(result, BaseMessage):
            return result.model_copy(
                update={"content": session.deanonymize(result.content)}
            )
        return result

    def __getattr__(self, name: str) -> Any:
        return getattr(self._llm, name)
