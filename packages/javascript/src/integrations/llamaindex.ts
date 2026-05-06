/**
 * LlamaIndex.ts integration for prompt-sanitizer.
 *
 * Provides a `PromptSanitizerNodePostprocessor` that sanitizes PII from
 * `NodeWithScore` objects before they are used as context in a query engine.
 *
 * Structurally typed — no hard `llamaindex` peer dependency.
 * Compatible with `llamaindex` ≥ 0.4.
 *
 * @example
 * ```ts
 * import { VectorStoreIndex, RetrieverQueryEngine } from "llamaindex";
 * import { Sanitizer } from "prompt-sanitizer";
 * import { PromptSanitizerNodePostprocessor } from "prompt-sanitizer/integrations/llamaindex";
 *
 * const sanitizer = new Sanitizer();
 * const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);
 *
 * const queryEngine = RetrieverQueryEngine.fromArgs({
 *   retriever: index.asRetriever(),
 *   nodePostprocessors: [postprocessor],
 * });
 *
 * const result = await queryEngine.query({ query: "What did Alice say?" });
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";

// ── Minimal structural types ───────────────────────────────────────────────

export interface TextNode {
  text: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NodeWithScore {
  node: TextNode;
  score?: number;
  [key: string]: unknown;
}

export interface BaseNodePostprocessorLike {
  postprocessNodes(
    nodes: NodeWithScore[],
    query?: string
  ): Promise<NodeWithScore[]>;
}

// ── PromptSanitizerNodePostprocessor ──────────────────────────────────────

/**
 * A LlamaIndex `BaseNodePostprocessor`-compatible class that sanitizes PII
 * from retrieved node text before the LLM uses it as context.
 *
 * Maintains a per-call session so all nodes in a single query share a vault
 * — tokens are consistent across nodes, enabling accurate deanonymization.
 *
 * The original text is stored in `node.metadata.__original_text` if you
 * need it downstream (disabled with `preserveOriginal: false`).
 */
export class PromptSanitizerNodePostprocessor implements BaseNodePostprocessorLike {
  private readonly _sanitizer: Sanitizer;
  private readonly _preserveOriginal: boolean;

  constructor(
    sanitizer: Sanitizer,
    options: { preserveOriginal?: boolean } = {}
  ) {
    this._sanitizer = sanitizer;
    this._preserveOriginal = options.preserveOriginal ?? true;
  }

  /**
   * Sanitize PII from all nodes in a single batch, sharing one vault session
   * so the same PII value maps to the same token across nodes.
   */
  async postprocessNodes(
    nodes: NodeWithScore[],
    _query?: string
  ): Promise<NodeWithScore[]> {
    const session = this._sanitizer.session();

    // Sequential processing ensures the shared vault is consistent across all
    // nodes — concurrent async calls would race on the vault check+generate step.
    const results: NodeWithScore[] = [];
    for (const nodeWithScore of nodes) {
      const original = nodeWithScore.node.text;
      const sanitized = await session.anonymize(original);

      const updatedNode: TextNode = {
        ...nodeWithScore.node,
        text: sanitized,
      };

      if (this._preserveOriginal) {
        updatedNode.metadata = {
          ...nodeWithScore.node.metadata,
          __original_text: original,
        };
      }

      results.push({
        ...nodeWithScore,
        node: updatedNode,
        // Attach session so downstream components can deanonymize
        __sanitizerSession: session,
      });
    }
    return results;
  }
}

// ── PromptSanitizerQueryTransform ─────────────────────────────────────────

/**
 * Sanitizes the user query string itself before retrieval.
 *
 * Use alongside `PromptSanitizerNodePostprocessor` for full sanitization:
 * ```ts
 * const queryTransform = new PromptSanitizerQueryTransform(sanitizer);
 * const cleanQuery = await queryTransform.transform("Alice (alice@example.com) asked...");
 * ```
 */
export class PromptSanitizerQueryTransform {
  private readonly _sanitizer: Sanitizer;

  constructor(sanitizer: Sanitizer) {
    this._sanitizer = sanitizer;
  }

  async transform(query: string): Promise<string> {
    const result = await this._sanitizer.sanitize(query);
    return result.text;
  }
}
