/**
 * Audit Log for prompt-sanitizer (JavaScript/TypeScript).
 *
 * Provides structured, compliance-ready event logging for every PII detection.
 * Raw PII values are NEVER stored — only a truncated FNV-1a hash.
 *
 * @example
 * ```ts
 * import { Sanitizer, Mode } from "prompt-sanitizer";
 * import { AuditLog } from "prompt-sanitizer";
 *
 * const log = new AuditLog();
 * const s = new Sanitizer({ mode: Mode.FULL, auditLog: log });
 *
 * await s.sanitize("Email me at alice@example.com");
 *
 * console.log(log.export({ format: "json", since: "1h" }));
 * ```
 */

export interface AuditEvent {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** EntityType label, e.g. "EMAIL", "SSN". */
  entityType: string;
  /** Detection confidence (0–1). */
  confidence: number;
  /** Detection layer: "regex" | "secrets" | "ner". */
  layer: string;
  /** How the value was replaced: "synthetic" | "placeholder". */
  redactionMethod: string;
  /** Truncated FNV-1a hash of the original value — never the raw PII. */
  valueHash: string;
  /** Optional session identifier for multi-turn tracking. */
  sessionId?: string;
}

export interface ExportOptions {
  /** Output format. Default: "json". */
  format?: "json" | "csv";
  /**
   * Only include events after this cutoff.
   * Accepts: "Nd" (days), "Nh" (hours), "Nm" (minutes), ISO timestamp, or Date.
   * Default: all events.
   */
  since?: string | Date;
}

// ── Hash helper ───────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — deterministic, synchronous, zero deps.
 * Sufficient for audit tracking; not for cryptographic use.
 */
function hashValue(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ── Since parser ──────────────────────────────────────────────────────────────

function parseSince(since: string | Date): Date {
  if (since instanceof Date) return since;
  if (/^\d+d$/i.test(since)) {
    return new Date(Date.now() - parseInt(since) * 86_400_000);
  }
  if (/^\d+h$/i.test(since)) {
    return new Date(Date.now() - parseInt(since) * 3_600_000);
  }
  if (/^\d+m$/i.test(since)) {
    return new Date(Date.now() - parseInt(since) * 60_000);
  }
  return new Date(since);
}

// ── AuditLog ──────────────────────────────────────────────────────────────────

/**
 * In-memory audit log that records every PII detection event.
 *
 * Pass an instance to {@link Sanitizer} via `options.auditLog`, or when
 * `mode = Mode.FULL` a default `AuditLog` is created automatically.
 */
export class AuditLog {
  private _events: AuditEvent[] = [];

  /** Record a new audit event. Called internally by the Sanitizer. */
  record(event: AuditEvent): void {
    this._events.push(event);
  }

  /**
   * Return all recorded events, optionally filtered to those after `since`.
   */
  events(since?: string | Date): AuditEvent[] {
    if (!since) return [...this._events];
    const cutoff = parseSince(since);
    // 1-second grace buffer to avoid sub-millisecond race conditions
    const grace = new Date(cutoff.getTime() - 1000);
    return this._events.filter((e) => new Date(e.timestamp) >= grace);
  }

  /**
   * Export events as JSON or CSV.
   *
   * @example
   * ```ts
   * // GDPR compliance report for last 30 days
   * const report = log.export({ format: "csv", since: "30d" });
   * ```
   */
  export(options: ExportOptions = {}): string {
    const { format = "json", since } = options;
    const evts = since ? this.events(since) : this.events();

    if (format === "csv") {
      const header = "timestamp,entityType,confidence,layer,redactionMethod,valueHash,sessionId";
      const rows = evts.map((e) =>
        [
          e.timestamp,
          e.entityType,
          e.confidence.toFixed(4),
          e.layer,
          e.redactionMethod,
          e.valueHash,
          e.sessionId ?? "",
        ].join(",")
      );
      return [header, ...rows].join("\n");
    }

    return JSON.stringify(evts, null, 2);
  }

  /** Remove all recorded events. */
  clear(): void {
    this._events = [];
  }

  /** Total number of events recorded. */
  get size(): number {
    return this._events.length;
  }
}

// ── Internal helpers (used by Sanitizer) ─────────────────────────────────────

/** @internal */
export function _hashValue(value: string): string {
  return hashValue(value);
}

/** @internal */
export function _nowIso(): string {
  return new Date().toISOString();
}
