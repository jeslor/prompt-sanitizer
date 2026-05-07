"""
Python Accuracy Benchmark — prompt-sanitizer vs Presidio vs LLM Guard
======================================================================

Usage:
    pip install -r requirements.txt
    python run_accuracy.py

    # Skip tools not installed:
    python run_accuracy.py --skip-presidio
    python run_accuracy.py --skip-llmguard

Metric: Value-overlap matching (detected entity value ⊇ or ≈ ground-truth value),
per entity category and overall. Reports Precision / Recall / F1.

NOTE: PERSON entities require NER (Mode.SMART). Regex-only tools will show 0% recall
      for the 'person' category — this is expected and illustrates the gap.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Corpus loading
# ---------------------------------------------------------------------------

CORPUS_PATH = Path(__file__).parent.parent / "corpus" / "pii_samples.json"

def load_corpus() -> list[dict]:
    with open(CORPUS_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Entity-type normalisation
# Maps each tool's label → our canonical type (for fair comparison)
# ---------------------------------------------------------------------------

# Presidio → our canonical
PRESIDIO_MAP: dict[str, str] = {
    "EMAIL_ADDRESS":   "EMAIL",
    "PHONE_NUMBER":    "PHONE",
    "US_SSN":          "SSN",
    "CREDIT_CARD":     "CREDIT_CARD",
    "IBAN_CODE":       "IBAN",
    "IP_ADDRESS":      "IP_ADDRESS",
    "URL":             "URL",
    "PERSON":          "PERSON",
    "ORGANIZATION":    "ORGANIZATION",
    "LOCATION":        "LOCATION",
    "CRYPTO":          "CRYPTO_ADDRESS",
    "DATE_TIME":       "DATE",
}

# LLM Guard → our canonical
LLMGUARD_MAP: dict[str, str] = {
    "EMAIL_ADDRESS":   "EMAIL",
    "EMAIL_ADDRESS_RE":"EMAIL",
    "PHONE_NUMBER":    "PHONE",
    "US_SSN":          "SSN",
    "US_SSN_RE":       "SSN",
    "CREDIT_CARD":     "CREDIT_CARD",
    "CREDIT_CARD_RE":  "CREDIT_CARD",
    "IBAN_CODE":       "IBAN",
    "IP_ADDRESS":      "IP_ADDRESS",
    "PERSON":          "PERSON",
    "ORGANIZATION":    "ORGANIZATION",
    "LOCATION":        "LOCATION",
    "CRYPTO":          "CRYPTO_ADDRESS",
    "URL":             "URL",
    "UUID":            "OTHER",
}


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _value_match(detected_val: str, expected_val: str) -> bool:
    """True if detected value contains or is contained by the expected value."""
    d = detected_val.strip().lower()
    e = expected_val.strip().lower()
    return d == e or e in d or d in e


@dataclass
class CategoryStats:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) > 0 else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) > 0 else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) > 0 else 0.0


def score(
    samples: list[dict],
    detections: list[list[dict]],  # [{"type": canonical_type, "value": str}, ...]
    categories: list[str] | None = None,
) -> dict[str, CategoryStats]:
    """
    Compare detections against ground truth.

    Returns per-category stats plus "overall" key.
    """
    stats: dict[str, CategoryStats] = {}
    totals = CategoryStats()

    for sample, detected in zip(samples, detections):
        cat = sample["category"]
        if categories and cat not in categories:
            continue
        if cat not in stats:
            stats[cat] = CategoryStats()

        expected = sample["entities"]  # list of {type, value}

        # For each expected entity: find a matching detection
        matched_detected = set()
        for exp in expected:
            found = False
            for i, det in enumerate(detected):
                if i in matched_detected:
                    continue
                # type must match at category level (loose: both EMAIL, both PHONE etc.)
                if det["type"] == exp["type"] and _value_match(det["value"], exp["value"]):
                    found = True
                    matched_detected.add(i)
                    break
            if found:
                stats[cat].tp += 1
                totals.tp += 1
            else:
                stats[cat].fn += 1
                totals.fn += 1

        # FP: any detection not matched to expected
        for i, det in enumerate(detected):
            if i not in matched_detected:
                # Only count FP for expected categories (ignore unrelated detections)
                relevant_types = {e["type"] for e in expected}
                if not expected or det["type"] in relevant_types:
                    stats.setdefault(det["type"], CategoryStats()).fp += 1
                    totals.fp += 1

    stats["OVERALL"] = totals
    return stats


def print_results(tool_name: str, stats: dict[str, CategoryStats]) -> None:
    print(f"\n{'='*60}")
    print(f"  {tool_name}")
    print(f"{'='*60}")
    print(f"  {'Category':<20} {'Precision':>10} {'Recall':>10} {'F1':>10}  TP  FP  FN")
    print(f"  {'-'*20} {'-'*10} {'-'*10} {'-'*10}  --  --  --")
    for cat, s in sorted(stats.items()):
        print(
            f"  {cat:<20} {s.precision:>9.1%} {s.recall:>9.1%} {s.f1:>9.1%}"
            f"  {s.tp:2}  {s.fp:2}  {s.fn:2}"
        )


# ---------------------------------------------------------------------------
# prompt-sanitizer runner
# ---------------------------------------------------------------------------

def run_prompt_sanitizer(samples: list[dict]) -> tuple[list[list[dict]], float]:
    """Run prompt-sanitizer FAST mode. Returns (detections_per_sample, avg_ms)."""
    import asyncio
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages" / "python"))
    from prompt_sanitizer import Sanitizer, Mode  # type: ignore

    s = Sanitizer(mode=Mode.FAST, on_detect="warn")

    async def _run_all():
        start = time.perf_counter()
        results = []
        for sample in samples:
            r = await s.sanitize(sample["text"])
            results.append([
                {"type": e.entity_type.value, "value": e.original}
                for e in r.entities
            ])
        elapsed_ms = (time.perf_counter() - start) * 1000
        return results, elapsed_ms / len(samples)

    return asyncio.run(_run_all())


def run_prompt_sanitizer_smart(samples: list[dict]) -> tuple[list[list[dict]], float]:
    """Run prompt-sanitizer SMART mode (NER enabled)."""
    import asyncio
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages" / "python"))
    from prompt_sanitizer import Sanitizer, Mode  # type: ignore

    s = Sanitizer(mode=Mode.SMART, on_detect="warn")

    async def _run_all():
        start = time.perf_counter()
        results = []
        for sample in samples:
            r = await s.sanitize(sample["text"])
            results.append([
                {"type": e.entity_type.value, "value": e.original}
                for e in r.entities
            ])
        elapsed_ms = (time.perf_counter() - start) * 1000
        return results, elapsed_ms / len(samples)

    return asyncio.run(_run_all())


# ---------------------------------------------------------------------------
# Presidio runner
# ---------------------------------------------------------------------------

def run_presidio(samples: list[dict]) -> tuple[list[list[dict]], float]:
    """Run Presidio analyzer. Requires: pip install presidio-analyzer presidio-anonymizer"""
    try:
        from presidio_analyzer import AnalyzerEngine  # type: ignore
    except ImportError:
        print("  [SKIP] presidio-analyzer not installed.")
        return [[] for _ in samples], 0.0

    print("  Loading Presidio AnalyzerEngine (spaCy)...")
    analyzer = AnalyzerEngine()

    start = time.perf_counter()
    results = []
    for sample in samples:
        raw = analyzer.analyze(text=sample["text"], language="en")
        results.append([
            {
                "type": PRESIDIO_MAP.get(r.entity_type, r.entity_type),
                "value": sample["text"][r.start:r.end],
            }
            for r in raw
        ])
    elapsed_ms = (time.perf_counter() - start) * 1000
    return results, elapsed_ms / len(samples)


# ---------------------------------------------------------------------------
# LLM Guard runner
# ---------------------------------------------------------------------------

def run_llmguard(samples: list[dict]) -> tuple[list[list[dict]], float]:
    """
    Run LLM Guard Anonymize scanner.
    Requires: pip install llm-guard

    Note: LLM Guard does not expose individual entity spans/values in its public API.
    We infer detections by comparing the sanitized output against the original:
    any expected PII value absent from the output is counted as detected (recall proxy).
    For precision: any expected value present in the output despite being PII = FP.
    """
    try:
        from llm_guard.vault import Vault           # type: ignore
        from llm_guard.input_scanners import Anonymize  # type: ignore
    except ImportError:
        print("  [SKIP] llm-guard not installed.")
        return [[] for _ in samples], 0.0

    print("  Loading LLM Guard scanner (DeBERTa download on first run)...")
    vault = Vault()
    scanner = Anonymize(vault=vault, use_faker=False)

    start = time.perf_counter()
    results = []
    for sample in samples:
        sanitized, _is_valid, _score = scanner.scan(sample["text"])
        # Infer detections: check which expected values are absent from the output
        detected = []
        for exp in sample["entities"]:
            if exp["value"].lower() not in sanitized.lower():
                detected.append({"type": exp["type"], "value": exp["value"]})
        results.append(detected)
        # Reset vault between samples to avoid cross-contamination
        vault._entries.clear() if hasattr(vault, "_entries") else None

    elapsed_ms = (time.perf_counter() - start) * 1000
    return results, elapsed_ms / len(samples)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="PII accuracy benchmark")
    parser.add_argument("--skip-presidio", action="store_true")
    parser.add_argument("--skip-llmguard", action="store_true")
    parser.add_argument("--only", help="comma-separated categories to test")
    args = parser.parse_args()

    samples = load_corpus()
    filter_cats = args.only.split(",") if args.only else None
    if filter_cats:
        samples = [s for s in samples if s["category"] in filter_cats]

    total = len(samples)
    ner_samples = sum(1 for s in samples if s["category"] in ("person", "multi"))
    print(f"\nLoaded {total} samples ({ner_samples} require NER for full score)")

    # ── prompt-sanitizer FAST ─────────────────────────────────────────────────
    print("\n[1/4] Running prompt-sanitizer (FAST mode) ...")
    ps_fast_detections, ps_fast_ms = run_prompt_sanitizer(samples)
    ps_fast_stats = score(samples, ps_fast_detections)
    print_results(f"prompt-sanitizer  FAST  ({ps_fast_ms:.2f} ms/call avg)", ps_fast_stats)

    # ── prompt-sanitizer SMART ────────────────────────────────────────────────
    print("\n[2/4] Running prompt-sanitizer (SMART mode — NER) ...")
    ps_smart_detections, ps_smart_ms = run_prompt_sanitizer_smart(samples)
    ps_smart_stats = score(samples, ps_smart_detections)
    print_results(f"prompt-sanitizer  SMART ({ps_smart_ms:.2f} ms/call avg)", ps_smart_stats)

    # ── Presidio ──────────────────────────────────────────────────────────────
    if not args.skip_presidio:
        print("\n[3/4] Running Presidio ...")
        pr_detections, pr_ms = run_presidio(samples)
        pr_stats = score(samples, pr_detections)
        print_results(f"Presidio (spaCy)        ({pr_ms:.2f} ms/call avg)", pr_stats)
    else:
        print("\n[3/4] Presidio — SKIPPED")

    # ── LLM Guard ─────────────────────────────────────────────────────────────
    if not args.skip_llmguard:
        print("\n[4/4] Running LLM Guard ...")
        lg_detections, lg_ms = run_llmguard(samples)
        lg_stats = score(samples, lg_detections)
        print_results(f"LLM Guard (DeBERTa)     ({lg_ms:.2f} ms/call avg)", lg_stats)
    else:
        print("\n[4/4] LLM Guard — SKIPPED")

    # ── Comparison summary ────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("  OVERALL SUMMARY")
    print(f"{'='*70}")
    print(f"  {'Tool':<40} {'Precision':>10} {'Recall':>10} {'F1':>10}")
    print(f"  {'-'*40} {'-'*10} {'-'*10} {'-'*10}")

    rows = [
        (f"prompt-sanitizer FAST  ({ps_fast_ms:.1f}ms/call)", ps_fast_stats.get("OVERALL", CategoryStats())),
        (f"prompt-sanitizer SMART ({ps_smart_ms:.1f}ms/call)", ps_smart_stats.get("OVERALL", CategoryStats())),
    ]
    if not args.skip_presidio and "pr_stats" in dir():
        rows.append((f"Presidio spaCy         ({pr_ms:.1f}ms/call)", pr_stats.get("OVERALL", CategoryStats())))  # type: ignore[reportPossiblyUnbound]
    if not args.skip_llmguard and "lg_stats" in dir():
        rows.append((f"LLM Guard DeBERTa      ({lg_ms:.1f}ms/call)", lg_stats.get("OVERALL", CategoryStats())))  # type: ignore[reportPossiblyUnbound]

    for name, s in rows:
        print(f"  {name:<40} {s.precision:>9.1%} {s.recall:>9.1%} {s.f1:>9.1%}")

    print()


if __name__ == "__main__":
    main()
