import { describe, it, expect } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";

describe("Session - anonymize/deanonymize round-trip", () => {
  it("restores original email after deanonymize", async () => {
    const s = new Sanitizer();
    const session = s.session();

    const clean = await session.anonymize("Contact alice@example.com soon");
    expect(clean).not.toContain("alice@example.com");

    const restored = session.deanonymize(`I'll reach out via ${Object.values(session.mapping)[0]}`);
    expect(restored).toContain("alice@example.com");
  });

  it("is deterministic — same PII maps to same token across calls", async () => {
    const s = new Sanitizer();
    const session = s.session();

    await session.anonymize("alice@example.com");
    const snap1 = { ...session.mapping };

    await session.anonymize("Please email alice@example.com again");
    const snap2 = { ...session.mapping };

    expect(snap1["alice@example.com"]).toBe(snap2["alice@example.com"]);
  });

  it("tracks size correctly", async () => {
    const s = new Sanitizer();
    const session = s.session();

    await session.anonymize("a@b.com");
    expect(session.size).toBe(1);

    await session.anonymize("c@d.com");
    expect(session.size).toBe(2);
  });

  it("reset clears the vault", async () => {
    const s = new Sanitizer();
    const session = s.session();

    await session.anonymize("x@y.com");
    expect(session.size).toBe(1);

    session.reset();
    expect(session.size).toBe(0);
  });

  it("anonymizeWithResult returns full SanitizeResult", async () => {
    const s = new Sanitizer();
    const session = s.session();

    const result = await session.anonymizeWithResult("SSN: 123-45-6789");
    expect(result.text).not.toContain("123-45-6789");
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it("deanonymize with no vault is a no-op", async () => {
    const s = new Sanitizer();
    const session = s.session();
    expect(session.deanonymize("hello world")).toBe("hello world");
  });

  it("sessionId is stored", () => {
    const s = new Sanitizer();
    const session = s.session("my-session-id");
    expect(session.sessionId).toBe("my-session-id");
  });
});
