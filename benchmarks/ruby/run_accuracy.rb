# frozen_string_literal: true

# Ruby Accuracy Benchmark — prompt-sanitizer
# ===========================================
#
# Usage:
#   cd benchmarks/ruby
#   bundle install
#   bundle exec ruby run_accuracy.rb
#
# Metric: Value-overlap matching (detected entity value ⊇ or ≈ ground-truth value),
# per entity category and overall. Reports Precision / Recall / F1.
#
# NOTE: PERSON entities require NER (mode: :smart / :full). Regex-only :fast mode
#       will show 0% recall for the 'person' category — this is expected.

require "bundler/setup"
require "json"
require "prompt_sanitizer"

# ---------------------------------------------------------------------------
# Corpus loading
# ---------------------------------------------------------------------------

CORPUS_PATH = File.expand_path("../../corpus/pii_samples.json", __dir__)

def load_corpus
  JSON.parse(File.read(CORPUS_PATH))
end

# ---------------------------------------------------------------------------
# Entity-type normalisation
# Maps PromptSanitizer's symbols → our canonical uppercase strings
# ---------------------------------------------------------------------------

TYPE_MAP = {
  email:           "EMAIL",
  phone:           "PHONE",
  ssn:             "SSN",
  credit_card:     "CREDIT_CARD",
  iban:            "IBAN",
  ip_address:      "IP_ADDRESS",
  url:             "URL",
  person:          "PERSON",
  date:            "DATE",
  crypto_address:  "CRYPTO_ADDRESS",
  api_key:         "API_KEY",
  jwt:             "JWT",
  aws_access_key:  "AWS_KEY",
}.freeze

def normalize_type(entity_type)
  TYPE_MAP[entity_type] || entity_type.to_s.upcase
end

# ---------------------------------------------------------------------------
# Matching logic
# ---------------------------------------------------------------------------

# A detection is a true-positive if its `original` value is a substring of
# the ground-truth value OR the ground-truth value is a substring of `original`.
def matches?(detected_value, ground_truth_value)
  d = detected_value.to_s.downcase.gsub(/\s+/, "")
  g = ground_truth_value.to_s.downcase.gsub(/\s+/, "")
  d.include?(g) || g.include?(d)
end

# ---------------------------------------------------------------------------
# Evaluation runner
# ---------------------------------------------------------------------------

Score = Struct.new(:tp, :fp, :fn) do
  def precision
    return 0.0 if tp + fp == 0
    tp.to_f / (tp + fp)
  end

  def recall
    return 0.0 if tp + fn == 0
    tp.to_f / (tp + fn)
  end

  def f1
    p = precision
    r = recall
    return 0.0 if p + r == 0.0
    2.0 * p * r / (p + r)
  end
end

def evaluate(mode, corpus)
  sanitizer = PromptSanitizer::Sanitizer.new(mode: mode)
  scores_by_type = Hash.new { |h, k| h[k] = Score.new(0, 0, 0) }
  overall = Score.new(0, 0, 0)

  corpus.each do |sample|
    text     = sample["text"]
    expected = sample["entities"] # [{ "type" => "EMAIL", "value" => "..." }, ...]

    result    = sanitizer.sanitize(text)
    detected  = result.entities.map { |e| [normalize_type(e.entity_type), e.original] }

    expected.each do |gt|
      gt_type  = gt["type"]
      gt_value = gt["value"]
      s = scores_by_type[gt_type]

      if detected.any? { |dtype, dval| dtype == gt_type && matches?(dval, gt_value) }
        s.tp    += 1
        overall.tp += 1
      else
        s.fn    += 1
        overall.fn += 1
      end
    end

    # False positives: detections with no matching ground truth
    detected.each do |dtype, dval|
      unless expected.any? { |gt| gt["type"] == dtype && matches?(dval, gt["value"]) }
        scores_by_type[dtype].fp += 1
        overall.fp += 1
      end
    end
  end

  [scores_by_type, overall]
end

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_results(mode_label, scores_by_type, overall)
  puts "\n── #{mode_label} ────────────────────────────────────────────────"
  puts format("  %-20s  %9s  %9s  %9s", "Category", "Precision", "Recall", "F1")
  puts format("  %-20s  %9s  %9s  %9s", "-" * 20, "-" * 9, "-" * 9, "-" * 9)

  scores_by_type.sort_by { |k, _| k }.each do |type, score|
    puts format(
      "  %-20s  %8.1f%%  %8.1f%%  %8.1f%%",
      type,
      score.precision * 100,
      score.recall    * 100,
      score.f1        * 100
    )
  end

  puts format("  %-20s  %9s  %9s  %9s", "-" * 20, "-" * 9, "-" * 9, "-" * 9)
  puts format(
    "  %-20s  %8.1f%%  %8.1f%%  %8.1f%%",
    "OVERALL",
    overall.precision * 100,
    overall.recall    * 100,
    overall.f1        * 100
  )
end

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

puts "Ruby Accuracy Benchmark — prompt-sanitizer"
puts "Corpus: #{CORPUS_PATH}"

corpus = load_corpus
puts "Loaded #{corpus.size} samples.\n"

[
  [:fast,  "prompt-sanitizer  mode: :fast  (regex only)"],
  [:smart, "prompt-sanitizer  mode: :smart (regex + NER)"],
].each do |mode, label|
  begin
    scores, overall = evaluate(mode, corpus)
    print_results(label, scores, overall)
  rescue => e
    puts "\n── #{label}"
    puts "  [SKIP] #{e.message}"
    puts "  Install optional deps: gem install informers" if mode == :smart
  end
end

puts "\n  Legend:"
puts "    FAST  = regex + secrets patterns only (zero ML deps)"
puts "    SMART = regex + distilbert NER via 'informers' gem (optional)"
puts
