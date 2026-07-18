import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault } from "../src/vault.js";
import { Sanitizer } from "../src/sanitizer.js";
import { VaultCollisionError } from "../src/exceptions.js";
import {
  InMemoryVaultStore,
  FileVaultStore,
  toVaultSnapshot,
} from "../src/vault-store.js";

describe("Vault counters", () => {
  it("nextCount increments independently per entity type", () => {
    const v = new Vault();
    expect(v.nextCount("PERSON")).toBe(1);
    expect(v.nextCount("PERSON")).toBe(2);
    expect(v.nextCount("EMAIL")).toBe(1);
  });

  it("add() throws VaultCollisionError when a token is claimed by a different original", () => {
    const v = new Vault();
    v.add("alice@example.com", "[EMAIL_1]");
    expect(() => v.add("bob@example.com", "[EMAIL_1]")).toThrow(VaultCollisionError);
  });

  it("add() does not throw when re-adding the same original with the same token", () => {
    const v = new Vault();
    v.add("alice@example.com", "[EMAIL_1]");
    expect(() => v.add("alice@example.com", "[EMAIL_1]")).not.toThrow();
  });

  it("hydrate restores mappings and counters, and reconciles counters from placeholder text", () => {
    const v = new Vault();
    v.hydrate({
      mappings: { "alice@example.com": "[EMAIL_1]", "Bob Smith": "[PERSON_3]" },
      counters: { EMAIL: 1 }, // PERSON counter deliberately omitted
    });
    expect(v.restore("Hi [PERSON_3], email [EMAIL_1]")).toBe("Hi Bob Smith, email alice@example.com");
    // Reconciliation should have bumped PERSON to at least 3 from the mapping text.
    expect(v.nextCount("PERSON")).toBe(4);
    // EMAIL counter was restored explicitly.
    expect(v.nextCount("EMAIL")).toBe(2);
  });

  it("clear() resets counters too", () => {
    const v = new Vault();
    v.nextCount("EMAIL");
    v.clear();
    expect(v.nextCount("EMAIL")).toBe(1);
  });
});

describe("InMemoryVaultStore", () => {
  it("round-trips a snapshot by sessionId", async () => {
    const store = new InMemoryVaultStore();
    const snapshot = toVaultSnapshot("s1", { mappings: { a: "[A_1]" }, counters: { A: 1 } });
    await store.save("s1", snapshot);
    const loaded = await store.load("s1");
    expect(loaded?.mappings).toEqual({ a: "[A_1]" });
    expect(loaded?.counters).toEqual({ A: 1 });
  });

  it("returns undefined for an unknown sessionId", async () => {
    const store = new InMemoryVaultStore();
    expect(await store.load("nope")).toBeUndefined();
  });

  it("delete removes the snapshot", async () => {
    const store = new InMemoryVaultStore();
    await store.save("s1", toVaultSnapshot("s1", { mappings: {}, counters: {} }));
    await store.delete("s1");
    expect(await store.load("s1")).toBeUndefined();
  });
});

describe("FileVaultStore", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("round-trips a snapshot through the filesystem", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-"));
    const store = new FileVaultStore(dir);
    const snapshot = toVaultSnapshot("s1", { mappings: { a: "[A_1]" }, counters: { A: 1 } });
    await store.save("s1", snapshot);
    const loaded = await store.load("s1");
    expect(loaded?.mappings).toEqual({ a: "[A_1]" });
  });

  it("returns undefined when no file exists yet", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-"));
    const store = new FileVaultStore(dir);
    expect(await store.load("never-saved")).toBeUndefined();
  });

  it("does not leak sessionId into a path-traversing filename", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-"));
    const store = new FileVaultStore(dir);
    const evilId = "../../etc/passwd";
    await store.save(evilId, toVaultSnapshot(evilId, { mappings: {}, counters: {} }));
    const entries = await fs.readdir(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });
});

describe("Session persistence — restart simulation", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("a new Sanitizer/Session reattached by sessionId correctly deanonymizes old tokens and never collides on new ones", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-"));
    const store = new FileVaultStore(dir);

    // Process 1: populate + persist.
    const sanitizerA = new Sanitizer();
    const sessionA = await sanitizerA.session("user-42", { store });
    const cleanA = await sessionA.anonymize("Contact alice@example.com");
    const aliceToken = sessionA.mapping["alice@example.com"]!;
    expect(cleanA).not.toContain("alice@example.com");
    await sessionA.persist();

    // Simulate a restart: brand new Sanitizer, brand new Session, same store + id.
    const sanitizerB = new Sanitizer();
    const sessionB = await sanitizerB.session("user-42", { store });

    // Old placeholder text (as if it were still sitting in a stored transcript)
    // must still deanonymize correctly in the new process.
    expect(sessionB.deanonymize(`Reply to ${aliceToken}`)).toContain("alice@example.com");

    // A brand new value detected by the reattached session must never reuse
    // alice's token — this is the counter-collision bug this feature closes.
    const cleanB = await sessionB.anonymize("Contact bob@example.com");
    expect(cleanB).not.toContain("bob@example.com");
    const bobToken = sessionB.mapping["bob@example.com"]!;
    expect(bobToken).not.toBe(aliceToken);

    // Restoring both old and new tokens together must resolve to the right people.
    const combined = sessionB.deanonymize(`${aliceToken} and ${cleanB}`);
    expect(combined).toContain("alice@example.com");
    expect(combined).toContain("bob@example.com");
  });

  it("persist() throws when no store/sessionId were configured", async () => {
    const s = new Sanitizer();
    const session = s.session();
    await expect(session.persist()).rejects.toThrow();
  });
});

describe("Concurrent anonymize() calls on a shared session", () => {
  it("never orphans a replacement for the same new value requested concurrently", async () => {
    const s = new Sanitizer();
    const session = s.session();

    const [textA, textB] = await Promise.all([
      session.anonymize("Contact duplicate@example.com"),
      session.anonymize("Also email duplicate@example.com"),
    ]);

    expect(session.size).toBe(1);
    const token = session.mapping["duplicate@example.com"]!;
    expect(textA).toContain(token);
    expect(textB).toContain(token);
    expect(session.deanonymize(textA)).toContain("duplicate@example.com");
    expect(session.deanonymize(textB)).toContain("duplicate@example.com");
  });
});
