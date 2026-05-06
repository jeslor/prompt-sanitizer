/**
 * Bidirectional in-memory vault.
 *
 * Stores original→replacement and replacement→original mappings so that
 * PII can be anonymized before sending to an LLM and restored afterwards.
 *
 * - Deterministic: same original always maps to the same replacement.
 * - Longest-first restore: prevents partial token replacement.
 */
export class Vault {
  private readonly _fwd = new Map<string, string>(); // original → replacement
  private readonly _rev = new Map<string, string>(); // replacement → original

  /**
   * Add a mapping. If ``original`` was already added, returns the existing
   * replacement without overwriting (guarantees determinism).
   */
  add(original: string, replacement: string): string {
    const existing = this._fwd.get(original);
    if (existing !== undefined) return existing;
    this._fwd.set(original, replacement);
    this._rev.set(replacement, original);
    return replacement;
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

  /** Clear all mappings. */
  clear(): void {
    this._fwd.clear();
    this._rev.clear();
  }
}
