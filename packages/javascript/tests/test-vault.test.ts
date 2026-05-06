import { describe, it, expect } from "vitest";
import { Vault } from "../src/vault.js";

describe("Vault", () => {
  it("stores and restores a mapping", () => {
    const v = new Vault();
    v.add("alice@example.com", "[EMAIL_1]");
    expect(v.restore("Send to [EMAIL_1] asap")).toBe("Send to alice@example.com asap");
  });

  it("is deterministic — same original returns same replacement", () => {
    const v = new Vault();
    v.add("alice@example.com", "[EMAIL_1]");
    const second = v.add("alice@example.com", "[EMAIL_DIFFERENT]");
    expect(second).toBe("[EMAIL_1]");
  });

  it("tracks size correctly", () => {
    const v = new Vault();
    v.add("a@b.com", "[E1]");
    v.add("c@d.com", "[E2]");
    expect(v.size).toBe(2);
  });

  it("getReplacement returns correct value", () => {
    const v = new Vault();
    v.add("secret", "[S1]");
    expect(v.getReplacement("secret")).toBe("[S1]");
    expect(v.getReplacement("unknown")).toBeUndefined();
  });

  it("getOriginal returns correct value", () => {
    const v = new Vault();
    v.add("original", "[TOKEN]");
    expect(v.getOriginal("[TOKEN]")).toBe("original");
  });

  it("has() works for both directions", () => {
    const v = new Vault();
    v.add("val", "[T]");
    expect(v.has("val")).toBe(true);
    expect(v.has("[T]")).toBe(true);
    expect(v.has("other")).toBe(false);
  });

  it("restores longest token first to avoid partial replacement", () => {
    const v = new Vault();
    v.add("email1@example.com", "[EMAIL_1]");
    v.add("email10@example.com", "[EMAIL_10]");
    const restored = v.restore("Send [EMAIL_10] and [EMAIL_1]");
    expect(restored).toBe("Send email10@example.com and email1@example.com");
  });

  it("restore returns unchanged text when no tokens match", () => {
    const v = new Vault();
    expect(v.restore("no tokens here")).toBe("no tokens here");
  });

  it("snapshot returns all mappings", () => {
    const v = new Vault();
    v.add("a@b.com", "[E1]");
    v.add("c@d.com", "[E2]");
    const snap = v.snapshot();
    expect(snap["a@b.com"]).toBe("[E1]");
    expect(snap["c@d.com"]).toBe("[E2]");
  });

  it("clear removes all mappings", () => {
    const v = new Vault();
    v.add("x", "[X]");
    v.clear();
    expect(v.size).toBe(0);
    expect(v.restore("[X]")).toBe("[X]");
  });
});
