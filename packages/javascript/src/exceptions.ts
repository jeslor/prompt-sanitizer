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
