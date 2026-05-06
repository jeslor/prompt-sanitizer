/**
 * Session — bidirectional anonymize/deanonymize for multi-turn LLM workflows.
 *
 * Maintains a shared Vault so the same PII value always maps to the same token
 * within a session, enabling consistent deanonymization of LLM responses.
 *
 * @example
 * ```ts
 * const session = sanitizer.session();
 * const clean = await session.anonymize(userPrompt);
 * const reply = await callLLM(clean);
 * const final = session.deanonymize(reply);
 * ```
 */
import { Vault } from "./vault.js";
import type { SanitizeResult } from "./result.js";
import type { Sanitizer } from "./sanitizer.js";

export class Session {
  private readonly _sanitizer: Sanitizer;
  private readonly _vault: Vault;
  public readonly sessionId: string | undefined;

  constructor(sanitizer: Sanitizer, sessionId?: string) {
    this._sanitizer = sanitizer;
    this._vault = new Vault();
    this.sessionId = sessionId;
  }

  /** Sanitize ``text`` and store replacements in the session vault. */
  async anonymize(text: string): Promise<string> {
    const result = await this._sanitizer._run(text, this._vault, undefined, this.sessionId);
    return result.text;
  }

  /** Like {@link anonymize} but returns the full {@link SanitizeResult}. */
  async anonymizeWithResult(text: string): Promise<SanitizeResult> {
    return this._sanitizer._run(text, this._vault, undefined, this.sessionId);
  }

  /**
   * Restore all known replacement tokens in ``text`` to their originals.
   * Pass the LLM's response here to get readable output.
   */
  deanonymize(text: string): string {
    return this._vault.restore(text);
  }

  /** Clear the vault — start a fresh mapping for this session. */
  reset(): void {
    this._vault.clear();
  }

  /** Number of PII values currently stored in the session vault. */
  get size(): number {
    return this._vault.size;
  }

  /** Snapshot of all original → replacement mappings. */
  get mapping(): Record<string, string> {
    return this._vault.snapshot();
  }
}
