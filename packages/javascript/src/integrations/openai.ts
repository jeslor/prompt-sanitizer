/**
 * OpenAI SDK integration for prompt-sanitizer (JavaScript/TypeScript).
 *
 * Transparently wraps any `OpenAI` or `AzureOpenAI` client so that every
 * `chat.completions.create` call automatically:
 *
 * 1. Anonymizes all `content` fields in `messages` before sending to OpenAI.
 * 2. Deanonymizes the response content before returning it to the caller.
 *
 * OpenAI never sees real PII; the caller sees real values in the response.
 *
 * Streaming is also supported — set `stream: true` as normal.
 *
 * @example
 * ```ts
 * import OpenAI from "openai";
 * import { Sanitizer } from "prompt-sanitizer";
 * import { wrap } from "prompt-sanitizer/integrations/openai";
 *
 * const client = wrap(new OpenAI(), new Sanitizer());
 *
 * const response = await client.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "My email is alice@example.com" }],
 * });
 * console.log(response.choices[0].message.content); // real email restored
 *
 * // Streaming:
 * const stream = await client.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "My email is alice@example.com" }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 * }
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";
import type { Session } from "../session.js";

type AnyOpenAIClient = {
  chat: {
    completions: {
      create(params: Record<string, unknown>): unknown;
    };
  };
  [key: string]: unknown;
};

type OpenAIMessage = {
  role: string;
  content: string | OpenAIMessagePart[] | null;
  [key: string]: unknown;
};

type OpenAIMessagePart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

type OpenAIResponse = {
  choices: Array<{
    message?: { content?: string | null; [key: string]: unknown };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type OpenAIStreamChunk = {
  choices: Array<{
    delta?: { content?: string | null; [key: string]: unknown };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sanitizeMessages(
  messages: OpenAIMessage[],
  session: Session
): Promise<OpenAIMessage[]> {
  const result: OpenAIMessage[] = [];
  for (const msg of messages) {
    const m = { ...msg };
    if (typeof m.content === "string") {
      m.content = await session.anonymize(m.content);
    } else if (Array.isArray(m.content)) {
      m.content = await Promise.all(
        m.content.map(async (part) => {
          const p = { ...part };
          if (p.type === "text" && typeof p.text === "string") {
            p.text = await session.anonymize(p.text);
          }
          return p;
        })
      );
    }
    result.push(m);
  }
  return result;
}

async function deanonymizeResponse(
  response: OpenAIResponse,
  session: Session
): Promise<OpenAIResponse> {
  const choices = await Promise.all(
    (response.choices ?? []).map(async (choice) => {
      const c = { ...choice };
      if (c.message && typeof c.message.content === "string") {
        c.message = { ...c.message, content: await session.deanonymize(c.message.content) };
      }
      return c;
    })
  );
  return { ...response, choices };
}

/** Partial-token regex — catches vault tokens split across stream chunks. */
const PARTIAL_TOKEN_RE = /\[[A-Z_]+(?:_\d+)?$|\[[A-Z_]*$/;

async function* deanonymizeStream(
  stream: AsyncIterable<OpenAIStreamChunk>,
  session: Session
): AsyncGenerator<OpenAIStreamChunk> {
  let buffer = "";

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      buffer += delta;

      // Flush everything that cannot be the start of a vault token
      const partialMatch = buffer.match(PARTIAL_TOKEN_RE);
      const flushUpTo = partialMatch ? partialMatch.index! : buffer.length;

      if (flushUpTo > 0) {
        const toFlush = buffer.slice(0, flushUpTo);
        buffer = buffer.slice(flushUpTo);
        const clean = await session.deanonymize(toFlush);
        yield {
          ...chunk,
          choices: [
            {
              ...(chunk.choices?.[0] ?? {}),
              delta: { ...(chunk.choices?.[0]?.delta ?? {}), content: clean },
            },
          ],
        };
      }
      // else: entire buffer is potentially a partial token — keep buffering
    } else {
      yield chunk;
    }
  }

  // Flush the remaining buffer
  if (buffer) {
    const clean = await session.deanonymize(buffer);
    // We no longer have an original chunk to clone, emit a synthetic one
    yield {
      choices: [{ delta: { content: clean } }],
    };
  }
}

// ── Proxy classes ─────────────────────────────────────────────────────────────

class SanitizedCompletions {
  constructor(
    private readonly _completions: AnyOpenAIClient["chat"]["completions"],
    private readonly _sanitizer: Sanitizer
  ) {}

  async create(params: Record<string, unknown>): Promise<unknown> {
    const messages = (params.messages ?? []) as OpenAIMessage[];
    const sess = this._sanitizer.session();
    const cleanMessages = await sanitizeMessages(messages, sess);
    const callParams = { ...params, messages: cleanMessages };

    if (params.stream) {
      const stream = (await this._completions.create(callParams)) as AsyncIterable<OpenAIStreamChunk>;
      return deanonymizeStream(stream, sess);
    }

    const response = (await this._completions.create(callParams)) as OpenAIResponse;
    return deanonymizeResponse(response, sess);
  }
}

class SanitizedChat {
  readonly completions: SanitizedCompletions;

  constructor(chat: AnyOpenAIClient["chat"], sanitizer: Sanitizer) {
    this.completions = new SanitizedCompletions(chat.completions, sanitizer);
  }
}

/**
 * Proxy wrapping an OpenAI client with automatic PII sanitization.
 * All attributes other than `chat` are passed through transparently.
 */
class SanitizedClient {
  readonly chat: SanitizedChat;

  constructor(
    private readonly _client: AnyOpenAIClient,
    sanitizer: Sanitizer
  ) {
    this.chat = new SanitizedChat(_client.chat, sanitizer);
  }

  // Pass all other attributes (models, embeddings, etc.) through unchanged
  [key: string]: unknown;
}

// Proxy handler to forward unknown property access to the underlying client
function createProxy(client: AnyOpenAIClient, sanitizer: Sanitizer): SanitizedClient {
  const wrapped = new SanitizedClient(client, sanitizer);
  return new Proxy(wrapped, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop as string];
      return client[prop as string];
    },
  }) as SanitizedClient;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wrap an OpenAI SDK client with automatic PII sanitization.
 *
 * @param client - An instantiated `OpenAI`, `AzureOpenAI`, or compatible client.
 * @param sanitizer - A `Sanitizer` instance.
 * @returns A proxy client that sanitizes all `chat.completions.create` calls.
 */
export function wrap(client: AnyOpenAIClient, sanitizer: Sanitizer): AnyOpenAIClient {
  return createProxy(client, sanitizer) as unknown as AnyOpenAIClient;
}
