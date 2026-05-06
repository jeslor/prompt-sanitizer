/** Detection modes — controls which engines run. */
export enum Mode {
  /** Regex + secrets only. Zero ML deps. Default. */
  FAST = "fast",
  /** FAST + NER (requires @xenova/transformers). */
  SMART = "smart",
  /** SMART + synthetic replacements + audit logging. */
  FULL = "full",
}
