/**
 * Tests for:
 *  - AuditLog (JS/TS)
 *  - Sanitizer.addEntity()
 *  - OpenAI integration wrapper
 */

import { describe, it, expect, vi } from "vitest";
import { AuditLog } from "../src/audit.js";
import { Sanitizer } from "../src/sanitizer.js";
import { Mode } from "../src/modes.js";
import { wrap } from "../src/integrations/openai.js";

// ── AuditLog ─────────────────────────────────────────────────────────────────

describe("AuditLog", () => {
  it("starts empty", () => {
    const log = new AuditLog();
    expect(log.size).toBe(0);
    expect(log.events()).toEqual([]);
  });

  it("records an event", () => {
    const log = new AuditLog();
    log.record({
      timestamp: new Date().toISOString(),
      entityType: "EMAIL",
      confidence: 0.99,
      layer: "regex",
      redactionMethod: "synthetic",
      valueHash: "abc12345",
    });
    expect(log.size).toBe(1);
    expect(log.events()[0]!.entityType).toBe("EMAIL");
  });

  it("filters events by since (hours)", async () => {
    const log = new AuditLog();
    // Record one event far in the past
    log.record({
      timestamp: new Date(Date.now() - 48 * 3600_000).toISOString(),
      entityType: "SSN",
      confidence: 0.95,
      layer: "regex",
      redactionMethod: "placeholder",
      valueHash: "deadbeef",
    });
    // Record one event now
    log.record({
      timestamp: new Date().toISOString(),
      entityType: "EMAIL",
      confidence: 0.99,
      layer: "regex",
      redactionMethod: "synthetic",
      valueHash: "cafebabe",
    });

    const recent = log.events("24h");
    expect(recent).toHaveLength(1);
    expect(recent[0]!.entityType).toBe("EMAIL");
  });

  it("exports JSON", () => {
    const log = new AuditLog();
    log.record({
      timestamp: "2026-01-01T00:00:00.000Z",
      entityType: "PHONE",
      confidence: 0.85,
      layer: "regex",
      redactionMethod: "synthetic",
      valueHash: "11223344",
    });
    const json = log.export({ format: "json" });
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].entityType).toBe("PHONE");
  });

  it("exports CSV with header", () => {
    const log = new AuditLog();
    log.record({
      timestamp: "2026-01-01T00:00:00.000Z",
      entityType: "EMAIL",
      confidence: 0.99,
      layer: "regex",
      redactionMethod: "synthetic",
      valueHash: "aabbccdd",
      sessionId: "sess-1",
    });
    const csv = log.export({ format: "csv" });
    const lines = csv.split("\n");
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("entityType");
    expect(lines[1]).toContain("EMAIL");
    expect(lines[1]).toContain("sess-1");
  });

  it("clear() removes all events", () => {
    const log = new AuditLog();
    log.record({
      timestamp: new Date().toISOString(),
      entityType: "EMAIL",
      confidence: 0.99,
      layer: "regex",
      redactionMethod: "synthetic",
      valueHash: "aabbccdd",
    });
    log.clear();
    expect(log.size).toBe(0);
  });
});

// ── Sanitizer.audit integration ───────────────────────────────────────────────

describe("Sanitizer audit integration", () => {
  it("auto-creates AuditLog in FULL mode", async () => {
    const s = new Sanitizer({ mode: Mode.FULL });
    expect(s.audit).toBeInstanceOf(AuditLog);
    await s.sanitize("Contact alice@example.com for details.");
    expect(s.audit!.size).toBeGreaterThan(0);
  });

  it("accepts custom AuditLog", async () => {
    const log = new AuditLog();
    const s = new Sanitizer({ auditLog: log });
    await s.sanitize("SSN: 123-45-6789");
    expect(log.size).toBeGreaterThan(0);
  });

  it("no audit in FAST mode by default", () => {
    const s = new Sanitizer({ mode: Mode.FAST });
    expect(s.audit).toBeNull();
  });

  it("audit=true option creates a MemoryAuditLog", () => {
    const s = new Sanitizer({ auditLog: true });
    expect(s.audit).toBeInstanceOf(AuditLog);
  });

  it("audit events contain correct entityType and never raw value", async () => {
    const log = new AuditLog();
    const s = new Sanitizer({ auditLog: log });
    await s.sanitize("Email: bob@example.com");
    const events = log.events();
    expect(events.some((e) => e.entityType === "EMAIL")).toBe(true);
    // valueHash must not contain the raw email
    expect(events.every((e) => !e.valueHash.includes("bob@example.com"))).toBe(true);
  });
});

