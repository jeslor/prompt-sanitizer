/**
 * Next.js middleware integration for prompt-sanitizer.
 *
 * Edge-compatible: uses only the Web Fetch API (Request/Response) —
 * no Node.js-specific APIs.  Drop this into your `middleware.ts` file.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { Sanitizer } from "prompt-sanitizer";
 * import { createNextjsMiddleware } from "prompt-sanitizer/integrations/nextjs";
 *
 * const sanitizer = new Sanitizer();
 * export default createNextjsMiddleware(sanitizer, { routes: ["/api/chat"] });
 *
 * export const config = { matcher: ["/api/:path*"] };
 * ```
 */

import type { Sanitizer } from "../sanitizer.js";

export interface NextjsMiddlewareOptions {
  /** Path prefixes to intercept. Default: intercepts all requests. */
  routes?: string[];
  /** Body fields to sanitize. Default: `["prompt", "messages", "input", "query", "content", "text"]`. */
  fields?: string[];
}

// ── Minimal Web-API types (already available in edge runtime) ─────────────

type NextMiddlewareFn = (request: Request) => Promise<Response> | Response;

const DEFAULT_FIELDS = ["prompt", "messages", "input", "query", "content", "text"];

// ── Helpers ────────────────────────────────────────────────────────────────

function pathMatches(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname.startsWith(r));
}

async function sanitizeBodyFields(
  sanitizer: Sanitizer,
  body: Record<string, unknown>,
  fields: string[]
): Promise<{ sanitized: Record<string, unknown>; session: import("../session.js").Session }> {
  const session = sanitizer.session();
  const result: Record<string, unknown> = { ...body };

  for (const field of fields) {
    const val = body[field];
    if (typeof val === "string") {
      result[field] = await session.anonymize(val);
    } else if (Array.isArray(val)) {
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

  return { sanitized: result, session };
}

function restoreResponseBody(
  session: import("../session.js").Session,
  body: unknown
): unknown {
  if (typeof body === "string") return session.deanonymize(body);
  if (body === null || typeof body !== "object") return body;
  if (Array.isArray(body)) return body.map((i) => restoreResponseBody(session, i));
  const obj = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = restoreResponseBody(session, v);
  return out;
}

// ── Middleware factory ─────────────────────────────────────────────────────

/**
 * Creates an edge-compatible Next.js middleware function that sanitizes
 * PII from inbound request bodies and restores it in outbound responses.
 *
 * @param sanitizer - Configured {@link Sanitizer} instance.
 * @param options - Route filtering and field selection.
 */
export function createNextjsMiddleware(
  sanitizer: Sanitizer,
  options: NextjsMiddlewareOptions = {}
): NextMiddlewareFn {
  const fields = options.fields ?? DEFAULT_FIELDS;
  const routes = options.routes;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Skip non-matching routes
    if (routes && !pathMatches(url.pathname, routes)) {
      return fetch(request);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return fetch(request);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fetch(request);
    }

    const { sanitized, session } = await sanitizeBodyFields(sanitizer, body, fields);

    // Rebuild the request with sanitized body
    const sanitizedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(sanitized),
      // @ts-expect-error – duplex is required in some edge runtimes
      duplex: "half",
    });

    const response = await fetch(sanitizedRequest);

    // Restore PII in the response
    const respContentType = response.headers.get("content-type") ?? "";
    if (!respContentType.includes("application/json")) {
      return response;
    }

    const respBody = await response.json();
    const restored = restoreResponseBody(session, respBody);

    return new Response(JSON.stringify(restored), {
      status: response.status,
      headers: response.headers,
    });
  };
}

/**
 * Route matcher config helper.
 * Pass the returned object as `export const config` in your middleware.ts.
 *
 * @example
 * ```ts
 * export const config = matcherConfig(["/api/chat", "/api/completion"]);
 * ```
 */
export function matcherConfig(routes: string[]): { matcher: string[] } {
  return { matcher: routes };
}
