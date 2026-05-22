# frozen_string_literal: true

require_relative "lib/prompt_sanitizer/version"

Gem::Specification.new do |spec|
  spec.name    = "prompt-sanitizer"
  spec.version = PromptSanitizer::VERSION
  spec.authors = ["Jeslor"]
  spec.email   = ["hi@jeslor.com"]

  spec.summary     = "Bidirectional PII sanitizer for LLM pipelines — Ruby edition"
  spec.description = <<~DESC
    A lightweight, production-ready PII sanitizer built specifically for LLM
    pipelines. Detects and redacts emails, phone numbers, SSNs, credit cards,
    API keys, JWTs, AWS credentials, and more before prompts reach any model
    API. Supports bidirectional sanitization (strip before, restore after) and
    multi-turn session vaults. Zero cloud calls. GDPR & HIPAA ready.
  DESC

  spec.homepage              = "https://www.jeslor.com/prompt-sanitizer"
  spec.license               = "MIT"
  spec.required_ruby_version = ">= 3.1"


  spec.metadata = {
    "homepage_uri"    => spec.homepage,
    "source_code_uri" => "https://github.com/jeslor/prompt-sanitizer/tree/main/packages/ruby",
    "changelog_uri"   => "https://github.com/jeslor/prompt-sanitizer/blob/main/packages/ruby/CHANGELOG.md",
    "bug_tracker_uri" => "https://github.com/jeslor/prompt-sanitizer/issues",
    "documentation_uri" => "https://rubydoc.info/gems/prompt-sanitizer" # Optional fallback
  }

  spec.files = Dir[
    "lib/**/*",
    "LICENSE",
    "README.md",
    "CHANGELOG.md"
  ]

  spec.require_paths = ["lib"]

  # ── Runtime dependencies ──────────────────────────────────────────────────
  # No hard runtime deps — FAST mode works with zero dependencies.

  # ── Optional runtime dependencies ────────────────────────────────────────
  # SMART / FULL mode — NER via ONNX transformer (recommended)
  # gem "informers", ">= 1.3", "< 2"

  # SMART / FULL mode — NER via MITIE (faster, larger model, 3 entity types)
  # gem "mitie", ">= 0.4", "< 1"

  # FULL mode — realistic synthetic replacements
  # gem "faker", ">= 2.0"

  # ── Development dependencies ──────────────────────────────────────────────
  spec.add_development_dependency "rspec",       "~> 3.13"
  spec.add_development_dependency "rake",        "~> 13.0"
  spec.add_development_dependency "rubocop",     "~> 1.60"
end
