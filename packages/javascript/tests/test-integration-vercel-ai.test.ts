/**
 * Tests for the Vercel AI SDK integration.
 * All LLM calls are mocked — no real API keys needed.
 */
import { describe, it, expect, vi } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";
import { wrapGenerate, wrapStream } from "../src/integrations/vercel-ai.js";
import type {
  GenerateTextParams,
  GenerateTextResult,
  StreamTextParams,
  StreamTextResult,
  StreamTextChunk,
} from "../src/integrations/vercel-ai.js";

// ── Mock helpers ──────────────────────────────────────────────────────────

function makeMockGenerateFn(response: string) {
  return vi.fn(async (_params: GenerateTextParams): Promise<GenerateTextResult> => ({
    text: response,
  }));
}

async function* makeChunkStream(chunks: string[]): AsyncGenerator<StreamTextChunk> {
  for (const textDelta of chunks) {
    yield { type: "text-delta", textDelta };
  }
}

function makeMockStreamFn(chunks: string[]) {
  return vi.fn(async (_params: StreamTextParams): Promise<StreamTextResult> => ({
    fullStream: makeChunkStream(chunks),
  }));
}

// ── wrapGenerate ──────────────────────────────────────────────────────────

describe("wrapGenerate", () => {
  it("sanitizes the prompt before calling generateFn", async () => {
    const sanitizer = new Sanitizer();
    const mockGenerate = makeMockGenerateFn("Sure, I can help!");
    const safeGenerate = wrapGenerate(sanitizer, mockGenerate);

    await safeGenerate({ prompt: "My email is alice@example.com, help me." });

    const calledWith = mockGenerate.mock.calls[0][0] as GenerateTextParams;
    expect(calledWith.prompt).not.toContain("alice@example.com");
  });

  it("deanonymizes the response text", async () => {
    const sanitizer = new Sanitizer();
    const session = sanitizer.session();

    // Pre-populate the vault so we know what token to use in the response
    const clean = await session.anonymize("Reply to alice@example.com please.");
    // Extract the token that replaced the email
    const emailToken = Object.values((session as any)._vault.snapshot())[0] as string;

    const mockGenerate = makeMockGenerateFn(
      `I will send an email to ${emailToken} right away.`
    );
    const safeGenerate = wrapGenerate(sanitizer, mockGenerate);
    const result = await safeGenerate({ prompt: "Reply to alice@example.com please." });

    // The deanonymized response should contain the original email
    expect(result.text).toContain("alice@example.com");
  });

  it("sanitizes messages array", async () => {
    const sanitizer = new Sanitizer();
    const mockGenerate = makeMockGenerateFn("OK");
    const safeGenerate = wrapGenerate(sanitizer, mockGenerate);

    await safeGenerate({
      messages: [
        { role: "user", content: "My SSN is 123-45-6789" },
        { role: "system", content: "You are helpful" },
      ],
    });

    const calledWith = mockGenerate.mock.calls[0][0] as GenerateTextParams;
    const userMsg = (calledWith.messages as any[])[0];
    expect(userMsg.content).not.toContain("123-45-6789");
  });

  it("sanitizes the system prompt", async () => {
    const sanitizer = new Sanitizer();
    const mockGenerate = makeMockGenerateFn("OK");
    const safeGenerate = wrapGenerate(sanitizer, mockGenerate);

    await safeGenerate({
      system: "Contact us at support@company.com",
      prompt: "Hello",
    });

    const calledWith = mockGenerate.mock.calls[0][0] as GenerateTextParams;
    expect(calledWith.system).not.toContain("support@company.com");
  });

  it("passes through clean text unchanged (no false positives)", async () => {
    const sanitizer = new Sanitizer();
    const mockGenerate = makeMockGenerateFn("Sure!");
    const safeGenerate = wrapGenerate(sanitizer, mockGenerate);

    await safeGenerate({ prompt: "What is the capital of France?" });

    const calledWith = mockGenerate.mock.calls[0][0] as GenerateTextParams;
    expect(calledWith.prompt).toBe("What is the capital of France?");
  });
});

// ── wrapStream ────────────────────────────────────────────────────────────

describe("wrapStream", () => {
  it("sanitizes the prompt before streaming", async () => {
    const sanitizer = new Sanitizer();
    const mockStream = makeMockStreamFn(["Hello!"]);
    const safeStream = wrapStream(sanitizer, mockStream);

    await safeStream({ prompt: "My email is bob@test.com, help." });

    const calledWith = mockStream.mock.calls[0][0] as StreamTextParams;
    expect(calledWith.prompt).not.toContain("bob@test.com");
  });

  it("yields deanonymized text-delta chunks", async () => {
    const sanitizer = new Sanitizer();

    // First, figure out what token the sanitizer will produce for the email
    const session = sanitizer.session();
    await session.anonymize("alice@example.com");
    const token = Object.values((session as any)._vault.snapshot())[0] as string;

    const mockStream = makeMockStreamFn([`I can email `, `${token} `, `for you.`]);
    const safeStream = wrapStream(sanitizer, mockStream);

    const result = await safeStream({ prompt: "Contact alice@example.com for me." });
    const chunks: StreamTextChunk[] = [];
    for await (const chunk of result.fullStream) {
      chunks.push(chunk);
    }

    const fullText = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.textDelta)
      .join("");
    expect(fullText).toContain("alice@example.com");
  });

  it("passes through non-text-delta chunks unchanged", async () => {
    const sanitizer = new Sanitizer();

    async function* mixedStream(): AsyncGenerator<StreamTextChunk> {
      yield { type: "step-start" };
      yield { type: "text-delta", textDelta: "Hello!" };
      yield { type: "finish", finishReason: "stop" };
    }

    const mockStream = vi.fn(async (): Promise<StreamTextResult> => ({
      fullStream: mixedStream(),
    }));

    const safeStream = wrapStream(sanitizer, mockStream as any);
    const result = await safeStream({ prompt: "Say hello" });

    const chunks: StreamTextChunk[] = [];
    for await (const chunk of result.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "step-start")).toBe(true);
    expect(chunks.some((c) => c.type === "finish")).toBe(true);
  });

  it("flushes remaining buffer after stream ends", async () => {
    const sanitizer = new Sanitizer();

    // Simulate a stream that ends with a partial token in the buffer
    // by having a very simple complete token arrive in a single chunk
    const mockStream = makeMockStreamFn(["The answer is 42."]);
    const safeStream = wrapStream(sanitizer, mockStream);
    const result = await safeStream({ prompt: "What is 6 times 7?" });

    const chunks: StreamTextChunk[] = [];
    for await (const chunk of result.fullStream) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.textDelta)
      .join("");
    expect(text).toBe("The answer is 42.");
  });
});
