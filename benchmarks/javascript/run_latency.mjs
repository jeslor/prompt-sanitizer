/**
 * JS Latency Benchmark — prompt-sanitizer FAST / SMART vs OpenRedaction
 * ======================================================================
 *
 * Usage:
 *   npm install
 *   node run_latency.mjs
 *
 * Measures: min / median / p95 / p99 latency in ms + RPS at median.
 * Input sizes: short (~58 chars), medium (~280 chars), long (~1400 chars).
 */

import { performance } from "perf_hooks";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WARMUP_ITERS = 10;
const BENCH_ITERS  = 300;

// ---------------------------------------------------------------------------
// Benchmark texts
// ---------------------------------------------------------------------------

const SAMPLE_SHORT = "My email is alice@example.com and my SSN is 078-05-1120.";

const SAMPLE_MEDIUM = [
  "Hi, my name is Alice Walker.",
  "You can reach me at alice@example.com or call (415) 867-5309.",
  "My SSN is 078-05-1120 and I last used card 4111 1111 1111 1111",
  "for a payment to account GB29 NWBK 6016 1331 9268 19.",
  "Our server runs at 192.168.1.105.",
].join(" ");

const SAMPLE_LONG = SAMPLE_MEDIUM.repeat(5);

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function computeStats(timesMs) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min:    sorted[0],
    median: sorted[Math.floor(n / 2)],
    p95:    sorted[Math.floor(0.95 * n)],
    p99:    sorted[Math.floor(0.99 * n)],
    max:    sorted[n - 1],
    mean:   sum / n,
    rps:    1000 / sorted[Math.floor(n / 2)],
  };
}

async function benchAsync(fn, n) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  return times;
}

function printHeader() {
  const label = "  " + "Tool".padEnd(36) + " " + "Text".padEnd(8);
  const cols  = " median    p95    p99    rps";
  console.log(label + cols);
  console.log("  " + "-".repeat(36) + " " + "-".repeat(8) + " " + "-".repeat(28));
}

function printRow(label, textLabel, s) {
  const l = ("  " + label).padEnd(38);
  const t = textLabel.padEnd(8);
  const row = [s.median, s.p95, s.p99].map((v) => v.toFixed(2).padStart(7)).join(" ");
  const rps = String(Math.round(s.rps)).padStart(7);
  console.log(l + " " + t + " " + row + " " + rps);
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function loadPromptSanitizer() {
  return import(
    resolve(__dirname, "../../packages/javascript/src/index.js")
  ).catch(() =>
    import(resolve(__dirname, "../../packages/javascript/dist/index.js"))
  );
}

async function benchPromptSanitizer() {
  const { Sanitizer, Mode } = await loadPromptSanitizer();

  console.log("\n── prompt-sanitizer ──────────────────────────────────────────────────");
  printHeader();

  for (const [modeName, mode] of [["FAST", Mode.FAST], ["SMART", Mode.SMART]]) {
    const s = new Sanitizer({ mode, onDetect: "warn" });

    for (const [textLabel, text] of [["short", SAMPLE_SHORT], ["medium", SAMPLE_MEDIUM], ["long", SAMPLE_LONG]]) {
      // Warmup
      for (let i = 0; i < WARMUP_ITERS; i++) await s.sanitize(text);

      const times = await benchAsync(() => s.sanitize(text), BENCH_ITERS);
      printRow(`prompt-sanitizer  ${modeName}`, textLabel, computeStats(times));
    }
  }
}

async function benchOpenRedaction() {
  let OpenRedaction;
  try {
    ({ OpenRedaction } = await import("openredaction"));
  } catch {
    console.log("\n── OpenRedaction ──────────────────────────────────────────────────────");
    console.log("  [SKIP] openredaction not installed (npm install openredaction)");
    return;
  }

  console.log("\n── OpenRedaction ──────────────────────────────────────────────────────");
  printHeader();

  const redactor = new OpenRedaction();

  for (const [textLabel, text] of [["short", SAMPLE_SHORT], ["medium", SAMPLE_MEDIUM], ["long", SAMPLE_LONG]]) {
    for (let i = 0; i < WARMUP_ITERS; i++) await redactor.detect(text);
    const times = await benchAsync(() => redactor.detect(text), BENCH_ITERS);
    printRow("OpenRedaction (regex)", textLabel, computeStats(times));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nJS Latency Benchmark — ${BENCH_ITERS} iterations per scenario`);
  console.log("  All times in milliseconds. rps = calls/second at median.\n");
  console.log("  " + "=".repeat(70));
  console.log(`  ${"Tool".padEnd(36)} ${"Text".padEnd(8)} ${"median":>7}  ${"p95":>7}  ${"p99":>7}  ${"rps":>7}`);
  console.log("  " + "=".repeat(70));

  await benchPromptSanitizer();
  await benchOpenRedaction();

  console.log("\n  Legend:");
  console.log("    short  = 1 sentence,  ~58 chars,  2 PII entities");
  console.log("    medium = 5 sentences, ~280 chars,  6 PII entities");
  console.log("    long   = 25 sentences,~1400 chars, 30 PII entities\n");
}

main().catch(console.error);
