# frozen_string_literal: true

module PromptSanitizer
  # Represents a single detected PII entity.
  DetectedEntity = Struct.new(
    :entity_type,   # Symbol — EntityType constant (e.g. :email)
    :original,      # String — the raw PII value found in text
    :replacement,   # String — the placeholder token (e.g. "[EMAIL_1]")
    :start_pos,     # Integer — character offset in the *original* text
    :end_pos,       # Integer — end offset (exclusive) in the *original* text
    :confidence,    # Float — detection confidence 0.0..1.0
    :layer,         # Symbol — :regex | :secrets | :ner
    keyword_init: true
  )

  # Returned by Sanitizer#sanitize and Session#anonymize_with_result.
  SanitizeResult = Struct.new(
    :text,      # String  — sanitized text with PII replaced by tokens
    :original,  # String  — the original unsanitized input
    :entities,  # Array<DetectedEntity> — all entities found
    keyword_init: true
  ) do
    # Number of PII entities detected.
    def count = entities.size

    # True if any PII was found.
    def any? = entities.any?

    # Entities filtered by type.
    def by_type(type) = entities.select { |e| e.entity_type == type }

    # Mapping of original values to their replacement tokens.
    def mapping
      entities.each_with_object({}) { |e, h| h[e.original] = e.replacement }
    end
  end
end
