# Changelog — prompt-sanitizer (Ruby)

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Rails integrations**: Railtie, Rack middleware, `ActionControllerConcern`,
  `ActiveJobConcern`, and an install generator (`rails g prompt_sanitizer:install`)
- **`Session`** — multi-turn vault with `anonymize` / `deanonymize` / `anonymize_with_result`,
  block form (`session.use { |s| … }`) with automatic vault cleanup
- **`Sanitizer`** — full pipeline: regex → secrets → NER (mode-gated) → dedup →
  on_detect callback → replace → reconstruct → audit
- **`SyntheticEngine`** — Faker-backed realistic replacements for all 27 entity types;
  graceful fallback to `[TYPE_N]` tokens when Faker is not installed
- **`MemoryAuditLog`** — thread-safe, Mutex-backed audit log; JSON/CSV export;
  `since:` / `session_id:` filtering
- **`AuditEvent`** — struct capturing timestamp, session, entity type, confidence,
  mode, and SHA-256 hash of the original value (never stores raw PII)
- **`PIIDetectedError`** — raised in `:block` mode; carries `entities` array
- **`RegexEngine`** — 27 built-in patterns; `add_pattern` accepts String or Regexp
- **`SecretsEngine`** — API keys, JWTs, bearer tokens, AWS credentials, private keys,
  DB connection strings
- **`NEREngine`** — pluggable backend (`informers` distilbert / `mitie`); lazy load

### Technical notes
- Zero runtime dependencies in FAST mode
- Thread-safe throughout (Mutex-backed vault and audit log)
- Ruby ≥ 3.1 required (Ruby ≥ 3.3 needed for `informers` / `mitie` NER backends)
