/**
 * Tests for the LangChain.js integration.
 * All LLM calls are mocked — no real API keys needed.
 */
import { describe, it, expect, vi } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";
import {
  PromptSanitizerRunnable,
  SanitizedLLM,
  SanitizedChain,
} from "../src/integrations/langchain.js";
import type { LangChainBaseLLM, LangChainBaseChain } from "../src/integrations/langchain.js";

// ── Mock LLM ──────────────────────────────────────────────────────────────

function makeMockLLM(response: string): LangChainBaseLLM {
  return {
    invoke: vi.fn(async () => response),
  };
}

// ── PromptSanitizerRunnable ───────────────────────────────────────────────

describe("PromptSanitizerRunnable", () => {
  it("sanitizes PII from the input string", async () => {
    const sanitizer = new Sanitizer();
    const runnable = new PromptSanitizerRunnable(sanitizer);

    const output = await runnable.invoke("My email is carol@test.com");
    expect(output).not.toContain("carol@test.com");
  });

  it("passes through clean text unchanged", async () => {
    const sanitizer = new Sanitizer();
    const runnable = new PromptSanitizerRunnable(sanitizer);

    const output = await runnable.invoke("What is the weather today?");
    expect(output).toBe("What is the weather today?");
  });

  it("can be piped to another runnable", async () => {
    const sanitizer = new Sanitizer();
    const runnable = new PromptSanitizerRunnable(sanitizer);
    const upper = {
      invoke: async (input: string) => input.toUpperCase(),
      pipe: () => upper,
    };

    const chain = runnable.pipe(upper);
    const output = await chain.invoke("hello");
    expect(output).toBe("HELLO");
  });
});

// ── SanitizedLLM ─────────────────────────────────────────────────────────

describe("SanitizedLLM", () => {
  it("does not pass PII to the underlying LLM", async () => {
    const sanitizer = new Sanitizer();
    const mockLLM = makeMockLLM("Great question!");
    const safeModel = new SanitizedLLM(mockLLM, sanitizer);

    await safeModel.invoke("My email is dan@example.com, what should I do?");

    const calledWith = (mockLLM.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith).not.toContain("dan@example.com");
  });

  it("deanonymizes the LLM response", async () => {
    const sanitizer = new Sanitizer();
    // The mock echoes the sanitized input back — the wrapper will deanonymize it
    const mockLLM = makeMockLLM("");
    (mockLLM.invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: string) => `Please email ${input} for details.`
    );
    const safeModel = new SanitizedLLM(mockLLM, sanitizer);
    const response = await safeModel.invoke("dan@example.com");
    expect(response).toContain("dan@example.com");
  });

  it("passes non-string input through without sanitizing", async () => {
    const sanitizer = new Sanitizer();
    const mockLLM = makeMockLLM("OK");
    const safeModel = new SanitizedLLM(mockLLM, sanitizer);

    const inputObj = { messages: [{ role: "user", content: "hello" }] };
    await safeModel.invoke(inputObj);

    const calledWith = (mockLLM.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith).toEqual(inputObj);
  });
});

// ── SanitizedChain ────────────────────────────────────────────────────────

describe("SanitizedChain", () => {
  it("sanitizes string values in the input dict", async () => {
    const sanitizer = new Sanitizer();
    const mockChain: LangChainBaseChain = {
      invoke: vi.fn(async (input: Record<string, unknown>) => ({
        answer: `I see the email is ${input["question"]}`,
      })),
    };
    const chain = new SanitizedChain(mockChain, sanitizer);

    await chain.invoke({ question: "Tell me about eve@test.com", context: "Some doc" });

    const calledWith = (mockChain.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith.question).not.toContain("eve@test.com");
    expect(calledWith.context).not.toContain("eve@test.com");
  });

  it("only sanitizes specified fields when provided", async () => {
    const sanitizer = new Sanitizer();
    const mockChain: LangChainBaseChain = {
      invoke: vi.fn(async () => "done"),
    };
    const chain = new SanitizedChain(mockChain, sanitizer, ["question"]);

    await chain.invoke({
      question: "My SSN is 123-45-6789",
      context: "Doc with 987-65-4321",
    });

    const calledWith = (mockChain.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith.question).not.toContain("123-45-6789");
    // context not in fields list — stays as-is
    expect(calledWith.context).toContain("987-65-4321");
  });

  it("deanonymizes string results", async () => {
    const sanitizer = new Sanitizer();
    // Mock echoes the sanitized "question" field back — wrapper deanonymizes it
    const mockChain: LangChainBaseChain = {
      invoke: vi.fn(async (input: Record<string, unknown>) => `Email: ${input["question"]}`),
    };
    const chain = new SanitizedChain(mockChain, sanitizer);
    const result = await chain.invoke({ question: "eve@test.com" });
    expect(result).toContain("eve@test.com");
  });

  it("deanonymizes object results", async () => {
    const sanitizer = new Sanitizer();
    // Mock echoes the sanitized "question" field in an object — wrapper deanonymizes it
    const mockChain: LangChainBaseChain = {
      invoke: vi.fn(async (input: Record<string, unknown>) => ({ answer: `Reply to ${input["question"]}` })),
    };
    const chain = new SanitizedChain(mockChain, sanitizer);
    const result = await chain.invoke({ question: "frank@test.com" }) as Record<string, string>;
    expect(result.answer).toContain("frank@test.com");
  });
});
