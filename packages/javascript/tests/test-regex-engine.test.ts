import { describe, it, expect } from "vitest";
import { RegexEngine } from "../src/engines/regex-engine.js";
import { EntityType } from "../src/entities.js";

function engine() {
  return new RegexEngine();
}

// ── Email ──────────────────────────────────────────────────────────────────────
describe("RegexEngine - Email", () => {
  it("detects simple email", () => {
    const r = engine().detect("Contact john@example.com today");
    const emails = r.filter((e) => e.entityType === EntityType.EMAIL);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.value).toBe("john@example.com");
  });

  it("detects subdomain email", () => {
    const r = engine().detect("mail@mail.corp.example.co.uk please");
    const emails = r.filter((e) => e.entityType === EntityType.EMAIL);
    expect(emails.length).toBeGreaterThanOrEqual(1);
  });

  it("detects plus alias", () => {
    const r = engine().detect("Send to bob+test@gmail.com");
    expect(r.some((e) => e.value === "bob+test@gmail.com")).toBe(true);
  });

  it("does not false-positive on text without @", () => {
    const r = engine().detect("no email here at all");
    expect(r.filter((e) => e.entityType === EntityType.EMAIL)).toHaveLength(0);
  });

  it("detects multiple emails", () => {
    const r = engine().detect("a@b.com and c@d.io");
    const emails = r.filter((e) => e.entityType === EntityType.EMAIL);
    expect(emails.length).toBe(2);
  });
});

// ── Phone ─────────────────────────────────────────────────────────────────────
describe("RegexEngine - Phone", () => {
  it("detects US dashes format", () => {
    const r = engine().detect("Call 555-867-5309");
    expect(r.some((e) => e.entityType === EntityType.PHONE)).toBe(true);
  });

  it("detects US parens format", () => {
    const r = engine().detect("(555) 867-5309");
    expect(r.some((e) => e.entityType === EntityType.PHONE)).toBe(true);
  });

  it("detects international spaced", () => {
    const r = engine().detect("Call +44 20 7946 0958 please");
    expect(r.some((e) => e.entityType === EntityType.PHONE)).toBe(true);
  });

  it("detects E.164", () => {
    const r = engine().detect("+14155552671");
    expect(r.some((e) => e.entityType === EntityType.PHONE)).toBe(true);
  });
});

// ── SSN ───────────────────────────────────────────────────────────────────────
describe("RegexEngine - SSN", () => {
  it("detects dashed SSN", () => {
    const r = engine().detect("My SSN is 123-45-6789");
    expect(r.some((e) => e.entityType === EntityType.SSN)).toBe(true);
  });

  it("does not detect SSN with invalid groups", () => {
    const r = engine().detect("000-45-6789 or 666-45-6789");
    expect(r.filter((e) => e.entityType === EntityType.SSN)).toHaveLength(0);
  });
});

// ── Credit Card ───────────────────────────────────────────────────────────────
describe("RegexEngine - CreditCard", () => {
  it("detects Luhn-valid Visa", () => {
    const r = engine().detect("Card: 4111 1111 1111 1111");
    expect(r.some((e) => e.entityType === EntityType.CREDIT_CARD)).toBe(true);
  });

  it("rejects invalid Luhn", () => {
    const r = engine().detect("Card: 4111 1111 1111 1112");
    expect(r.filter((e) => e.entityType === EntityType.CREDIT_CARD)).toHaveLength(0);
  });

  it("detects Mastercard", () => {
    const r = engine().detect("5500 0000 0000 0004");
    expect(r.some((e) => e.entityType === EntityType.CREDIT_CARD)).toBe(true);
  });
});

// ── IBAN ──────────────────────────────────────────────────────────────────────
describe("RegexEngine - IBAN", () => {
  it("detects valid GB IBAN", () => {
    const r = engine().detect("IBAN: GB29 NWBK 6016 1331 9268 19");
    expect(r.some((e) => e.entityType === EntityType.IBAN)).toBe(true);
  });

  it("rejects invalid IBAN", () => {
    const r = engine().detect("GB00 0000 0000 0000 0000 00");
    expect(r.filter((e) => e.entityType === EntityType.IBAN)).toHaveLength(0);
  });
});

// ── IP Address ────────────────────────────────────────────────────────────────
describe("RegexEngine - IP", () => {
  it("detects IPv4", () => {
    const r = engine().detect("Server at 192.168.1.100");
    expect(r.some((e) => e.entityType === EntityType.IP_ADDRESS)).toBe(true);
  });
});

// ── MAC Address ───────────────────────────────────────────────────────────────
describe("RegexEngine - MAC", () => {
  it("detects colon-separated MAC", () => {
    const r = engine().detect("MAC: 00:1A:2B:3C:4D:5E");
    expect(r.some((e) => e.entityType === EntityType.MAC_ADDRESS)).toBe(true);
  });
});

// ── URL ───────────────────────────────────────────────────────────────────────
describe("RegexEngine - URL", () => {
  it("detects https URL", () => {
    const r = engine().detect("See https://example.com/path?q=1");
    expect(r.some((e) => e.entityType === EntityType.URL)).toBe(true);
  });
});

// ── Crypto ────────────────────────────────────────────────────────────────────
describe("RegexEngine - Crypto", () => {
  it("detects Ethereum address", () => {
    const r = engine().detect("Wallet: 0xAbCdEf0123456789AbCdEf0123456789AbCdEf01");
    expect(r.some((e) => e.entityType === EntityType.CRYPTO_ADDRESS)).toBe(true);
  });
});

// ── Custom pattern ────────────────────────────────────────────────────────────
describe("RegexEngine - Custom pattern", () => {
  it("adds and detects custom pattern", () => {
    const e = engine();
    e.addPattern(EntityType.PERSON_NAME, /\bEMPLOYEE-\d{4}\b/g, 0.90);
    const r = e.detect("ID: EMPLOYEE-1234 is here");
    expect(r.some((e) => e.value === "EMPLOYEE-1234")).toBe(true);
  });
});
