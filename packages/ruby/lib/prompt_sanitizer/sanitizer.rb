# frozen_string_literal: true

module PromptSanitizer
  # Core sanitization class — the main public interface.
  #
  # Ties together RegexEngine, SecretsEngine, optional NEREngine,
  # SyntheticEngine, Vault, and AuditLog.
  #
  # Usage (one-shot):
  #
  #   s = PromptSanitizer::Sanitizer.new(mode: :fast)
  #   result = s.sanitize("Email me at john@acme.com")
  #   result.text     # => "Email me at [EMAIL_1]"
  #   result.any?     # => true
  #
  # Usage (multi-turn with session):
  #
  #   sess = s.session(session_id: "user-42")
  #   clean = sess.anonymize(user_prompt)
  #   raw_response = call_llm(clean)
  #   final = sess.deanonymize(raw_response)
  class Sanitizer
    # @param mode       [Symbol]  :fast (default), :smart, :full
    # @param locale     [String]  Faker locale (e.g. "en", "fr")
    # @param entities   [Array<Symbol>, nil]  whitelist; nil = all
    # @param on_detect  [Symbol]  :redact (default), :warn, :block
    # @param audit_log  [Audit::Base, nil]  custom audit backend
    # @param ner_backend [Symbol] :informers (default) or :mitie
    # @param ner_model   [String] NER model variant
    # @param vault_store [VaultStore::Base, nil] default store used by
    #   #session when no explicit +store:+ is given
    # rubocop:disable Metrics/ParameterLists
    def initialize(
      mode: :fast,
      locale: "en",
      entities: nil,
      on_detect: :redact,
      audit_log: nil,
      ner_backend: :informers,
      ner_model: "distilbert",
      vault_store: nil
    )
      # rubocop:enable Metrics/ParameterLists
      unless Mode.valid?(mode)
        raise ConfigurationError, "Invalid mode: #{mode.inspect}. Use :fast, :smart, or :full"
      end

      @mode      = mode
      @locale    = locale
      @on_detect = on_detect.to_sym
      @allowed   = entities ? Array(entities).map(&:to_sym).to_set : nil

      @regex   = Engines::RegexEngine.new
      @secrets = Engines::SecretsEngine.new
      @ner     = mode == :fast ? nil : Engines::NEREngine.new(backend: ner_backend, model: ner_model)

      @synthetic   = SyntheticEngine.new(locale: locale)
      @vault_store = vault_store

      @audit = if audit_log && audit_log != :none
                 audit_log
               elsif mode == :full
                 Audit::MemoryAuditLog.new
               end
    end

    # @return [Symbol] active detection mode
    attr_reader :mode

    # @return [Audit::Base, nil]
    attr_reader :audit

    # ── Public API ─────────────────────────────────────────────────────────────

    # Sanitize +text+ in a single-use vault. Returns a SanitizeResult.
    #
    # @param text       [String]
    # @param session_id [String, nil]  included in audit events
    # @return [SanitizeResult]
    def sanitize(text, session_id: nil)
      _run(text, Vault.new, session_id: session_id)
    end

    # Sanitize a list of texts, each with its own vault.
    #
    # @param texts      [Array<String>]
    # @param session_id [String, nil]
    # @return [Array<SanitizeResult>]
    def sanitize_batch(texts, session_id: nil)
      texts.map { |t| sanitize(t, session_id: session_id) }
    end

    # Create a Session for multi-turn anonymize/deanonymize workflows.
    # The session maintains a shared vault so the same PII always maps
    # to the same token, and LLM responses can be deanonymized.
    #
    # Without a block, returns a Session you manage yourself.
    # With a block, yields the Session and clears the vault after the block.
    #
    # Pass +store:+ (or configure a default via +vault_store:+ on the
    # Sanitizer) to reattach to a previously-persisted vault by
    # +session_id+ — any existing snapshot is loaded synchronously before
    # this method returns.
    #
    # @param session_id [String, nil]
    # @param store [VaultStore::Base, nil] defaults to this Sanitizer's
    #   configured vault_store, if any
    # @param auto_persist [Boolean] persist to +store+ after every #anonymize
    # @yieldparam sess [Session]
    # @return [Session, Object] the Session (no block) or block return value
    def session(session_id: nil, store: @vault_store, auto_persist: false, &block)
      sess = Session.new(self, session_id: session_id, store: store, auto_persist: auto_persist)
      return sess unless block_given?

      sess.use(&block)
    end

    # Register a custom regex pattern.
    #
    # @param entity_type [Symbol]  e.g. :custom or any EntityType
    # @param pattern     [String]  Ruby regex string
    # @param confidence  [Float]
    def add_pattern(entity_type, pattern, confidence: 0.85)
      @regex.add_pattern(entity_type.to_sym, pattern, confidence: confidence)
    end

    # Convenience: restore vault tokens in +text+ back to originals.
    # Useful when you hold a vault externally.
    #
    # @param text  [String]
    # @param vault [Vault]
    # @return [String]
    def restore(text, vault:)
      vault.restore(text)
    end

    # ── Internal pipeline (called by Session too) ──────────────────────────────

    # @api private
    def _run(text, vault, session_id: nil) # rubocop:disable Naming/MethodParameterName
      return SanitizeResult.new(text: text, original: text, entities: []) if text.nil? || text.empty?

      # 1. Collect detections from all active layers
      raw = []
      raw.concat(@regex.detect(text))
      raw.concat(@secrets.detect(text))
      raw.concat(@ner.detect(text)) if @ner

      # 2. Filter to allowed entity types
      raw = raw.select { |e| @allowed.include?(e.entity_type) } if @allowed

      # 3. Deduplicate overlapping spans
      entities = _deduplicate(raw)

      # 4. Handle on_detect modes
      if @on_detect == :block && entities.any?
        raise PIIDetectedError, entities
      end

      if @on_detect == :warn
        return SanitizeResult.new(text: text, original: text, entities: entities)
      end

      # on_detect == :redact (default)

      # 5. Assign replacements — reuse vault entry when same PII seen before
      entities.each do |entity|
        existing = vault.replacement_for(entity.original)
        if existing
          entity.replacement = existing
        else
          replacement = if @mode == :full
                          @synthetic.generate(entity.entity_type, entity.original, counters: vault)
                        else
                          @synthetic.placeholder(entity.entity_type, vault)
                        end
          entity.replacement = vault.add(entity.original, replacement)
        end
      end

      # 6. Reconstruct text right-to-left to preserve byte offsets
      chars = text.dup
      entities.reverse_each do |entity|
        chars[entity.start_pos...entity.end_pos] = entity.replacement.to_s
      end

      # 7. Record audit events
      if @audit
        entities.each do |entity|
          method = entity.replacement.to_s.start_with?("[") ? :placeholder : :synthetic
          @audit.record(
            Audit::AuditEvent.new(
              timestamp:        Audit.now_iso,
              entity_type:      entity.entity_type,
              confidence:       entity.confidence,
              layer:            entity.layer,
              redaction_method: method,
              text_hash:        Audit.hash_value(entity.original),
              session_id:       session_id
            )
          )
        end
      end

      SanitizeResult.new(text: chars, original: text, entities: entities)
    end

    private

    # Remove overlapping DetectedEntity spans.
    # Strategy: highest confidence first (then longest span), greedy non-overlap.
    # Returns entities sorted by start_pos.
    def _deduplicate(entities)
      return entities if entities.empty?

      ranked = entities.sort_by { |e| [-e.confidence, -(e.end_pos - e.start_pos)] }

      kept       = []
      kept_spans = []

      ranked.each do |entity|
        overlaps = kept_spans.any? do |s, e|
          !(entity.end_pos <= s || entity.start_pos >= e)
        end

        unless overlaps
          kept << entity
          kept_spans << [entity.start_pos, entity.end_pos]
        end
      end

      kept.sort_by(&:start_pos)
    end
  end
end
