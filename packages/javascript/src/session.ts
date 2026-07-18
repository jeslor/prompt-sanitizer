/**
 * Session — bidirectional anonymize/deanonymize for multi-turn LLM workflows.
 *
 * Maintains a shared Vault so the same PII value always maps to the same token
 * within a session, enabling consistent deanonymization of LLM responses.
 *
 * By default a Session's vault lives only in process memory. Pass a
 * `VaultStore` (see vault-store.ts) to `Sanitizer.session()` to persist it
 * and reattach to the same mapping later — e.g. after a process restart —
 * by `sessionId`.
 *
 * @example
 * ```ts
 * const session = sanitizer.session();
 * const clean = await session.anonymize(userPrompt);
 * const reply = await callLLM(clean);
 * const final = session.deanonymize(reply);
 * ```
 *
 * @example Persisted, reattachable session
 * ```ts
 * const store = new FileVaultStore("./vault-data");
 * const session = await sanitizer.session("user-42", { store });
 * const clean = await session.anonymize(userPrompt);
 * await session.persist();
 * // ...later, possibly in a new process:
 * const resumed = await sanitizer.session("user-42", { store });
 * const final = resumed.deanonymize(llmReply);
 * ```
 */
import { Vault } from "./vault.js";
import { VaultStoreError } from "./exceptions.js";
import {
  assertSupportedVersion,
  toVaultSnapshot,
  type VaultStore,
} from "./vault-store.js";
import type { SanitizeResult } from "./result.js";
import type { Sanitizer } from "./sanitizer.js";

export interface SessionStoreOptions {
  /** Backing store used to load/save this session's vault. */
  store: VaultStore;
  /** If true, persist to the store at the end of every `anonymize()` call. Default: false (call `persist()` explicitly). */
  autoPersist?: boolean;
}

export class Session {
  private readonly _sanitizer: Sanitizer;
  private readonly _vault: Vault;
  public readonly sessionId: string | undefined;
  private readonly _store: VaultStore | undefined;
  private readonly _autoPersist: boolean;

  constructor(sanitizer: Sanitizer, sessionId?: string, options?: SessionStoreOptions) {
    this._sanitizer = sanitizer;
    this._vault = new Vault();
    this.sessionId = sessionId;
    this._store = options?.store;
    this._autoPersist = options?.autoPersist ?? false;
  }

  /**
   * Load this session's persisted vault (if any) from its store.
   * Called by `Sanitizer.session()` before handing back the Session; the
   * returned Session is always fully hydrated, never called directly.
   * @internal
   */
  async _hydrate(): Promise<void> {
    if (!this._store || this.sessionId === undefined) return;
    const snapshot = await this._store.load(this.sessionId);
    if (!snapshot) return;
    assertSupportedVersion(snapshot);
    this._vault.hydrate(snapshot);
  }

  /** Sanitize ``text`` and store replacements in the session vault. */
  async anonymize(text: string): Promise<string> {
    const result = await this._sanitizer._run(text, this._vault, undefined, this.sessionId);
    if (this._autoPersist) await this.persist();
    return result.text;
  }

  /** Like {@link anonymize} but returns the full {@link SanitizeResult}. */
  async anonymizeWithResult(text: string): Promise<SanitizeResult> {
    const result = await this._sanitizer._run(text, this._vault, undefined, this.sessionId);
    if (this._autoPersist) await this.persist();
    return result;
  }

  /**
   * Restore all known replacement tokens in ``text`` to their originals.
   * Pass the LLM's response here to get readable output.
   */
  deanonymize(text: string): string {
    return this._vault.restore(text);
  }

  /**
   * Persist the current vault state to this session's store.
   *
   * Throws {@link VaultStoreError} if this session wasn't created with both
   * a `sessionId` and a `store`.
   */
  async persist(): Promise<void> {
    if (!this._store || this.sessionId === undefined) {
      throw new VaultStoreError(
        "Session.persist() requires both a sessionId and a store to have " +
          "been passed to Sanitizer.session().",
      );
    }
    await this._store.save(this.sessionId, toVaultSnapshot(this.sessionId, this._vault.toData()));
  }

  /**
   * Delete this session's persisted snapshot from its store, if any.
   * Does not clear the in-memory vault — call {@link reset} for that too.
   */
  async forget(): Promise<void> {
    if (!this._store || this.sessionId === undefined) return;
    await this._store.delete(this.sessionId);
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
