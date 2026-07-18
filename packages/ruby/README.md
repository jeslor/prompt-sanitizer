# prompt-sanitizer — Ruby

**Bidirectional PII sanitizer for LLM pipelines. Zero cloud calls. GDPR & HIPAA ready.**

Strips PII from prompts before they reach any model API, then optionally restores
original values in the response — all in-process, with no third-party telemetry.

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Modes](#modes)
- [Multi-turn sessions](#multi-turn-sessions)
- [Rails integration](#rails-integration)
  - [Rack middleware](#rack-middleware)
  - [ActionController concern](#actioncontroller-concern)
  - [ActiveJob concern](#activejob-concern)
  - [Install generator](#install-generator)
- [Audit log](#audit-log)
- [Custom patterns](#custom-patterns)
- [Entity types detected](#entity-types-detected)
- [Optional dependencies](#optional-dependencies)
- [License](#license)

---

## Installation

```ruby
# Gemfile
gem "prompt-sanitizer"
```

```bash
bundle install
```

---

## Quick start

```ruby
require "prompt_sanitizer"

sanitizer = PromptSanitizer::Sanitizer.new   # FAST mode — zero dependencies

result = sanitizer.sanitize("Hi, I'm John Doe. Reach me at john@acme.com or 555-867-5309")
puts result.text
# => "Hi, I'm [PERSON_1]. Reach me at [EMAIL_1] or [PHONE_1]"

puts result.entities.map { |e| [e.type, e.original] }.inspect
# => [[:person, "John Doe"], [:email, "john@acme.com"], [:phone, "555-867-5309"]]
```

---

## Modes

| Mode | Engines | Latency | Catches |
|------|---------|---------|---------|
| `:fast` *(default)* | Regex + Secrets | < 1 ms | Email, phone, SSN, CC, IBAN, IP, MAC, URL, ZIP, dates, crypto, bank, passport, DL, API keys, JWTs, AWS keys, DB strings |
| `:smart` | Fast + NER | ~25–50 ms | + Names, organisations, locations, miscellaneous entities |
| `:full` | Smart + Synthetic + Audit | ~25–50 ms | + Realistic fake replacements, compliance audit trail |

```ruby
# SMART mode — requires `gem "informers"` (or `gem "mitie"`)
sanitizer = PromptSanitizer::Sanitizer.new(mode: :smart)

# FULL mode — also requires `gem "faker"`
sanitizer = PromptSanitizer::Sanitizer.new(mode: :full)
```

### on_detect callbacks

```ruby
# :redact (default) — replace PII with tokens
sanitizer = PromptSanitizer::Sanitizer.new(on_detect: :redact)

# :warn — replace AND call a warning handler
sanitizer = PromptSanitizer::Sanitizer.new(
  on_detect: :warn,
  on_detect_callback: ->(entities) { Rails.logger.warn "PII: #{entities.map(&:type)}" }
)

# :block — raise PIIDetectedError immediately
sanitizer = PromptSanitizer::Sanitizer.new(on_detect: :block)
begin
  sanitizer.sanitize("SSN: 123-45-6789")
rescue PromptSanitizer::PIIDetectedError => e
  puts e.entities.first.type   # => :ssn
end
```

---

## Multi-turn sessions

Sessions share a vault across conversation turns so the original values can be
restored from the model's reply:

```ruby
sanitizer = PromptSanitizer::Sanitizer.new
session   = sanitizer.session

# Turn 1
clean_prompt = session.anonymize("Book a flight for Alice Chen, alice@example.com")
# => "Book a flight for [PERSON_1], [EMAIL_1]"

llm_reply = YourLLMClient.chat(clean_prompt)
# => "Sure! I've booked a flight for [PERSON_1] ([EMAIL_1])."

final_reply = session.deanonymize(llm_reply)
# => "Sure! I've booked a flight for Alice Chen (alice@example.com)."

# Block form — vault is cleared automatically on exit
sanitizer.session do |s|
  clean = s.anonymize(user_prompt)
  s.deanonymize(llm_client.chat(clean))
end
```

### Persisting sessions across restarts

By default a session's vault lives only in process memory. Pass `store:` to reattach to the same mapping later by `session_id` — e.g. after a Puma worker restart:

```ruby
store   = PromptSanitizer::VaultStore::FileVaultStore.new(Rails.root.join("tmp/vault"))
session = sanitizer.session(session_id: "user-42", store: store)
clean   = session.anonymize(user_prompt)
session.persist

# ...later, possibly in a new process:
resumed = sanitizer.session(session_id: "user-42", store: store)
final_reply = resumed.deanonymize(llm_reply)
```

`MemoryVaultStore` is the zero-dependency, same-process reference store; `FileVaultStore` persists one JSON file per session (stdlib only). Pass `auto_persist: true` to persist automatically after every `#anonymize` call instead of calling `#persist` yourself. Configure a default store for every session via `PromptSanitizer.configure { |c| c.vault_store = ... }` — see the Rails initializer template. No store is active unless one is configured.

---

## Rails integration

### Install generator

```bash
rails generate prompt_sanitizer:install
```

This creates `config/initializers/prompt_sanitizer.rb` with all options commented.

### Initializer

```ruby
# config/initializers/prompt_sanitizer.rb
PromptSanitizer.configure do |config|
  config.mode        = :smart           # :fast | :smart | :full
  config.ner_backend = :informers       # :informers | :mitie
  config.on_detect   = :redact          # :redact | :warn | :block
  config.audit_log   = :memory          # :memory (more backends coming)
end
```

### Rack middleware

Automatically sanitizes JSON request bodies before they hit your controllers.
Supports `prompt`, `messages[].content` (OpenAI format), `input`, `text`, `query`.

```ruby
# config/initializers/prompt_sanitizer.rb
PromptSanitizer.configure do |config|
  config.use_middleware     = true
  config.middleware_routes  = ["/api/"]       # only sanitize these path prefixes
  config.restore_response   = false           # set true to deanonymize JSON responses
end
```

Alternatively, insert manually:

```ruby
# config/application.rb
config.middleware.use PromptSanitizer::Integrations::SanitizerMiddleware,
  routes: ["/api/v1/chat"],
  restore_response: false
```

### ActionController concern

Fine-grained control inside individual actions:

```ruby
class ChatController < ApplicationController
  include PromptSanitizer::Integrations::ActionControllerConcern

  def create
    # Sanitize specific params in-place
    sanitize_params!(:prompt, :message)

    # Or use a multi-turn session scoped to this request
    with_pii_session do |session|
      clean   = session.anonymize(params[:prompt])
      raw     = LLMClient.chat(clean)
      @reply  = session.deanonymize(raw)
    end
  end
end
```

### ActiveJob concern

Scrubs PII from job arguments before the job performs:

```ruby
class LLMJob < ApplicationJob
  include PromptSanitizer::Integrations::ActiveJobConcern

  sanitize_argument :prompt   # sanitized in-place before perform

  def perform(prompt:, user_id:)
    LLMClient.chat(prompt)    # prompt is already clean
  end
end
```

---

## Audit log

The audit log records every sanitization event — entity type, confidence, session ID,
and a SHA-256 hash of the original value. **Raw PII is never stored.**

```ruby
PromptSanitizer.configure do |c|
  c.audit_log = :memory
end

sanitizer = PromptSanitizer::Sanitizer.new(mode: :full)
sanitizer.sanitize("Call Jane at 555-123-4567")

log = PromptSanitizer.audit_log
puts log.count                          # => 1
puts log.export(format: :json)          # JSON array of events
puts log.export(since: "1h")            # events in the last hour
```

---

## Custom patterns

```ruby
sanitizer = PromptSanitizer::Sanitizer.new
sanitizer.add_pattern(/EMP-\d{6}/, :custom)   # employee IDs
sanitizer.sanitize("Assigned to EMP-004821")
# => "Assigned to [CUSTOM_1]"
```

---

## Entity types detected

`EMAIL` · `PHONE` · `SSN` · `CREDIT_CARD` · `IBAN` · `IP_ADDRESS` ·
`MAC_ADDRESS` · `URL` · `ZIP_CODE` · `DATE_OF_BIRTH` · `DATE` ·
`CRYPTO_ADDRESS` · `BANK_ACCOUNT` · `PASSPORT` · `DRIVING_LICENSE` ·
`API_KEY` · `JWT` · `BEARER_TOKEN` · `AWS_ACCESS_KEY` · `AWS_SECRET_KEY` ·
`PRIVATE_KEY` · `DB_CONNECTION` · `PERSON` · `ORGANIZATION` · `LOCATION` ·
`AGE` · `CUSTOM`

---

## Optional dependencies

| Gem | Version | Required for |
|-----|---------|-------------|
| [`informers`](https://github.com/ankane/informers) | `>= 1.3` | SMART / FULL mode NER (recommended) |
| [`mitie`](https://github.com/ankane/mitie) | `>= 0.4` | SMART / FULL mode NER (alternative) |
| [`faker`](https://github.com/faker-ruby/faker) | `>= 2.0` | FULL mode synthetic replacements |

> **Note:** `informers` and `mitie` require Ruby ≥ 3.3.

---

## License

MIT

