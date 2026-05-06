/**
 * Tests for the Express / Hono middleware integration.
 * No real server is started — middleware functions are called directly.
 */
import { describe, it, expect, vi } from "vitest";
import { Sanitizer } from "../src/sanitizer.js";
import { createExpressMiddleware } from "../src/integrations/express.js";
import type { ExpressRequest, ExpressResponse } from "../src/integrations/express.js";

// ── Mock helpers ──────────────────────────────────────────────────────────

function makeReq(overrides: Partial<ExpressRequest> = {}): ExpressRequest {
  return { path: "/api/chat", method: "POST", body: undefined, ...overrides };
}

function makeRes(): ExpressResponse & { _json: unknown; _sent: unknown } {
  const res = {
    _json: undefined as unknown,
    _sent: undefined as unknown,
    json(body: unknown) {
      this._json = body;
      return this;
    },
    send(body: unknown) {
      this._sent = body;
      return this;
    },
    status(code: number) {
      return this;
    },
  } as ExpressResponse & { _json: unknown; _sent: unknown };
  // bind so `this` works in replacements
  res.json = res.json.bind(res);
  res.send = res.send.bind(res);
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createExpressMiddleware", () => {
  it("sanitizes prompt field in request body", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer);
    const next = vi.fn();

    const req = makeReq({ body: { prompt: "My email is alice@example.com" } });
    const res = makeRes();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req.body as any).prompt).not.toContain("alice@example.com");
  });

  it("sanitizes messages array", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer);
    const next = vi.fn();

    const req = makeReq({
      body: {
        messages: [
          { role: "user", content: "Call me at 555-123-4567" },
          { role: "system", content: "Be helpful" },
        ],
      },
    });
    const res = makeRes();

    await middleware(req, res, next);

    const messages = (req.body as any).messages as any[];
    expect(messages[0].content).not.toContain("555-123-4567");
    expect(messages[1].content).toBe("Be helpful");
  });

  it("restores PII in JSON response via res.json()", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer);
    const next = vi.fn();

    const req = makeReq({ body: { prompt: "My email is alice@example.com" } });
    const res = makeRes();

    await middleware(req, res, next);

    // Simulate the route handler calling res.json with a response containing the vault token
    const token = Object.values(
      (sanitizer as any)._syntheticEngine
        ? {}
        : {}
    );
    // Instead, use the token from the request body
    const sanitizedPrompt = (req.body as any).prompt as string;
    // Extract the token by finding what replaced the email
    const emailToken = sanitizedPrompt.replace("My email is ", "").trim();

    res.json({ reply: `I see your email is ${emailToken}` });
    expect((res._json as any).reply).toContain("alice@example.com");
  });

  it("passes through routes not in the routes filter", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer, { routes: ["/api/chat"] });
    const next = vi.fn();

    const req = makeReq({ path: "/api/other", body: { prompt: "alice@example.com" } });
    const res = makeRes();

    await middleware(req, res, next);

    // Body should be untouched since path doesn't match
    expect((req.body as any).prompt).toContain("alice@example.com");
  });

  it("calls next() with matched route", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer, { routes: ["/api"] });
    const next = vi.fn();

    const req = makeReq({ path: "/api/chat", body: { prompt: "hello" } });
    const res = makeRes();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("sanitizes custom fields", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer, { fields: ["userInput"] });
    const next = vi.fn();

    const req = makeReq({ body: { userInput: "SSN: 123-45-6789", prompt: "untouched" } });
    const res = makeRes();

    await middleware(req, res, next);

    expect((req.body as any).userInput).not.toContain("123-45-6789");
    // "prompt" is not in custom fields list — should stay as-is
    expect((req.body as any).prompt).toBe("untouched");
  });

  it("restores PII in string response via res.send()", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer);
    const next = vi.fn();

    const req = makeReq({ body: { prompt: "My email is bob@test.com" } });
    const res = makeRes();

    await middleware(req, res, next);

    const sanitizedPrompt = (req.body as any).prompt as string;
    const token = sanitizedPrompt.replace("My email is ", "").trim();

    res.send(`Email: ${token}`);
    expect(res._sent as string).toContain("bob@test.com");
  });

  it("handles missing body gracefully", async () => {
    const sanitizer = new Sanitizer();
    const middleware = createExpressMiddleware(sanitizer);
    const next = vi.fn();

    const req = makeReq({ body: undefined });
    const res = makeRes();

    await expect(middleware(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
