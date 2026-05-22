# frozen_string_literal: true

require_relative "prompt_sanitizer/version"

module PromptSanitizer
  class Error              < StandardError; end
  class ConfigurationError < Error; end
  class ModeError          < Error; end

  # Raised when on_detect: :block and PII is found.
  # @example
  #   rescue PromptSanitizer::PIIDetectedError => e
  #     e.entities  # => Array<DetectedEntity>
  class PIIDetectedError < Error
    attr_reader :entities

    def initialize(entities)
      @entities = entities
      types = entities.map { |e| e.entity_type }.uniq.join(", ")
      super("PII detected and blocked (types: #{types})")
    end
  end

  # ── Configuration ──────────────────────────────────────────────────────────

  class Configuration
    # Detection mode: :fast, :smart, :full
    attr_accessor :mode

    # NER backend (used in :smart / :full mode): :informers, :mitie
    attr_accessor :ner_backend

    # NER model variant: "distilbert" (66 MB, default) or "bert-base" (110 MB)
    attr_accessor :ner_model

    # Vault persistence: :memory (default), :rails_cache, :active_record
    attr_accessor :vault_store

    # Audit log backend: :none (default), :memory, :active_record
    attr_accessor :audit_log

    # Locale for synthetic replacements (Faker locale string, e.g. "en", "fr")
    attr_accessor :locale

    def initialize
      @mode        = :fast
      @ner_backend = :informers
      @ner_model   = "distilbert"
      @vault_store = :memory
      @audit_log   = :none
      @locale      = "en"
    end
  end

  # ── Global helpers ──────────────────────────────────────────────────────────

  class << self
    def configuration
      @configuration ||= Configuration.new
    end

    # PromptSanitizer.configure do |config|
    #   config.mode = :smart
    # end
    def configure
      yield configuration
    end

    # Returns (and memoises) a Sanitizer built from the global configuration.
    # Safe to call from multiple threads once initialised.
    def sanitizer
      @sanitizer ||= Sanitizer.new(
        mode:        configuration.mode,
        ner_backend: configuration.ner_backend,
        ner_model:   configuration.ner_model,
        audit_log:   configuration.audit_log,
        locale:      configuration.locale
      )
    end

    # Reset global state — intended for use in tests only.
    def reset!
      @configuration = nil
      @sanitizer     = nil
    end
  end
end

# Auto-require remaining library files (loaded after the module is defined
# so they can reference PromptSanitizer constants without forward-ref errors).
require_relative "prompt_sanitizer/entities"
require_relative "prompt_sanitizer/modes"
require_relative "prompt_sanitizer/result"
require_relative "prompt_sanitizer/vault"
require_relative "prompt_sanitizer/engines/regex_engine"
require_relative "prompt_sanitizer/engines/secrets_engine"
require_relative "prompt_sanitizer/engines/ner_engine"
require_relative "prompt_sanitizer/synthetic"
require_relative "prompt_sanitizer/audit/base"
require_relative "prompt_sanitizer/audit/memory_audit_log"
require_relative "prompt_sanitizer/session"
require_relative "prompt_sanitizer/sanitizer"

# Rails integrations — loaded only when Rails is present.
if defined?(Rails)
  require_relative "prompt_sanitizer/railtie"
  require_relative "prompt_sanitizer/integrations/middleware"
  require_relative "prompt_sanitizer/integrations/action_controller"
  require_relative "prompt_sanitizer/integrations/active_job"
end
