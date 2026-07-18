/** Raised when ``onDetect: "block"`` mode detects PII in the input. */
export class PIIDetectedError extends Error {
  public readonly entities: import("./result.js").DetectedEntity[];

  constructor(message: string, entities: import("./result.js").DetectedEntity[]) {
    super(message);
    this.name = "PIIDetectedError";
    this.entities = entities;
    // Restore prototype chain (required for extending Error in TS)
    Object.setPrototypeOf(this, PIIDetectedError.prototype);
  }
}

/** Raised when an optional integration package is not installed. */
export class MissingDependencyError extends Error {
  constructor(pkg: string, extra: string) {
    super(
      `"${pkg}" is not installed. Run: npm install ${pkg}\n` +
        `(required for prompt-sanitizer ${extra} support)`
    );
    this.name = "MissingDependencyError";
    Object.setPrototypeOf(this, MissingDependencyError.prototype);
  }
}

/**
 * Raised when a replacement token already maps to a *different* original
 * value. This should only happen if a Vault was hydrated from a persisted
 * snapshot without correctly restoring/reconciling its counters — it is
 * a loud failure by design, since silently overwriting the mapping would
 * make an old placeholder deanonymize to the wrong value.
 */
export class VaultCollisionError extends Error {
  public readonly replacement: string;
  public readonly existingOriginal: string;
  public readonly incomingOriginal: string;

  constructor(replacement: string, existingOriginal: string, incomingOriginal: string) {
    super(
      `Replacement token "${replacement}" is already mapped to a different ` +
        `original value. This usually means a Vault's counters were not ` +
        `restored correctly from a persisted snapshot.`
    );
    this.name = "VaultCollisionError";
    this.replacement = replacement;
    this.existingOriginal = existingOriginal;
    this.incomingOriginal = incomingOriginal;
    Object.setPrototypeOf(this, VaultCollisionError.prototype);
  }
}

/** Raised when a VaultStore load/save/delete fails, or a snapshot's version is unsupported. */
export class VaultStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultStoreError";
    Object.setPrototypeOf(this, VaultStoreError.prototype);
  }
}
