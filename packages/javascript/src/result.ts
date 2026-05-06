import type { EntityType } from "./entities.js";

/** A single detected PII span within the input text. */
export interface DetectedEntity {
  entityType: EntityType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  /** Which engine detected this: "regex" | "secrets" | "ner" */
  layer: string;
  /** The replacement token/value that will be substituted */
  replacement?: string;
}

/** Result returned from every sanitize() call. */
export interface SanitizeResult {
  /** The sanitized text with PII replaced. */
  text: string;
  /** The original unmodified text. */
  original: string;
  /** All detected entities (sorted by position). */
  entities: DetectedEntity[];
  /**
   * Mapping of original PII value → replacement token.
   * Populated in "redact" mode; empty in "warn" mode.
   */
  tokens: Record<string, string>;
  /** Aggregate risk score 0–1 based on detected entities. */
  score: number;
}
