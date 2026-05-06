/**
 * NerEngine tests — mocks @huggingface/transformers so no model download needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EntityType } from "../src/entities.js";
import { Mode } from "../src/modes.js";

// ── Mock @huggingface/transformers ────────────────────────────────────────────

const MOCK_CHUNKS = [
  { entity_group: "PER",  score: 0.98, word: "John Smith", start: 11, end: 21 },
  { entity_group: "ORG",  score: 0.91, word: "Acme Corp",  start: 31, end: 40 },
  { entity_group: "LOC",  score: 0.88, word: "New York",   start: 45, end: 53 },
  { entity_group: "MISC", score: 0.75, word: "Python",     start: 60, end: 66 },
];

const mockPipeline = vi.fn().mockResolvedValue(MOCK_CHUNKS);
const mockDispose  = vi.fn().mockResolvedValue(undefined);

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(
    Object.assign(mockPipeline, { dispose: mockDispose })
  ),
  env: { useBrowserCache: true },
}));

// ── Import after mock ─────────────────────────────────────────────────────────
import { NerEngine, DEFAULT_NER_MODEL } from "../src/engines/ner-engine.js";
import { Sanitizer } from "../src/sanitizer.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NerEngine", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports DEFAULT_NER_MODEL", () => {
    expect(DEFAULT_NER_MODEL).toBe("Xenova/bert-base-NER");
  });

  it("uses default model when none specified", () => {
    const engine = new NerEngine();
    expect(engine.modelId).toBe(DEFAULT_NER_MODEL);
  });

  it("accepts a custom model id", () => {
    const engine = new NerEngine({ model: "custom/my-ner-model" });
    expect(engine.modelId).toBe("custom/my-ner-model");
  });

  it("detects PERSON_NAME from PER label", async () => {
    const engine = new NerEngine();
    const entities = await engine.detect("My name is John Smith at Acme Corp");
    const person = entities.find((e) => e.entityType === EntityType.PERSON_NAME);
    expect(person).toBeDefined();
    expect(person?.value).toBe("John Smith");
    expect(person?.layer).toBe("ner");
    expect(person?.confidence).toBeGreaterThan(0.9);
  });

  it("detects ORGANIZATION from ORG label", async () => {
    const engine = new NerEngine();
    const entities = await engine.detect("Works at Acme Corp");
    const org = entities.find((e) => e.entityType === EntityType.ORGANIZATION);
    expect(org).toBeDefined();
    expect(org?.value).toBe("Acme Corp");
  });

  it("detects LOCATION from LOC label", async () => {
    const engine = new NerEngine();
    const entities = await engine.detect("Based in New York");
    const loc = entities.find((e) => e.entityType === EntityType.LOCATION);
    expect(loc).toBeDefined();
    expect(loc?.value).toBe("New York");
  });

  it("skips MISC labels", async () => {
    const engine = new NerEngine();
    const entities = await engine.detect("Using Python");
    expect(entities.every((e) => e.entityType !== undefined)).toBe(true);
    // MISC should be filtered out
    const misc = MOCK_CHUNKS.find((c) => c.entity_group === "MISC");
    expect(entities.find((e) => e.value === misc?.word)).toBeUndefined();
  });

  it("returns consistent start/end offsets", async () => {
    const engine = new NerEngine();
    const entities = await engine.detect("My name is John Smith");
    const person = entities.find((e) => e.entityType === EntityType.PERSON_NAME);
    expect(person?.start).toBe(11);
    expect(person?.end).toBe(21);
  });

  it("returns empty array on empty text", async () => {
    mockPipeline.mockResolvedValueOnce([]);
    const engine = new NerEngine();
    const entities = await engine.detect("");
    expect(entities).toEqual([]);
  });

  it("reuses the same pipeline across multiple detect() calls", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const engine = new NerEngine();
    await engine.detect("First call");
    await engine.detect("Second call");
    // pipeline() factory should only be called once
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("disposes pipeline and releases memory", async () => {
    const engine = new NerEngine();
    await engine.detect("Load the model first");
    await engine.dispose();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});

describe("Sanitizer — Mode.SMART NER integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes .ner property in SMART mode", () => {
    const s = new Sanitizer({ mode: Mode.SMART });
    expect(s.ner).toBeInstanceOf(NerEngine);
  });

  it(".ner is null in FAST mode", () => {
    const s = new Sanitizer({ mode: Mode.FAST });
    expect(s.ner).toBeNull();
  });

  it(".ner is available in FULL mode", () => {
    const s = new Sanitizer({ mode: Mode.FULL });
    expect(s.ner).toBeInstanceOf(NerEngine);
  });

  it("sanitize() in SMART mode merges NER and regex results", async () => {
    // Mock NER returns PERSON_NAME for "John Smith"
    mockPipeline.mockResolvedValueOnce([
      { entity_group: "PER", score: 0.98, word: "John Smith", start: 8, end: 18 },
    ]);

    const s = new Sanitizer({ mode: Mode.SMART });
    // Email is detected by regex, PERSON_NAME by NER
    const result = await s.sanitize("Call me John Smith at john@example.com");

    const types = result.entities.map((e) => e.entityType);
    expect(types).toContain(EntityType.PERSON_NAME);
    expect(types).toContain(EntityType.EMAIL);
    expect(result.text).not.toContain("John Smith");
    expect(result.text).not.toContain("john@example.com");
  });

  it("deduplicates overlapping spans between regex and NER", async () => {
    // NER and regex both detect an email — offsets overlap
    mockPipeline.mockResolvedValueOnce([
      { entity_group: "PER", score: 0.80, word: "john@example.com", start: 8, end: 24 },
    ]);
    const s = new Sanitizer({ mode: Mode.SMART });
    const result = await s.sanitize("Email: john@example.com");
    // Should only appear once in entities (deduplicated)
    const emailEntities = result.entities.filter(
      (e) => e.value === "john@example.com"
    );
    expect(emailEntities.length).toBe(1);
  });

  it("accepts custom nerModel option", () => {
    const s = new Sanitizer({ mode: Mode.SMART, nerModel: "custom/pii-ner" });
    expect(s.ner?.modelId).toBe("custom/pii-ner");
  });

  it("dispose() releases NER model", async () => {
    const s = new Sanitizer({ mode: Mode.SMART });
    // Trigger model load
    mockPipeline.mockResolvedValueOnce([]);
    await s.sanitize("hello world");
    await s.dispose();
    expect(mockDispose).toHaveBeenCalled();
  });
});
