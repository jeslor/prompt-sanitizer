/**
 * NER Engine — transformer-based named entity recognition via WASM inference.
 *
 * Uses @huggingface/transformers (Transformers.js v3) to run ONNX-quantized NER
 * models fully in-process — no Python, no server, works in Node.js and browser.
 *
 * Activated when mode = Mode.SMART or Mode.FULL.
 * Requires: npm install @huggingface/transformers  (optional peer dep)
 *
 * Default model: "Xenova/bert-base-NER"
 *   - ONNX-quantized  (~65 MB q8)
 *   - Detects: PER (person), ORG (organization), LOC (location), MISC
 *   - Downloaded once, cached at $HF_HOME or ~/.cache/huggingface/hub/
 */

import { EntityType } from "../entities.js";
import type { DetectedEntity } from "../result.js";

export const DEFAULT_NER_MODEL = "Xenova/bert-base-NER";

/** Maps the model's aggregated entity_group label to our EntityType. */
const LABEL_MAP: Record<string, EntityType> = {
  PER:    EntityType.PERSON_NAME,
  PERSON: EntityType.PERSON_NAME,
  LOC:    EntityType.LOCATION,
  GPE:    EntityType.LOCATION,
  ORG:    EntityType.ORGANIZATION,
};

interface NERChunk {
  entity_group: string;
  score: number;
  word: string;
  start: number;
  end: number;
}

export interface NerEngineOptions {
  /** HuggingFace model ID. Must support token-classification. Default: "Xenova/bert-base-NER". */
  model?: string;
  /** If true, only emit a warning when @huggingface/transformers is missing instead of throwing. */
  silent?: boolean;
}

export class NerEngine {
  private readonly _model: string;
  private readonly _silent: boolean;
  private _pipeline: ((text: string) => Promise<NERChunk[]>) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _rawPipe: any = null;
  private _loading: Promise<(text: string) => Promise<NERChunk[]>> | null = null;
  private _unavailable = false;

  constructor(options: NerEngineOptions = {}) {
    this._model = options.model ?? DEFAULT_NER_MODEL;
    this._silent = options.silent ?? false;
  }

  /** Lazy-load the transformers pipeline on first call. */
  private async _getPipeline(): Promise<((text: string) => Promise<NERChunk[]>) | null> {
    if (this._unavailable) return null;
    if (this._pipeline) return this._pipeline;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        // Dynamic import — won't fail at package load time if not installed
        const { pipeline, env } = await import("@huggingface/transformers");

        // Suppress progress bars in non-TTY environments (Node.js only)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const proc = (globalThis as any).process as { stdout?: { isTTY?: boolean } } | undefined;
          if (!proc?.stdout?.isTTY) {
            env.useBrowserCache = false;
          }
        } catch { /* browser / edge — ignore */ }

        this._rawPipe = await pipeline("token-classification", this._model);
        // Pass aggregation_strategy at call time (Transformers.js v3 API)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawRef = this._rawPipe as any;
        this._pipeline = (text: string) =>
          rawRef(text, { aggregation_strategy: "simple" }) as Promise<NERChunk[]>;

        return this._pipeline;
      } catch (err) {
        this._unavailable = true;
        this._loading = null;

        const msg =
          `[prompt-sanitizer] NER (Mode.SMART) requires @huggingface/transformers:\n` +
          `  npm install @huggingface/transformers\n` +
          `Falling back to regex-only detection.\n` +
          `Original error: ${(err as Error).message}`;

        if (this._silent) {
          // eslint-disable-next-line no-console
          (globalThis as { console?: { warn: (...a: unknown[]) => void } }).console?.warn(msg);
          return null as unknown as (text: string) => Promise<NERChunk[]>;
        }
        throw new Error(msg);
      }
    })();

    return this._loading;
  }

  /**
   * Run NER on `text`.  Returns an empty array if the model is unavailable
   * (missing dep) when `silent: true`, or throws otherwise.
   */
  async detect(text: string): Promise<DetectedEntity[]> {
    const pipe = await this._getPipeline();
    if (!pipe) return [];

    const chunks: NERChunk[] = await pipe(text);
    const entities: DetectedEntity[] = [];

    for (const chunk of chunks) {
      const entityType = LABEL_MAP[chunk.entity_group];
      if (!entityType) continue; // skip MISC and unmapped labels

      entities.push({
        entityType,
        value: chunk.word,
        start: chunk.start,
        end: chunk.end,
        confidence: Math.round(chunk.score * 1000) / 1000,
        layer: "ner",
      });
    }

    return entities;
  }

  /** Release the model from memory. */
  async dispose(): Promise<void> {
    if (this._rawPipe) {
      await this._rawPipe.dispose?.();
      this._rawPipe = null;
    }
    this._pipeline = null;
    this._loading = null;
  }

  get modelId(): string {
    return this._model;
  }
}