// ── Sanitizer.addEntity() ─────────────────────────────────────────────────────

describe("Sanitizer.addEntity()", () => {
  it("detects custom patterns", async () => {
    const s = new Sanitizer();
    s.addEntity("EMPLOYEE_ID", /EMP-\d{6}/g, { confidence: 0.95 });
    const result = await s.sanitize("Employee EMP-123456 submitted a form.");
    expect(result.text).not.toContain("EMP-123456");
    expect(result.entities).toHaveLength(1);
  });

  it("custom entity has CUSTOM type", async () => {
    const s = new Sanitizer();
    s.addEntity("ORDER_ID", /ORD-[A-Z]{3}-\d{4}/g);
    const result = await s.sanitize("Order ORD-XYZ-9876 was shipped.");
    expect(result.entities[0]?.entityType).toBe("CUSTOM");
  });

  it("multiple custom patterns coexist", async () => {
    const s = new Sanitizer();
    s.addEntity("BADGE", /BADGE-\d{4}/g, { confidence: 0.9 });
    s.addEntity("PROJECT", /PROJ-[A-Z]{2}\d{3}/g, { confidence: 0.9 });
    const result = await s.sanitize("BADGE-1234 is working on PROJ-AB123.");
    expect(result.entities).toHaveLength(2);
  });

  it("custom entity with validator filters false positives", async () => {
    const s = new Sanitizer();
    s.addEntity("EVEN_NUM", /\b\d{4}\b/g, {
      confidence: 0.8,
      validator: (m) => parseInt(m) % 2 === 0,
    });
    const result = await s.sanitize("Values: 1234 and 1235");
    // Only 1234 passes validator (even); 1235 (odd) should be filtered
    const values = result.entities.map((e) => e.value);
    expect(values).toContain("1234");
    expect(values).not.toContain("1235");
  });
});

// ── OpenAI wrapper ────────────────────────────────────────────────────────────

describe("wrap() — OpenAI integration", () => {
  it("sanitizes messages before sending and deanonymizes response", async () => {
    const capturedMessages: unknown[] = [];
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn(async (params: Record<string, unknown>) => {
            capturedMessages.push(...(params.messages as unknown[]));
            // Echo back the sanitized content
            const msgs = params.messages as Array<{ content: string }>;
            const content = msgs[msgs.length - 1]?.content ?? "";
            return {
              choices: [{ message: { content } }],
            };
          }),
        },
      },
    };

    const s = new Sanitizer();
    const client = wrap(mockClient as never, s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = client as any;

    const response = await clientAny.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "My email is alice@example.com" }],
    }) as { choices: Array<{ message: { content: string } }> };

    // The message sent to OpenAI should NOT contain the real email
    const sentContent = (capturedMessages[0] as { content: string }).content;
    expect(sentContent).not.toContain("alice@example.com");

    // The response should have the real email restored
    expect(response.choices[0]?.message?.content).toContain("alice@example.com");
  });

  it("passes non-chat attributes through transparently", () => {
    const mockClient = {
      chat: { completions: { create: vi.fn() } },
      models: { list: vi.fn() },
      apiKey: "test-key",
    };

    const s = new Sanitizer();
    const client = wrap(mockClient as never, s) as unknown as typeof mockClient;
    expect(client.models).toBe(mockClient.models);
    expect((client as { apiKey: string }).apiKey).toBe("test-key");
  });

  it("handles streaming mode", async () => {
    const email = "carol@example.com";

    async function* fakeStream() {
      yield { choices: [{ delta: { content: "Contact " } }] };
      yield { choices: [{ delta: { content: email } }] };
      yield { choices: [{ delta: { content: " for help." } }] };
    }

    // We need to first anonymize so the vault has a mapping
    const s = new Sanitizer();
    const sess = s.session();
    const anonymized = await sess.anonymize(`Contact ${email} for help.`);

    // Simulate the LLM echoing back the anonymized text as a stream
    const anonymizedChunks = anonymized.split(" ");
    async function* anonymizedStream() {
      for (const chunk of anonymizedChunks) {
        yield { choices: [{ delta: { content: chunk + " " } }] };
      }
    }

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn(async () => anonymizedStream()),
        },
      },
    };

    const client = wrap(mockClient as never, s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = client as any;
    const stream = await clientAny.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: anonymized }],
      stream: true,
    }) as AsyncIterable<{ choices: Array<{ delta: { content: string } }> }>;

    let accumulated = "";
    for await (const chunk of stream) {
      accumulated += chunk.choices[0]?.delta?.content ?? "";
    }

    expect(accumulated).toContain(email);
  });
});
