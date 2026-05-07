"""
Python Latency Benchmark — prompt-sanitizer FAST / SMART / FULL
================================================================

Usage:
    pip install -r requirements.txt
    python run_latency.py

Measures:
  - Median, p95, p99 latency in ms for 1000 iterations per mode
  - Throughput in calls/sec
  - Optionally compares against Presidio

Benchmark text: a 3-sentence paragraph containing multiple PII types.
"""
from __future__ import annotations

import asyncio
import statistics
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Benchmark text
# ---------------------------------------------------------------------------

SAMPLE_SHORT = "My email is alice@example.com and my SSN is 078-05-1120."

SAMPLE_MEDIUM = (
    "Hi, my name is Alice Walker. "
    "You can reach me at alice@example.com or call (415) 867-5309. "
    "My SSN is 078-05-1120 and I last used card 4111 1111 1111 1111 "
    "for a payment to account GB29 NWBK 6016 1331 9268 19. "
    "Our server runs at 192.168.1.105."
)

SAMPLE_LONG = SAMPLE_MEDIUM * 5  # ~5× medium

WARMUP_ITERS = 10
BENCH_ITERS  = 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def stats(times_ms: list[float]) -> dict:
    times_ms = sorted(times_ms)
    n = len(times_ms)
    return {
        "min":    min(times_ms),
        "median": statistics.median(times_ms),
        "p95":    times_ms[int(0.95 * n)],
        "p99":    times_ms[int(0.99 * n)],
        "max":    max(times_ms),
        "mean":   statistics.mean(times_ms),
        "rps":    1000 / statistics.median(times_ms),
    }


def bench_sync(fn, n: int) -> list[float]:
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000)
    return times


async def bench_async(fn, n: int) -> list[float]:
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        await fn()
        times.append((time.perf_counter() - t0) * 1000)
    return times


def print_row(label: str, s: dict, text_label: str) -> None:
    print(
        f"  {label:<38} {text_label:<8} "
        f"{s['median']:>7.2f}  {s['p95']:>7.2f}  {s['p99']:>7.2f}"
        f"  {s['rps']:>8.0f}"
    )


# ---------------------------------------------------------------------------
# Benchmark runners
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages" / "python"))


async def bench_prompt_sanitizer() -> None:
    from prompt_sanitizer import Sanitizer, Mode  # type: ignore

    print("\n── prompt-sanitizer ─────────────────────────────────────────────────")
    print(f"  {'Tool':<38} {'Text':<8} {'median':>7}  {'p95':>7}  {'p99':>7}  {'rps':>8}")
    print(f"  {'-'*38} {'-'*8} {'-'*7}  {'-'*7}  {'-'*7}  {'-'*8}")

    for mode_name, mode in [("FAST", Mode.FAST), ("SMART", Mode.SMART), ("FULL", Mode.FULL)]:
        s = Sanitizer(mode=mode, on_detect="warn")

        for text_label, text in [("short", SAMPLE_SHORT), ("medium", SAMPLE_MEDIUM), ("long", SAMPLE_LONG)]:
            # Warmup
            for _ in range(WARMUP_ITERS):
                await s.sanitize(text)

            # Bench
            times = await bench_async(lambda t=text: s.sanitize(t), BENCH_ITERS)
            s_stats = stats(times)
            print_row(f"prompt-sanitizer  Mode.{mode_name:<5}", s_stats, text_label)


def bench_presidio() -> None:
    try:
        from presidio_analyzer import AnalyzerEngine  # type: ignore
    except ImportError:
        print("\n── Presidio ─────────────────────────────────────────────────────────")
        print("  [SKIP] presidio-analyzer not installed (pip install presidio-analyzer)")
        return

    print("\n── Presidio ─────────────────────────────────────────────────────────")
    print(f"  {'Tool':<38} {'Text':<8} {'median':>7}  {'p95':>7}  {'p99':>7}  {'rps':>8}")
    print(f"  {'-'*38} {'-'*8} {'-'*7}  {'-'*7}  {'-'*7}  {'-'*8}")

    print("  Loading AnalyzerEngine (spaCy)...", end=" ", flush=True)
    analyzer = AnalyzerEngine()
    print("ready.")

    for text_label, text in [("short", SAMPLE_SHORT), ("medium", SAMPLE_MEDIUM), ("long", SAMPLE_LONG)]:
        # Warmup
        for _ in range(WARMUP_ITERS):
            analyzer.analyze(text=text, language="en")

        # Bench
        times = bench_sync(lambda t=text: analyzer.analyze(text=t, language="en"), BENCH_ITERS)
        s_stats = stats(times)
        print_row("Presidio (spaCy)", s_stats, text_label)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"\nPython Latency Benchmark — {BENCH_ITERS} iterations per scenario")
    print(f"  All times in milliseconds. rps = calls/second at median latency.\n")

    print(f"  {'Tool':<38} {'Text':<8} {'median':>7}  {'p95':>7}  {'p99':>7}  {'rps':>8}")
    print(f"  {'='*38} {'='*8} {'='*7}  {'='*7}  {'='*7}  {'='*8}")

    asyncio.run(bench_prompt_sanitizer())
    bench_presidio()

    print("\n  Legend:")
    print("    short  = 1 sentence,  ~58 chars,  2 PII entities")
    print("    medium = 5 sentences, ~280 chars,  6 PII entities")
    print("    long   = 25 sentences,~1400 chars, 30 PII entities")
    print()


if __name__ == "__main__":
    main()
