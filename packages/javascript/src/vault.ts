import { VaultCollisionError } from "./exceptions.js";

/**
 * Bidirectional in-memory vault.
 *
 * Stores original→replacement and replacement→original mappings so that
 * PII can be anonymized before sending to an LLM and restored afterwards.
 *
 * - Deterministic: same original always maps to the same replacement.
 * - Longest-first restore: prevents partial token replacement.
 *
 * Each vault also owns its own per-entity-type placeholder counters (e.g.
 * the "1" in `[PERSON_1]`), so a vault is a fully self-contained unit that
 * can be serialized and later restored (e.g. after a process restart)
 * without colliding with counters from unrelated sessions.
 */
export class Vault {
  private readonly _fwd = new Map<string, string>(); // original → replacement
  private readonly _rev = new Map<string, string>(); // replacement → original
  private readonly _counters = new Map<string, number>(); // entity type → next index
  private _queue: Promise<void> = Promise.resolve();

  /**
   * Serialize async work against this vault so that concurrent callers
   * (e.g. two overlapping `Session.anonymize()` calls) can't interleave
   * between "check if a value is known" and "add it" — the gap that would
   * otherwise let two calls mint two different replacements for the same
   * new value, orphaning one of them.
   */
  withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this._queue.then(fn);
    this._queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Add a mapping. If ``original`` was already added, returns the existing
   * replacement without overwriting (guarantees determinism).
   *
   * Throws {@link VaultCollisionError} if ``replacement`` is already mapped
   * to a *different* original — silently overwriting it would make the old
   * placeholder deanonymize to the wrong value.
   */
  add(original: string, replacement: string): string {
    const existing = this._fwd.get(original);
    if (existing !== undefined) return existing;

    const claimedBy = this._rev.get(replacement);
    if (claimedBy !== undefined && claimedBy !== original) {
      throw new VaultCollisionError(replacement, claimedBy, original);
    }

    this._fwd.set(original, replacement);
    this._rev.set(replacement, original);
    return replacement;
  }

  /**
   * Return the next counter value for ``entityType`` (starting at 1) and
   * advance it. Used to number placeholders like `[PERSON_1]`, `[PERSON_2]`.
   */
  nextCount(entityType: string): number {
    const n = (this._counters.get(entityType) ?? 0) + 1;
    this._counters.set(entityType, n);
    return n;
  }

  /**
   * Ensure this vault's counter for ``entityType`` is at least ``n``.
   * Used when hydrating from a persisted snapshot to guarantee newly
   * generated placeholders never reuse an already-restored token.
   */
  ensureCounterAtLeast(entityType: string, n: number): void {
    const current = this._counters.get(entityType) ?? 0;
    if (n > current) this._counters.set(entityType, n);
  }

  /** Look up the replacement for a given original value. */
  getReplacement(original: string): string | undefined {
    return this._fwd.get(original);
  }

  /** Look up the original value for a given replacement token. */
  getOriginal(replacement: string): string | undefined {
    return this._rev.get(replacement);
  }

  /** Check if a value (original or replacement) is known. */
  has(value: string): boolean {
    return this._fwd.has(value) || this._rev.has(value);
  }

  /**
   * Restore all known replacement tokens in ``text`` back to their originals.
   *
   * Uses longest-first ordering to avoid replacing substrings of longer tokens.
   */
  restore(text: string): string {
    const replacements = [...this._rev.keys()].sort(
      (a, b) => b.length - a.length
    );
    let result = text;
    for (const token of replacements) {
      const original = this._rev.get(token);
      if (original !== undefined) {
        result = result.split(token).join(original);
      }
    }
    return result;
  }

  /** Number of original→replacement mappings stored. */
  get size(): number {
    return this._fwd.size;
  }

  /** Snapshot of all original→replacement pairs. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this._fwd);
  }

  /** Snapshot of all per-entity-type counters. */
  counterSnapshot(): Record<string, number> {
    return Object.fromEntries(this._counters);
  }

  /** Clear all mappings and reset counters. */
  clear(): void {
    this._fwd.clear();
    this._rev.clear();
    this._counters.clear();
  }

  /** Plain-data view of this vault's mappings + counters, for persistence. */
  toData(): VaultData {
    return { mappings: this.snapshot(), counters: this.counterSnapshot() };
  }

  /**
   * Populate this (normally freshly-constructed, empty) vault from
   * previously-persisted data.
   *
   * Counters are restored from `data.counters` directly, then additionally
   * reconciled by scanning `data.mappings` for `[TYPE_N]`-shaped tokens and
   * bumping the counter for `TYPE` to at least `N` — defense in depth for
   * a hand-rolled VaultStore that persists mappings but forgets counters.
   * This reconciliation can't disambiguate the small set of secret types
   * that share one placeholder pattern (`[REDACTED_KEY_N]` for API_KEY /
   * SECRET_KEY / OAUTH_TOKEN) — explicit counter persistence is what makes
   * those safe; the reconciliation pass is a best-effort backstop, not a
   * substitute for it.
   */
  hydrate(data: VaultData): void {
    for (const [original, replacement] of Object.entries(data.mappings)) {
      this._fwd.set(original, replacement);
      this._rev.set(replacement, original);
    }
    for (const [entityType, n] of Object.entries(data.counters)) {
      this.ensureCounterAtLeast(entityType, n);
    }
    const placeholderPattern = /^\[([A-Z_]+)_(\d+)\]$/;
    for (const replacement of Object.values(data.mappings)) {
      const match = placeholderPattern.exec(replacement);
      if (match) {
        this.ensureCounterAtLeast(match[1]!, parseInt(match[2]!, 10));
      }
    }
  }
}

/** Plain-data view of a vault's mappings + counters (no persistence metadata). */
export interface VaultData {
  mappings: Record<string, string>;
  counters: Record<string, number>;
}
