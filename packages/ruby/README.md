# prompt-sanitizer — Ruby

Bidirectional PII sanitizer for LLM pipelines.

## Installation

```ruby
gem "prompt-sanitizer"
```

## Quick start

```ruby
require "prompt_sanitizer"

sanitizer = PromptSanitizer::Sanitizer.new   # FAST mode by default

result = sanitizer.sanitize("Hi, I'm John. Reach me at john@acme.com or 555-867-5309")
puts result.text
# => "Hi, I'm [PERSON_1]. Reach me at [EMAIL_1] or [PHONE_1]"

# Multi-turn session — restore after LLM responds
session = sanitizer.session
clean   = session.anonymize(user_prompt)
reply   = YourLLMClient.chat(clean)
final   = session.deanonymize(reply)   # original values restored
```

## Modes

| Mode | How | Speed | Catches |
|------|-----|-------|---------|
| `:fast` | Regex + secrets | < 1 ms | Email, phone, SSN, CC, IBAN, IP, crypto, MAC, API keys, JWTs, AWS keys, DB strings |
| `:smart` | Fast + NER | ~25–50 ms | + Names, organisations, locations, misc entities |
| `:full` | Smart + synthetic + audit | ~25–50 ms | + Realistic fake replacements, compliance audit log |

## Configuration (Rails)

```ruby
# config/initializers/prompt_sanitizer.rb
PromptSanitizer.configure do |config|
  config.mode        = :smart
  config.ner_backend = :informers   # or :mitie
  config.ner_model   = "distilbert" # or "bert-base"
  config.audit_log   = :memory      # or :active_record
end
```

## Optional dependencies

```ruby
# SMART / FULL mode (NER)
gem "informers", ">= 1.3"   # recommended — distilbert/bert-base ONNX

# SMART / FULL mode (alternative, faster, larger model)
gem "mitie", ">= 0.4"

# FULL mode (realistic synthetic replacements)
gem "faker", ">= 2.0"
```

## Entity types detected

`EMAIL` · `PHONE` · `SSN` · `CREDIT_CARD` · `IBAN` · `IP_ADDRESS` ·
`MAC_ADDRESS` · `URL` · `ZIP_CODE` · `DATE_OF_BIRTH` · `DATE` ·
`CRYPTO_ADDRESS` · `BANK_ACCOUNT` · `PASSPORT` · `DRIVING_LICENSE` ·
`API_KEY` · `JWT` · `BEARER_TOKEN` · `AWS_ACCESS_KEY` · `AWS_SECRET_KEY` ·
`PRIVATE_KEY` · `DB_CONNECTION` · `PERSON` · `ORGANIZATION` · `LOCATION` ·
`AGE` · `CUSTOM`

## License

MIT
