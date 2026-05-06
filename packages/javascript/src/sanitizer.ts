/**
 * Core Sanitizer class — main public API.
 *
 * Orchestrates all detection engines, deduplication, replacement,
 * vault storage, and the @guard decorator pattern.
 */
import { EntityType } from "./entities.js";
import { PIIDetectedError } from "./exceptions.js";
import { RegexEngine } from "./engines/regex-engine.js";
import { SecretsEngine } from "./engines/secrets-engine.js";
import { SyntheticEngine } from "./synthetic.js";
import { Vault } from "./vault.js";
import { Mode } from "./modes.js";
import { Session } from "./session.js";
import type { DetectedEntity, SanitizeResult } from "./result.js";

export type OnDetect = "redact" | "warn" | "block";

export interface SanitizerOptions {
  mode?: Mode;
  locale?: string;
  entities?: EntityType[];
  onDetect?: OnDetect;
}

// ── Span deduplication ────────────────────────────────────────────────────────

function deduplicate(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length === 0) return entities;

  const ranked = [...entities].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.end - b.start) - (a.end - a.start);
  });

  const kept: DetectedEntity[] = [];
  const spans: Array<[number, number]> = [];

  for (const entity of ranked) {
    const overlaps = spans.some(
      ([s, e]) => !(entity.end <= s || entity.start >= e)
    );
    if (!overlaps) {
      kept.push(entity);
      spans.push([entity.start, entity.end]);
    }
  }

  return kept.sort((a, b) => a.start - b.start);
}

// ── Risk score ────────────────────────────────────────────────────────────────

function computeScore(entities: DetectedEntity[]): number {
  if (entities.length === 0) return 0;
  const maxConf = Math.max(...entities.map((e) => e.confidence));
  const spread = Math.min(1, entities.length / 5);
  return Math.round(Math.min(1, maxConf * 0.7 + spread * 0.3) * 100) / 100;
}

// ── Sanitizer ─────────────────────────────────────────────────────────────────

export class Sanitizer {
  private readonly _mode: Mode;
  private readonly _entities: Set<EntityType> | null;
  private readonly _onDetect: OnDetect;
  private readonly _regexEngine: RegexEngine;
  private readonly _secretsEngine: SecretsEngine;
  private readonly _syntheticEngine: SyntheticEngine;

  constructor(options: SanitizerOptions = {}) {
    this._mode = options.mode ?? Mode.FAST;
    this._entities = options.entities ? new Set(options.entities) : null;
    this._onDetect = options.onDetect ?? "redact";
    this._regexEngine = new RegexEngine();
    this._secretsEngine = new SecretsEngine();
    this._syntheticEngine = new SyntheticEngine();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Sanitize a string, returning a {@link SanitizeResult}. */
  async sanitize(text: string): Promise<SanitizeResult> {
    const vault = new Vault();
    return this._run(text, vault);
  }

  /** Sanitize an array of strings. */
  async sanitizeBatch(texts: string[]): Promise<SanitizeResult[]> {
    return Promise.all(texts.map((t) => this.sanitize(t)));
  }

  /**
   * Create a {@link Session} for multi-turn anonymize/deanonymize workflows.
   * The session maintains a shared vault so tokens are consistent across calls.
   */
  session(sessionId?: string): Session {
    return new Session(this, sessionId);
  }

  /**
   * Decorator / higher-order function that wraps any async function,
   * sanitizing all string arguments before the function is called.
   *
   * @example
   * ```ts
   * const callLLM = sanitizer.guard(async (prompt: string) => {
   *   return openai.chat.completions.create({ messages: [{ role: "user", content: prompt }] });
   * });
   * ```
   */
  guard<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    onDetect: OnDetect = this._onDetect
  ): T {
    const self = this;
    return (async (...args: any[]) => {
      const sanitizedArgs = await Promise.all(
        args.map(async (arg) => {
          if (typeof arg !== "string") return arg;
          const result = await self._runWithMode(arg, new Vault(), onDetect);
          return result.text;
        })
      );
      return fn(...sanitizedArgs);
    }) as T;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /** Internal run — used by both sanitize() and Session. */
  async _run(
    text: string,
    vault: Vault,
    onDetect?: OnDetect,
    sessionId?: string
  ): Promise<SanitizeResult> {
    return this._runWithMode(text, vault, onDetect ?? this._onDetect, sessionId);
  }

  private async _runWithMode(
    text: string,
    vault: Vault,
    onDetect: OnDetect,
    _sessionId?: string
  ): Promise<SanitizeResult> {
    // Collect entities from all active engines
    let entities: DetectedEntity[] = [
      ...this._regexEngine.detect(text),
      ...this._secretsEngine.detect(text),
    ];

    // Filter to requested entity types
    if (this._entities) {
      entities = entities.filter((e) => this._entities!.has(e.entityType));
    }

    // Deduplicate overlapping spans
    entities = deduplicate(entities);

    const score = computeScore(entities);

    // "warn" mode: return original text + entity list
    if (onDetect === "warn") {
      return { text, original: text, entities, tokens: {}, score };
    }

    // "block" mode: raise if any PII found
    if (onDetect === "block") {
      if (entities.length > 0) {
        throw new PIIDetectedError(
          `PII detected: ${entities.map((e) => e.entityType).join(", ")}`,
          entities
        );
      }
      return { text, original: text, entities: [], tokens: {}, score: 0 };
    }

    // "redact" mode: replace PII with synthetic values
    const tokens: Record<string, string> = {};
    let result = text;

    // Process right-to-left to preserve character offsets
    for (const entity of [...entities].reverse()) {
      let replacement = vault.getReplacement(entity.value);
      if (!replacement) {
        replacement = await this._syntheticEngine.generate(entity.entityType);
        vault.add(entity.value, replacement);
      }
      tokens[entity.value] = replacement;
      result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
    }

    return { text: result, original: text, entities, tokens, score };
  }
}
