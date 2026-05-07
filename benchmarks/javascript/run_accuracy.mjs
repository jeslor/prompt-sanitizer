/**
 * JS Accuracy Benchmark — prompt-sanitizer vs OpenRedaction
 * ==========================================================
 *
 * Usage:
 *   npm install
 *   node run_accuracy.mjs
 *
 * Metric: Value-overlap matching (detected value ⊇ or ≈ expected value),
 * per entity category. Reports Precision / Recall / F1.
 *
 * NOTE: PERSON entities require Mode.SMART (NER). Regex-only tools show 0%
 *       recall for the 'person' category — this demonstrates the NER gap.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { performance } from "perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = resolve(__dirname, "../corpus/pii_samples.json");

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const samples = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

// ---------------------------------------------------------------------------
// Entity type normalisation
// OpenRedaction uses different names → canonical
// ---------------------------------------------------------------------------

const OR_TYPE_MAP = {
  EMAIL:              "EMAIL",
  PHONE_US:           "PHONE",
  PHONE_UK_MOBILE:    "PHONE",
  PHONE_INTL:         "PHONE",
  SSN:                "SSN",
  CREDIT_CARD_VISA:   "CREDIT_CARD",
  CREDIT_CARD_MASTERCARD: "CREDIT_CARD",
  CREDIT_CARD_AMEX:   "CREDIT_CARD",
  IBAN:               "IBAN",
  IP_ADDRESS:         "IP_ADDRESS",
  URL:                "URL",
  API_KEY:            "API_KEY",
  JWT:                "JWT",
  BEARER_TOKEN:       "JWT",
  NAME:               "PERSON",
};

// prompt-sanitizer JS uses slightly different names
const PS_TYPE_MAP = {
  EMAIL:            "EMAIL",
  PHONE:            "PHONE",
  SSN:              "SSN",
  CREDIT_CARD:      "CREDIT_CARD",
  IBAN:             "IBAN",
  IP_ADDRESS:       "IP_ADDRESS",
  URL:              "URL",
  API_KEY:          "API_KEY",
  JWT_TOKEN:        "JWT",
  PERSON_NAME:      "PERSON",
  SECRET_KEY:       "API_KEY",
  AWS_KEY:          "API_KEY",
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function valueMatch(detected, expected) {
  const d = detected.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  return d === e || e.includes(d) || d.includes(e);
}

function computeStats(detectionsList) {
  const categoryStats = {};
  let totalTP = 0, totalFP = 0, totalFN = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const detected = detectionsList[i] ?? [];
    const expected = sample.entities;
    const cat = sample.category;

    if (!categoryStats[cat]) categoryStats[cat] = { tp: 0, fp: 0, fn: 0 };

    const matchedDetected = new Set();

    for (const exp of expected) {
      let found = false;
      for (let j = 0; j < detected.length; j++) {
        if (matchedDetected.has(j)) continue;
        if (detected[j].type === exp.type && valueMatch(detected[j].value, exp.value)) {
          found = true;
          matchedDetected.add(j);
          break;
        }
      }
      if (found) {
        categoryStats[cat].tp++;
        totalTP++;
      } else {
        categoryStats[cat].fn++;
        totalFN++;
      }
    }

    // FP
    for (let j = 0; j < detected.length; j++) {
      if (!matchedDetected.has(j)) {
        const relevantTypes = new Set(expected.map((e) => e.type));
        if (!expected.length || relevantTypes.has(detected[j].type)) {
          const t = detected[j].type;
          if (!categoryStats[t]) categoryStats[t] = { tp: 0, fp: 0, fn: 0 };
          categoryStats[t].fp++;
          totalFP++;
        }
      }
    }
  }

  categoryStats["OVERALL"] = { tp: totalTP, fp: totalFP, fn: totalFN };
  return categoryStats;
}

function pct(n, d) {
  return d === 0 ? "  N/A" : `${((n / d) * 100).toFixed(1)}%`;
}

function f1(tp, fp, fn) {
  const p = tp / (tp + fp || 1);
  const r = tp / (tp + fn || 1);
  const score = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return `${(score * 100).toFixed(1)}%`;
}

function printResults(toolName, statsMap) {
  console.log(`\n${"=".repeat(65)}`);
  console.log(`  ${toolName}`);
  console.log("=".repeat(65));
  console.log(`  ${"Category".padEnd(22)} ${"Precision".padStart(10)} ${"Recall".padStart(10)} ${"F1".padStart(8)}   TP  FP  FN`);
  console.log(`  ${"-".repeat(22)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)}   --  --  --`);

  for (const [cat, s] of Object.entries(statsMap).sort()) {
    const prec = pct(s.tp, s.tp + s.fp);
    const rec  = pct(s.tp, s.tp + s.fn);
    const f    = f1(s.tp, s.fp, s.fn);
    console.log(`  ${cat.padEnd(22)} ${prec.padStart(10)} ${rec.padStart(10)} ${f.padStart(8)}  ${String(s.tp).padStart(3)} ${String(s.fp).padStart(3)} ${String(s.fn).padStart(3)}`);
  }
}

// ---------------------------------------------------------------------------
// prompt-sanitizer runner
// ---------------------------------------------------------------------------

async function runPromptSanitizer(mode) {
  const { Sanitizer, Mode } = await import(
    resolve(__dirname, "../../packages/javascript/src/index.js")
  ).catch(() =>
    import(resolve(__dirname, "../../packages/javascript/dist/index.js"))
  );

  const s = new Sanitizer({ mode: Mode[mode], onDetect: "warn" });
  const t0 = performance.now();
  const detectionsList = [];

  for (const sample of samples) {
    const result = await s.sanitize(sample.text);
    detectionsList.push(
      result.entities.map((e) => ({
        type: PS_TYPE_MAP[e.entityType] ?? e.entityType,
        value: e.value,
      }))
    );
  }

  const avgMs = (performance.now() - t0) / samples.length;
  return { detectionsList, avgMs };
}

// ---------------------------------------------------------------------------
// OpenRedaction runner
// ---------------------------------------------------------------------------

async function runOpenRedaction() {
  let OpenRedaction;
  try {
    ({ OpenRedaction } = await import("openredaction"));
  } catch {
    console.log("\n  [SKIP] openredaction not installed (npm install openredaction)");
    return { detectionsList: samples.map(() => []), avgMs: 0 };
  }

  const redactor = new OpenRedaction({ enableContextAnalysis: true });
  const t0 = performance.now();
  const detectionsList = [];

  for (const sample of samples) {
    const result = await redactor.detect(sample.text);
    const detections = (result.detections ?? []).map((d) => ({
      type: OR_TYPE_MAP[d.type] ?? d.type,
      value: d.value,
    }));
    detectionsList.push(detections);
  }

  const avgMs = (performance.now() - t0) / samples.length;
  return { detectionsList, avgMs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const total = samples.length;
  const nerSamples = samples.filter((s) => ["person", "multi"].includes(s.category)).length;
  console.log(`\nLoaded ${total} samples (${nerSamples} require NER for full score)`);

  // ── prompt-sanitizer FAST ─────────────────────────────────────────────────
  console.log("\n[1/3] Running prompt-sanitizer (FAST) ...");
  const { detectionsList: psFast, avgMs: psFastMs } = await runPromptSanitizer("FAST");
  const psFastStats = computeStats(psFast);
  printResults(`prompt-sanitizer  FAST  (${psFastMs.toFixed(2)} ms/call avg)`, psFastStats);

  // ── prompt-sanitizer SMART ────────────────────────────────────────────────
  console.log("\n[2/3] Running prompt-sanitizer (SMART — NER) ...");
  const { detectionsList: psSmart, avgMs: psSmartMs } = await runPromptSanitizer("SMART");
  const psSmartStats = computeStats(psSmart);
  printResults(`prompt-sanitizer  SMART (${psSmartMs.toFixed(2)} ms/call avg)`, psSmartStats);

  // ── OpenRedaction ─────────────────────────────────────────────────────────
  console.log("\n[3/3] Running OpenRedaction ...");
  const { detectionsList: orDetections, avgMs: orMs } = await runOpenRedaction();
  const orStats = computeStats(orDetections);
  printResults(`OpenRedaction (regex)   (${orMs.toFixed(2)} ms/call avg)`, orStats);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("  OVERALL SUMMARY");
  console.log("=".repeat(70));
  console.log(`  ${"Tool".padEnd(42)} ${"Precision".padStart(10)} ${"Recall".padStart(10)} ${"F1".padStart(8)}`);
  console.log(`  ${"-".repeat(42)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)}`);

  for (const [name, statsMap, ms] of [
    [`prompt-sanitizer FAST  (${psFastMs.toFixed(1)}ms/call)`, psFastStats, psFastMs],
    [`prompt-sanitizer SMART (${psSmartMs.toFixed(1)}ms/call)`, psSmartStats, psSmartMs],
    [`OpenRedaction regex    (${orMs.toFixed(1)}ms/call)`, orStats, orMs],
  ]) {
    const s = statsMap["OVERALL"];
    if (!s) continue;
    const prec = pct(s.tp, s.tp + s.fp);
    const rec  = pct(s.tp, s.tp + s.fn);
    const f    = f1(s.tp, s.fp, s.fn);
    console.log(`  ${name.padEnd(42)} ${prec.padStart(10)} ${rec.padStart(10)} ${f.padStart(8)}`);
  }

  console.log();
}

main().catch(console.error);
