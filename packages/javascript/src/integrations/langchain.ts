/**
 * LangChain.js integration for prompt-sanitizer.
 *
 * Provides:
 *  - `PromptSanitizerRunnable` — a LangChain `Runnable` that sanitizes strings.
 *  - `SanitizedLLM` — wraps any LangChain `BaseLLM` for transparent anonymize/deanonymize.
 *
 * These are structurally typed — no hard `langchain` peer dependency required.
 * They will work with `@langchain/core` ≥ 0.1.
 *
 * @example
 * ```ts
 * import { ChatOpenAI } from "@langchain/openai";
 * import { Sanitizer } from "prompt-sanitizer";
 * import { SanitizedLLM } from "prompt-sanitizer/integrations/langchain";
 *
 * const sanitizer = new Sanitizer();
 * const llm = new SanitizedLLM(new ChatOpenAI({ model: "gpt-4o" }), sanitizer);
 *
 * const response = await llm.invoke("My email is alice@example.com, help me.");
 * // response has PII restored — the underlying LLM never saw the real email
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";

// ── Minimal structural interfaces (no hard @langchain/* dep) ──────────────

export interface LangChainRunnable<In, Out> {
  invoke(input: In, config?: Record<string, unknown>): Promise<Out>;
  pipe<NewOut>(next: LangChainRunnable<Out, NewOut>): LangChainRunnable<In, NewOut>;
}

export interface LangChainBaseLLM {
  invoke(input: string | unknown, config?: Record<string, unknown>): Promise<string>;
  [key: string]: unknown;
}

export interface LangChainBaseChain {
  invoke(input: Record<string, unknown>, config?: Record<string, unknown>): Promise<unknown>;
  [key: string]: unknown;
}

// ── PromptSanitizerRunnable ────────────────────────────────────────────────

/**
 * A LangChain `Runnable<string, string>` that sanitizes PII from the input
 * string before passing it to the next chain component.
 *
 * Use it at the start of a LangChain pipeline:
 * ```ts
 * const chain = new PromptSanitizerRunnable(sanitizer).pipe(promptTemplate).pipe(llm);
 * ```
 *
 * For bidirectional (anonymize/deanonymize) use {@link SanitizedLLM} instead.
 */
export class PromptSanitizerRunnable implements LangChainRunnable<string, string> {
  private readonly _sanitizer: Sanitizer;

  constructor(sanitizer: Sanitizer) {
    this._sanitizer = sanitizer;
  }

  async invoke(input: string, _config?: Record<string, unknown>): Promise<string> {
    const result = await this._sanitizer.sanitize(input);
    return result.text;
  }

  pipe<Out>(next: LangChainRunnable<string, Out>): LangChainRunnable<string, Out> {
    return new PipedRunnable<string, string, Out>(this, next);
  }
}

// ── SanitizedLLM ─────────────────────────────────────────────────────────

/**
 * Wraps any LangChain LLM/Chat model with automatic PII sanitization.
 *
 * - Opens a per-call session.
 * - Anonymizes the input prompt.
 * - Calls the underlying LLM.
 * - Deanonymizes the response before returning it.
 *
 * The wrapped LLM never sees real PII.
 */
export class SanitizedLLM {
  private readonly _inner: LangChainBaseLLM;
  private readonly _sanitizer: Sanitizer;

  constructor(llm: LangChainBaseLLM, sanitizer: Sanitizer) {
    this._inner = llm;
    this._sanitizer = sanitizer;
  }

  async invoke(
    input: string | unknown,
    config?: Record<string, unknown>
  ): Promise<string> {
    const session = this._sanitizer.session();

    // Sanitize if input is a plain string
    const sanitizedInput =
      typeof input === "string" ? await session.anonymize(input) : input;

    const response = await this._inner.invoke(sanitizedInput, config);
    return session.deanonymize(response);
  }

  /** Forward any other property accesses to the underlying LLM. */
  [key: string]: unknown;
}

// ── SanitizedChain ────────────────────────────────────────────────────────

/**
 * Wraps a LangChain `BaseChain` (or LCEL chain) with PII sanitization.
 *
 * Sanitizes all string values in the input dict before invoking the chain,
 * then restores PII in the output.
 *
 * @example
 * ```ts
 * const chain = RunnableSequence.from([promptTemplate, llm, outputParser]);
 * const safeChain = new SanitizedChain(chain, sanitizer, ["question", "context"]);
 * const out = await safeChain.invoke({ question: "Where does Alice live?", context: "..." });
 * ```
 */
export class SanitizedChain {
  private readonly _inner: LangChainBaseChain;
  private readonly _sanitizer: Sanitizer;
  private readonly _fields: string[];

  constructor(
    chain: LangChainBaseChain,
    sanitizer: Sanitizer,
    /** Input dict keys to sanitize. Default: all string values. */
    fields?: string[]
  ) {
    this._inner = chain;
    this._sanitizer = sanitizer;
    this._fields = fields ?? [];
  }

  async invoke(
    input: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<unknown> {
    const session = this._sanitizer.session();
    const sanitized: Record<string, unknown> = { ...input };

    for (const [key, val] of Object.entries(input)) {
      if (typeof val !== "string") continue;
      if (this._fields.length === 0 || this._fields.includes(key)) {
        sanitized[key] = await session.anonymize(val);
      }
    }

    const result = await this._inner.invoke(sanitized, config);

    // Restore PII in string results
    if (typeof result === "string") {
      return session.deanonymize(result);
    }
    if (result && typeof result === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? session.deanonymize(v) : v;
      }
      return out;
    }
    return result;
  }
}

// ── Internal: pipe helper ─────────────────────────────────────────────────

class PipedRunnable<In, Mid, Out> implements LangChainRunnable<In, Out> {
  constructor(
    private readonly _first: LangChainRunnable<In, Mid>,
    private readonly _second: LangChainRunnable<Mid, Out>
  ) {}

  async invoke(input: In, config?: Record<string, unknown>): Promise<Out> {
    const mid = await this._first.invoke(input, config);
    return this._second.invoke(mid, config);
  }

  pipe<NewOut>(next: LangChainRunnable<Out, NewOut>): LangChainRunnable<In, NewOut> {
    return new PipedRunnable<In, Out, NewOut>(this, next);
  }
}
