# frozen_string_literal: true

# Ruby Latency Benchmark — prompt-sanitizer FAST / SMART
# =======================================================
#
# Usage:
#   cd benchmarks/ruby
#   bundle install
#   bundle exec ruby run_latency.rb
#
# Measures:
#   - Median, p95, p99 latency in ms for 500 iterations per mode/text size
#   - Throughput in calls/sec
#
# Benchmark text: paragraphs containing multiple PII types.

require "bundler/setup"
require "prompt_sanitizer"

# ---------------------------------------------------------------------------
# Benchmark texts
# ---------------------------------------------------------------------------

SAMPLE_SHORT = "My email is alice@example.com and my SSN is 078-05-1120."

SAMPLE_MEDIUM = (
  "Hi, my name is Alice Walker. " \
  "You can reach me at alice@example.com or call (415) 867-5309. " \
  "My SSN is 078-05-1120 and I last used card 4111 1111 1111 1111 " \
  "for a payment to account GB29 NWBK 6016 1331 9268 19. " \
  "Our server runs at 192.168.1.105."
)

SAMPLE_LONG = SAMPLE_MEDIUM * 5  # ~5× medium

WARMUP_ITERS = 10
BENCH_ITERS  = 500

# ---------------------------------------------------------------------------
# Statistics helpers
# ---------------------------------------------------------------------------

def percentile(sorted_arr, pct)
  idx = (pct * sorted_arr.size).ceil - 1
  sorted_arr[[idx, 0].max]
end

def stats(times_ms)
  sorted = times_ms.sort
  median = percentile(sorted, 0.50)
  {
    min:    sorted.first,
    median: median,
    p95:    percentile(sorted, 0.95),
    p99:    percentile(sorted, 0.99),
    max:    sorted.last,
    mean:   times_ms.sum / times_ms.size.to_f,
    rps:    median > 0 ? (1000.0 / median).round : 0,
  }
end

def bench(sanitizer, text, n)
  times = []
  n.times do
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC, :microsecond)
    sanitizer.sanitize(text)
    t1 = Process.clock_gettime(Process::CLOCK_MONOTONIC, :microsecond)
    times << (t1 - t0) / 1000.0  # microseconds → ms
  end
  times
end

def print_header
  puts format(
    "  %-40s %-8s %7s  %7s  %7s  %8s",
    "Tool", "Text", "median", "p95", "p99", "rps"
  )
  puts format(
    "  %-40s %-8s %7s  %7s  %7s  %8s",
    "-" * 40, "-" * 8, "-" * 7, "-" * 7, "-" * 7, "-" * 8
  )
end

def print_row(label, text_label, s)
  puts format(
    "  %-40s %-8s %7.2f  %7.2f  %7.2f  %8d",
    label, text_label,
    s[:median], s[:p95], s[:p99], s[:rps]
  )
end

# ---------------------------------------------------------------------------
# Benchmark runners
# ---------------------------------------------------------------------------

def bench_mode(mode_sym, mode_label)
  sanitizer = PromptSanitizer::Sanitizer.new(mode: mode_sym)

  [
    ["short",  SAMPLE_SHORT],
    ["medium", SAMPLE_MEDIUM],
    ["long",   SAMPLE_LONG],
  ].each do |text_label, text|
    # Warmup
    WARMUP_ITERS.times { sanitizer.sanitize(text) }

    times = bench(sanitizer, text, BENCH_ITERS)
    print_row("prompt-sanitizer  mode: :#{mode_sym}", text_label, stats(times))
  end
rescue => e
  puts "  [SKIP] #{mode_label}: #{e.message}"
  puts "  Install optional deps: gem install informers" if mode_sym == :smart
end

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

puts "\nRuby Latency Benchmark — #{BENCH_ITERS} iterations per scenario"
puts "  All times in milliseconds.  rps = calls/second at median latency.\n\n"

puts "── prompt-sanitizer ──────────────────────────────────────────────────"
print_header

bench_mode(:fast,  "FAST  (regex only, zero deps)")
bench_mode(:smart, "SMART (regex + NER via informers)")

puts "\n  Legend:"
puts "    short  = 1 sentence,  ~58 chars,  2 PII entities"
puts "    medium = 5 sentences, ~280 chars,  6 PII entities"
puts "    long   = 25 sentences,~1400 chars, 30 PII entities"
puts
