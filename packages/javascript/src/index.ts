/**
 * prompt-sanitizer — Lightweight, tiered, bidirectional PII sanitizer for LLM pipelines.
 *
 * @example
 * ```ts
 * import { Sanitizer } from "prompt-sanitizer";
 *
 * const s = new Sanitizer();
 * const result = await s.sanitize("Email me at john@example.com");
 * console.log(result.text);    // redacted
 * console.log(result.tokens);  // { "john@example.com": "..." }
 *
 * // Bidirectional session
 * const session = s.session();
 * const clean = await session.anonymize(userPrompt);
 * const reply = await callLLM(clean);
 * const final = session.deanonymize(reply);
 * ```
 */

export { Sanitizer } from "./sanitizer.js";
export type { SanitizerOptions, OnDetect, AddEntityOptions } from "./sanitizer.js";

export { Session } from "./session.js";
export { Vault } from "./vault.js";
export { Mode } from "./modes.js";
export { EntityType } from "./entities.js";
export { PIIDetectedError, MissingDependencyError } from "./exceptions.js";
export { SyntheticEngine } from "./synthetic.js";
export { RegexEngine } from "./engines/regex-engine.js";
export { SecretsEngine } from "./engines/secrets-engine.js";
export { AuditLog } from "./audit.js";
export type { AuditEvent, ExportOptions } from "./audit.js";

export type { SanitizeResult, DetectedEntity } from "./result.js";
