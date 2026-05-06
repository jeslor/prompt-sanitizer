import { describe, it, expect } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";
import { PIIDetectedError } from "../src/exceptions.js";
import { EntityType } from "../src/entities.js";
import { Mode } from "../src/modes.js";

describe("Sanitizer - Basic redaction", () => {
  it("redacts email", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("Email john@example.com now");
    expect(r.text).not.toContain("john@example.com");
    expect(r.original).toBe("Email john@example.com now");
  });

  it("redacts phone", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("Call 555-867-5309 now");
    expect(r.text).not.toContain("555-867-5309");
  });

  it("redacts SSN", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("SSN: 123-45-6789");
    expect(r.text).not.toContain("123-45-6789");
  });

  it("redacts credit card", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("Card: 4111 1111 1111 1111");
    expect(r.text).not.toContain("4111 1111 1111 1111");
  });

  it("redacts API key", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize(`Key: ${["sk_live_","ABCDEFGHIJKLMNOPQRSTUVWXYZab"].join("")}`);
    expect(r.text).not.toContain("sk_live_");
  });

  it("leaves clean text unchanged", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("The sky is blue");
    expect(r.text).toBe("The sky is blue");
    expect(r.entities).toHaveLength(0);
    expect(r.score).toBe(0);
  });

  it("populates tokens mapping", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("Email test@example.com");
    expect(Object.keys(r.tokens)).toContain("test@example.com");
  });

  it("score > 0 when PII found", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("My SSN is 123-45-6789");
    expect(r.score).toBeGreaterThan(0);
  });
});

describe("Sanitizer - onDetect modes", () => {
  it("warn mode returns original text with entities", async () => {
    const s = new Sanitizer({ onDetect: "warn" });
    const r = await s.sanitize("Email: secret@example.com");
    expect(r.text).toBe("Email: secret@example.com");
    expect(r.entities.length).toBeGreaterThan(0);
  });

  it("block mode throws PIIDetectedError", async () => {
    const s = new Sanitizer({ onDetect: "block" });
    await expect(s.sanitize("SSN: 123-45-6789")).rejects.toBeInstanceOf(PIIDetectedError);
  });

  it("block mode passes clean text", async () => {
    const s = new Sanitizer({ onDetect: "block" });
    const r = await s.sanitize("Hello world");
    expect(r.text).toBe("Hello world");
  });
});

describe("Sanitizer - Entity filter", () => {
  it("only detects specified entities", async () => {
    const s = new Sanitizer({ entities: [EntityType.EMAIL] });
    const r = await s.sanitize("Email a@b.com, SSN 123-45-6789");
    // Email should be redacted
    expect(r.text).not.toContain("a@b.com");
    // SSN should remain (filtered out)
    expect(r.text).toContain("123-45-6789");
  });
});

describe("Sanitizer - Batch", () => {
  it("sanitizes array of strings", async () => {
    const s = new Sanitizer();
    const results = await s.sanitizeBatch([
      "a@b.com",
      "no pii",
      "123-45-6789",
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]!.text).not.toContain("a@b.com");
    expect(results[1]!.text).toBe("no pii");
    expect(results[2]!.text).not.toContain("123-45-6789");
  });
});

describe("Sanitizer - guard()", () => {
  it("sanitizes string arguments before calling fn", async () => {
    const s = new Sanitizer();
    const received: string[] = [];

    const fn = s.guard(async (prompt: string) => {
      received.push(prompt);
      return "ok";
    });

    await fn("My email is guard@example.com");
    expect(received[0]).not.toContain("guard@example.com");
  });

  it("passes non-string args through unchanged", async () => {
    const s = new Sanitizer();
    const received: any[] = [];

    const fn = s.guard(async (n: number) => {
      received.push(n);
      return n;
    });

    await fn(42 as any);
    expect(received[0]).toBe(42);
  });
});

describe("Sanitizer - Multiple PII in one text", () => {
  it("redacts all entities", async () => {
    const s = new Sanitizer();
    const r = await s.sanitize("Email a@b.com, SSN 123-45-6789, card 4111 1111 1111 1111");
    expect(r.text).not.toContain("a@b.com");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.text).not.toContain("4111 1111 1111 1111");
  });
});
