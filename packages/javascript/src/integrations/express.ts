/**
 * Express / Hono middleware for prompt-sanitizer.
 *
 * Intercepts request bodies, sanitizes any string fields that look like
 * LLM prompts (`messages`, `prompt`, `input`, `query`), then restores PII
 * in the response body before it reaches the client.
 *
 * Works with Express 4/5 and Hono (structurally compatible middleware shapes).
 *
 * @example — Express
 * ```ts
 * import express from "express";
 * import { Sanitizer } from "prompt-sanitizer";
 * import { createExpressMiddleware } from "prompt-sanitizer/integrations/express";
 *
 * const app = express();
 * app.use(express.json());
 * app.use(createExpressMiddleware(new Sanitizer()));
 * ```
 *
 * @example — Hono
 * ```ts
 * import { Hono } from "hono";
 * import { Sanitizer } from "prompt-sanitizer";
 * import { createHonoMiddleware } from "prompt-sanitizer/integrations/express";
 *
 * const app = new Hono();
 * app.use("*", createHonoMiddleware(new Sanitizer()));
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";
import type { Session } from "../session.js";

// ── Minimal structural types (no hard SDK deps) ────────────────────────────

export interface ExpressRequest {
  body?: unknown;
  path?: string;
  method?: string;
  [key: string]: unknown;
}

export interface ExpressResponse {
  json: (body: unknown) => void;
  send: (body: unknown) => void;
  status: (code: number) => ExpressResponse;
  [key: string]: unknown;
}

export type ExpressNextFn = (err?: unknown) => void;

export type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNextFn
) => void | Promise<void>;

export interface MiddlewareOptions {
  /** Only sanitize requests matching these path prefixes. Default: all paths. */
  routes?: string[];
  /** Fields in the request body to sanitize. Default: `["prompt", "messages", "input", "query"]`. */
  fields?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_FIELDS = ["prompt", "messages", "input", "query", "content", "text"];

async function sanitizeBody(session: Session, body: unknown, fields: string[]): Promise<unknown> {
  if (body === null || typeof body !== "object") return body;

  const obj = body as Record<string, unknown>;
  const result: Record<string, unknown> = { ...obj };

  for (const field of fields) {
    const val = obj[field];
    if (typeof val === "string") {
      result[field] = await session.anonymize(val);
    } else if (Array.isArray(val)) {
      // Handle OpenAI-style messages array
      result[field] = await Promise.all(
        val.map(async (item: unknown) => {
          if (item && typeof item === "object" && "content" in item) {
            const msg = item as Record<string, unknown>;
            if (typeof msg.content === "string") {
              return { ...msg, content: await session.anonymize(msg.content) };
            }
          }
          return item;
        })
      );
    }
  }

  return result;
}

function restoreBody(session: Session, body: unknown): unknown {
  if (typeof body === "string") {
    return session.deanonymize(body);
  }
  if (body === null || typeof body !== "object") return body;
  if (Array.isArray(body)) {
    return body.map((item) => restoreBody(session, item));
  }
  const obj = body as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = restoreBody(session, val);
  }
  return result;
}

function pathMatches(path: string | undefined, routes: string[]): boolean {
  if (!path) return true;
  return routes.some((r) => path.startsWith(r));
}

// ── Express middleware ─────────────────────────────────────────────────────

/**
 * Creates an Express middleware that sanitizes request bodies and restores
 * PII in response bodies for matched routes.
 */
export function createExpressMiddleware(
  sanitizer: Sanitizer,
  options: MiddlewareOptions = {}
): ExpressMiddleware {
  const fields = options.fields ?? DEFAULT_FIELDS;
  const routes = options.routes;

  return async (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFn) => {
    if (routes && !pathMatches(req.path, routes)) {
      return next();
    }

    const session = sanitizer.session();

    // Sanitize request body
    if (req.body) {
      req.body = await sanitizeBody(session, req.body, fields);
    }

    // Intercept response.json to restore PII
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      return originalJson(restoreBody(session, body));
    };

    // Intercept response.send for string responses
    const originalSend = res.send.bind(res);
    res.send = (body: unknown) => {
      if (typeof body === "string") {
        return originalSend(session.deanonymize(body));
      }
      return originalSend(body);
    };

    return next();
  };
}

// ── Hono middleware ────────────────────────────────────────────────────────

export interface HonoContext {
  req: {
    json: () => Promise<unknown>;
    path: string;
    method: string;
    [key: string]: unknown;
  };
  json: (body: unknown, status?: number) => Response | Promise<Response>;
  [key: string]: unknown;
}

export type HonoNext = () => Promise<Response | void>;
export type HonoMiddleware = (c: HonoContext, next: HonoNext) => Promise<Response | void>;

/**
 * Creates a Hono middleware that sanitizes request bodies and restores
 * PII in response bodies for matched routes.
 */
export function createHonoMiddleware(
  sanitizer: Sanitizer,
  options: MiddlewareOptions = {}
): HonoMiddleware {
  const fields = options.fields ?? DEFAULT_FIELDS;
  const routes = options.routes;

  return async (c: HonoContext, next: HonoNext) => {
    if (routes && !pathMatches(c.req.path, routes)) {
      return next();
    }

    const session = sanitizer.session();
    let rawBody: unknown;

    try {
      rawBody = await c.req.json();
    } catch {
      return next();
    }

    const sanitizedBody = await sanitizeBody(session, rawBody, fields);

    // Re-bind json so downstream handlers read sanitized body
    const originalJson = c.req.json.bind(c.req);
    (c.req as Record<string, unknown>).json = async () => sanitizedBody;

    const response = await next();

    // Restore original json getter
    (c.req as Record<string, unknown>).json = originalJson;

    return response;
  };
}
