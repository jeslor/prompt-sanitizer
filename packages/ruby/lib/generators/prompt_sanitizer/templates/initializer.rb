# frozen_string_literal: true

PromptSanitizer.configure do |config|
  # Detection mode:
  #   :fast  — regex + secrets patterns only. Zero ML deps. Best for production
  #            where latency matters and NER is not required. (default)
  #   :smart — adds NER via the `informers` gem (distilbert-NER, ~66 MB).
  #            Catches names, orgs, and locations missed by regex alone.
  #   :full  — SMART + in-memory audit log. Every detection event is recorded
  #            (hashed, never raw PII) for compliance export.
  config.mode = :fast

  # BCP-47 locale used by the synthetic replacement engine (Faker).
  # e.g. "en", "fr", "de", "es", "ja"
  config.locale = "en"

  # NER backend — used only when mode is :smart or :full.
  #   :informers — distilbert-NER (ONNX, int8, ~66 MB). Downloads once to
  #                ~/.cache/huggingface/ on first call. Recommended.
  #   :mitie     — MITIE C++ library (~600 MB model). Faster than informers
  #                but requires a separate model file and the `mitie` gem.
  config.ner_backend = :informers

  # Optional: supply a custom audit log backend (must inherit from
  # PromptSanitizer::Audit::Base). When nil, a MemoryAuditLog is used
  # automatically in :full mode.
  # config.audit_log = MyActiveRecordAuditLog.new

  # Default vault persistence used by Sanitizer#session when no explicit
  # store: is passed — lets a session be reattached by session_id, e.g.
  # after a worker restart. :memory (default) only survives within this
  # process; pass an instance for real persistence (must inherit from
  # PromptSanitizer::VaultStore::Base).
  # config.vault_store = :memory
  # config.vault_store = PromptSanitizer::VaultStore::FileVaultStore.new(Rails.root.join("tmp/vault"))
  # config.vault_store = MyActiveRecordVaultStore.new
end

# ── Optional: Rack middleware ──────────────────────────────────────────────────
# Auto-sanitize JSON request bodies (messages[].content, prompt, input, …)
# before they reach your controllers. Uncomment to enable.
#
# Rails.application.config.prompt_sanitizer.middleware        = true
# Rails.application.config.prompt_sanitizer.middleware_routes = ["/api/llm", "/chat"]
# Rails.application.config.prompt_sanitizer.restore_response  = false
