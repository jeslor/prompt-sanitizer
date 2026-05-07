"""
LlamaIndex integration for prompt-sanitizer.

Provides a ``PromptSanitizerPostprocessor`` — a ``BaseNodePostprocessor`` that
sanitizes node text before it is sent to the LLM and can optionally restore
PII tokens in the final synthesized response.

Usage::

    from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
    from llama_index.core.query_engine import RetrieverQueryEngine
    from prompt_sanitizer import Sanitizer
    from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor

    sanitizer = Sanitizer()
    postprocessor = PromptSanitizerPostprocessor(sanitizer)

    index = VectorStoreIndex.from_documents(...)
    query_engine = index.as_query_engine(
        node_postprocessors=[postprocessor],
    )

    response = query_engine.query("What is Alice's email?")
    # Nodes sent to LLM have PII anonymized; response is deanonymized

Requires::

    pip install ai-prompt-sanitizer[integrations]
    pip install llama-index-core
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional, Sequence

if TYPE_CHECKING:
    from ..sanitizer import Sanitizer


def _require_llamaindex() -> None:
    try:
        from llama_index.core.postprocessor.types import BaseNodePostprocessor  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            "llama-index-core is not installed. Run: pip install llama-index-core"
        ) from exc


class PromptSanitizerPostprocessor:
    """
    LlamaIndex ``BaseNodePostprocessor`` that sanitizes node text before LLM calls.

    Parameters
    ----------
    sanitizer:
        A :class:`~prompt_sanitizer.Sanitizer` instance.
    restore_in_response:
        If ``True`` (default), the postprocessor stores the session so you can
        call :meth:`deanonymize` on the final response string.

    Examples
    --------
    ::

        pp = PromptSanitizerPostprocessor(Sanitizer())
        query_engine = index.as_query_engine(node_postprocessors=[pp])
        raw = query_engine.query("Find Alice's contact info")
        clean = pp.deanonymize(str(raw))
    """

    def __init__(
        self,
        sanitizer: "Sanitizer",
        restore_in_response: bool = True,
    ) -> None:
        _require_llamaindex()
        self._sanitizer = sanitizer
        self._restore = restore_in_response
        self._session: Any = None  # reused across a single query

    # ── LlamaIndex BaseNodePostprocessor protocol ─────────────────────────────

    def _postprocess_nodes(
        self,
        nodes: list[Any],
        query_bundle: Any = None,
    ) -> list[Any]:
        """Sanitize text content of every node."""
        self._session = self._sanitizer.session()
        result = []
        for node_with_score in nodes:
            node = node_with_score.node
            if hasattr(node, "text") and isinstance(node.text, str):
                sanitized_text = self._session.anonymize(node.text)
                # LlamaIndex nodes are often frozen dataclasses — use copy
                try:
                    node = node.model_copy(update={"text": sanitized_text})
                except AttributeError:
                    try:
                        import copy
                        node = copy.copy(node)
                        node.text = sanitized_text
                    except Exception:
                        pass
            # Rebuild node_with_score with sanitized node
            try:
                node_with_score = node_with_score.model_copy(update={"node": node})
            except AttributeError:
                try:
                    import copy
                    node_with_score = copy.copy(node_with_score)
                    node_with_score.node = node
                except Exception:
                    pass
            result.append(node_with_score)
        return result

    # Allow direct call as postprocessor
    def __call__(
        self,
        nodes: list[Any],
        query_bundle: Any = None,
        **kwargs: Any,
    ) -> list[Any]:
        return self._postprocess_nodes(nodes, query_bundle)

    # ── Deanonymization helpers ───────────────────────────────────────────────

    def deanonymize(self, text: str) -> str:
        """
        Restore PII tokens in *text* using the session from the last query.

        Call this on the final synthesized response string.
        """
        if self._session is None:
            return text
        return self._session.deanonymize(text)

    @property
    def session(self) -> Any:
        """The active session (or ``None`` before first query)."""
        return self._session
