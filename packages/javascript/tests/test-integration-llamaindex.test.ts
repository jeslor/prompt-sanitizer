/**
 * Tests for the LlamaIndex.ts integration.
 * No real index or LLM — all node data is synthetic.
 */
import { describe, it, expect } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";
import {
  PromptSanitizerNodePostprocessor,
  PromptSanitizerQueryTransform,
} from "../src/integrations/llamaindex.js";
import type { NodeWithScore } from "../src/integrations/llamaindex.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeNode(text: string, score = 0.9): NodeWithScore {
  return { node: { text }, score };
}

// ── PromptSanitizerNodePostprocessor ──────────────────────────────────────

describe("PromptSanitizerNodePostprocessor", () => {
  it("sanitizes PII from node text", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const nodes = [makeNode("Alice (alice@example.com) joined yesterday.")];
    const result = await postprocessor.postprocessNodes(nodes);

    expect(result[0].node.text).not.toContain("alice@example.com");
  });

  it("preserves node score", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const nodes = [makeNode("Call 555-123-4567 for info.", 0.75)];
    const result = await postprocessor.postprocessNodes(nodes);

    expect(result[0].score).toBe(0.75);
  });

  it("stores original text in metadata when preserveOriginal is true (default)", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const nodes = [makeNode("SSN: 123-45-6789")];
    const result = await postprocessor.postprocessNodes(nodes);

    expect(result[0].node.metadata?.__original_text).toBe("SSN: 123-45-6789");
  });

  it("does not store original text when preserveOriginal is false", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer, {
      preserveOriginal: false,
    });

    const nodes = [makeNode("SSN: 123-45-6789")];
    const result = await postprocessor.postprocessNodes(nodes);

    expect(result[0].node.metadata?.__original_text).toBeUndefined();
  });

  it("processes multiple nodes sharing one vault session", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const nodes = [
      makeNode("alice@example.com is the contact."),
      makeNode("Reach alice@example.com anytime."),
    ];
    const result = await postprocessor.postprocessNodes(nodes);

    // Same email in both nodes should produce the same token (shared vault)
    expect(result[0].node.text).not.toContain("alice@example.com");
    expect(result[1].node.text).not.toContain("alice@example.com");

    // Both sanitized nodes should use the same replacement token
    const token0 = result[0].node.text.split("is the contact.")[0].trim();
    const token1 = result[1].node.text.split("anytime.")[0].replace("Reach ", "").trim();
    expect(token0).toBe(token1);
  });

  it("attaches session to result for downstream deanonymization", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const nodes = [makeNode("bob@test.com is great.")];
    const result = await postprocessor.postprocessNodes(nodes);

    const session = (result[0] as any).__sanitizerSession;
    expect(session).toBeDefined();
    expect(typeof session.deanonymize).toBe("function");
  });

  it("handles clean text with no PII gracefully", async () => {
    const sanitizer = new Sanitizer();
    const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer);

    const text = "The French Revolution began in 1789.";
    const nodes = [makeNode(text)];
    const result = await postprocessor.postprocessNodes(nodes);

    expect(result[0].node.text).toBe(text);
  });
});

// ── PromptSanitizerQueryTransform ─────────────────────────────────────────

describe("PromptSanitizerQueryTransform", () => {
  it("sanitizes PII from query string", async () => {
    const sanitizer = new Sanitizer();
    const transform = new PromptSanitizerQueryTransform(sanitizer);

    const clean = await transform.transform("Find documents about alice@example.com");
    expect(clean).not.toContain("alice@example.com");
  });

  it("passes through clean queries", async () => {
    const sanitizer = new Sanitizer();
    const transform = new PromptSanitizerQueryTransform(sanitizer);

    const result = await transform.transform("What is machine learning?");
    expect(result).toBe("What is machine learning?");
  });
});
