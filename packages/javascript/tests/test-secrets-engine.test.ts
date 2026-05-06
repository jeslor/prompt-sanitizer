import { describe, it, expect } from "vitest";
import { SecretsEngine } from "../src/engines/secrets-engine.js";
import { EntityType } from "../src/entities.js";

function engine() {
  return new SecretsEngine();
}

describe("SecretsEngine - JWT", () => {
  it("detects JWT token", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const r = engine().detect(`Token: ${token}`);
    expect(r.some((e) => e.entityType === EntityType.JWT_TOKEN)).toBe(true);
  });
});

describe("SecretsEngine - AWS", () => {
  it("detects AWS access key ID", () => {
    const r = engine().detect("AKIAIOSFODNN7EXAMPLE");
    expect(r.some((e) => e.entityType === EntityType.AWS_KEY)).toBe(true);
  });

  it("detects AWS secret key assignment", () => {
    const r = engine().detect("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(r.some((e) => e.entityType === EntityType.AWS_KEY)).toBe(true);
  });
});

describe("SecretsEngine - GitHub", () => {
  it("detects GitHub PAT", () => {
    const r = engine().detect("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890");
    expect(r.some((e) => e.entityType === EntityType.OAUTH_TOKEN)).toBe(true);
  });
});

describe("SecretsEngine - Stripe", () => {
  it("detects Stripe live key", () => {
    const r = engine().detect(["sk_live_","ABCDEFGHIJKLMNOPQRSTUVWXYZab"].join(""));
    expect(r.some((e) => e.entityType === EntityType.API_KEY)).toBe(true);
  });

  it("detects Stripe test key", () => {
    const r = engine().detect(["sk_test_","ABCDEFGHIJKLMNOPQRSTUVWXYZab"].join(""));
    expect(r.some((e) => e.entityType === EntityType.API_KEY)).toBe(true);
  });
});

describe("SecretsEngine - Google", () => {
  it("detects Google API key", () => {
    const r = engine().detect("AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe");
    expect(r.some((e) => e.entityType === EntityType.API_KEY)).toBe(true);
  });
});

describe("SecretsEngine - Database", () => {
  it("detects postgres URL", () => {
    const r = engine().detect("postgresql://user:pass@localhost:5432/mydb");
    expect(r.some((e) => e.entityType === EntityType.DATABASE_URL)).toBe(true);
  });

  it("detects mongodb URL", () => {
    const r = engine().detect("mongodb+srv://user:pass@cluster.mongodb.net/db");
    expect(r.some((e) => e.entityType === EntityType.DATABASE_URL)).toBe(true);
  });
});

describe("SecretsEngine - Bearer token", () => {
  it("detects Authorization Bearer header", () => {
    const r = engine().detect("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstu");
    expect(r.some((e) => e.entityType === EntityType.OAUTH_TOKEN)).toBe(true);
  });
});

describe("SecretsEngine - PEM key", () => {
  it("detects PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const r = engine().detect(pem);
    expect(r.some((e) => e.entityType === EntityType.PRIVATE_KEY)).toBe(true);
  });
});
