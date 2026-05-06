/**
 * Vercel AI SDK integration for prompt-sanitizer.
 *
 * Provides `wrapGenerate` and `wrapStream` to transparently sanitize
 * prompts before they reach the LLM and restore PII in the response.
 *
 * @example
 * ```ts
 * import { Sanitizer } from "prompt-sanitizer";
 * import { wrapGenerate } from "prompt-sanitizer/integrations/vercel-ai";
 * import { generateText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * const sanitizer = new Sanitizer();
 * const safeGenerate = wrapGenerate(sanitizer, generateText);
 *
 * const { text } = await safeGenerate({
 *   model: openai("gpt-4o"),
 *   prompt: "My email is alice@example.com, what should I eat for dinner?",
 * });
 * // text is deanonymized — original email restored in the response
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";
import type { Session } from "../session.js";

// ── Minimal type surfaces from the Vercel AI SDK ─────────────────────────────
// We use structural typing so the integration works without the SDK as a hard dep.

export interface CoreMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface GenerateTextParams {
  messages?: CoreMessage[];
  prompt?: string;
  system?: string;
  [key: string]: unknown;
}

export interface GenerateTextResult {
  text: string;
  [key: string]: unknown;
}

export interface StreamTextParams extends GenerateTextParams {}

export interface StreamTextChunk {
  type: string;
  textDelta?: string;
  [key: string]: unknown;
}

export interface StreamTextResult {
  fullStream: AsyncIterable<StreamTextChunk>;
  [key: string]: unknown;
}

type GenerateFn = (params: GenerateTextParams) => Promise<GenerateTextResult>;
type StreamFn = (params: StreamTextParams) => Promise<StreamTextResult>;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sanitizeMessages(
  session: Session,
  messages: CoreMessage[]
): Promise<CoreMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (typeof msg.content === "string") {
        return { ...msg, content: await session.anonymize(msg.content) };
      }
      // content array (multi-modal)
      const sanitizedParts = await Promise.all(
        msg.content.map(async (part) => {
          if (part.type === "text" && typeof part.text === "string") {
            return { ...part, text: await session.anonymize(part.text) };
          }
          return part;
        })
      );
      return { ...msg, content: sanitizedParts };
    })
  );
}

async function sanitizeParams(
  session: Session,
  params: GenerateTextParams
): Promise<GenerateTextParams> {
  const result = { ...params };

  if (params.prompt && typeof params.prompt === "string") {
    result.prompt = await session.anonymize(params.prompt);
  }

  if (params.system && typeof params.system === "string") {
    result.system = await session.anonymize(params.system);
  }

  if (params.messages) {
    result.messages = await sanitizeMessages(session, params.messages);
  }

  return result;
}

// ── wrapGenerate ──────────────────────────────────────────────────────────────

/**
 * Wraps Vercel AI SDK's `generateText` with automatic PII sanitization.
 *
 * - Sanitizes `prompt`, `system`, and `messages` before the call.
 * - Restores PII in the returned `text` field.
 * - Uses a per-call Session to ensure bidirectional mapping.
 *
 * @param sanitizer - A configured {@link Sanitizer} instance.
 * @param generateFn - The `generateText` function from the `ai` package.
 * @returns A wrapped version of `generateText` with the same signature.
 */
export function wrapGenerate(
  sanitizer: Sanitizer,
  generateFn: GenerateFn
): GenerateFn {
  return async (params: GenerateTextParams): Promise<GenerateTextResult> => {
    const session = sanitizer.session();
    const sanitizedParams = await sanitizeParams(session, params);
    const result = await generateFn(sanitizedParams);
    return {
      ...result,
      text: session.deanonymize(result.text),
    };
  };
}

// ── wrapStream ────────────────────────────────────────────────────────────────

/**
 * Wraps Vercel AI SDK's `streamText` with automatic PII sanitization.
 *
 * - Sanitizes `prompt`, `system`, and `messages` before streaming begins.
 * - Applies deanonymization to each `textDelta` chunk in the stream using a
 *   rolling buffer — this handles tokens that are split across chunk boundaries.
 *
 * The returned result has the same shape as the original `StreamTextResult`
 * but with a new `fullStream` that yields deanonymized chunks.
 *
 * @param sanitizer - A configured {@link Sanitizer} instance.
 * @param streamFn - The `streamText` function from the `ai` package.
 * @returns A wrapped version of `streamText` with the same signature.
 */
export function wrapStream(sanitizer: Sanitizer, streamFn: StreamFn): StreamFn {
  return async (params: StreamTextParams): Promise<StreamTextResult> => {
    const session = sanitizer.session();
    const sanitizedParams = await sanitizeParams(session, params);
    const result = await streamFn(sanitizedParams);

    // Re-map fullStream to deanonymize chunks as they arrive
    const originalStream = result.fullStream;
    const deanonymizedStream = createDeanonymizedStream(session, originalStream);

    return { ...result, fullStream: deanonymizedStream };
  };
}

/**
 * Creates a deanonymized stream from the original stream using a rolling buffer.
 *
 * The rolling buffer strategy ensures vault tokens split across chunk
 * boundaries (e.g. `[EMAIL` ... `_1]`) are still detected and restored.
 */
async function* createDeanonymizedStream(
  session: Session,
  stream: AsyncIterable<StreamTextChunk>
): AsyncGenerator<StreamTextChunk> {
  // Buffer accumulates text deltas so we can detect split tokens
  let buffer = "";
  // Regex to detect a partial vault token at the end of the buffer
  const partialTokenRe = /\[[A-Z_]+(?:_\d+)?$|\[[A-Z_]*$/;

  for await (const chunk of stream) {
    if (chunk.type !== "text-delta" || typeof chunk.textDelta !== "string") {
      yield chunk;
      continue;
    }

    buffer += chunk.textDelta;

    // Check whether the buffer ends with a partial token
    const partial = partialTokenRe.test(buffer);
    if (partial) {
      // Hold the buffer — wait for the next chunk to complete the token
      continue;
    }

    // Safe to deanonymize the entire buffer
    const restored = session.deanonymize(buffer);
    buffer = "";
    yield { ...chunk, textDelta: restored };
  }

  // Flush any remaining buffer content
  if (buffer.length > 0) {
    yield { type: "text-delta", textDelta: session.deanonymize(buffer) };
  }
}

// ── Convenience re-export ─────────────────────────────────────────────────────

export { type Sanitizer, type Session };
