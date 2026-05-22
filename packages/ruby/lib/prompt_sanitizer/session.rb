# frozen_string_literal: true

module PromptSanitizer
  # Maintains a shared Vault across multiple anonymize/deanonymize calls.
  #
  # The same PII value always maps to the same replacement token within a
  # session, and LLM responses can be deanonymized back to the originals.
  #
  # Usage:
  #
  #   sanitizer = PromptSanitizer::Sanitizer.new(mode: :smart)
  #
  #   # Single-use block (vault cleared on exit):
  #   sanitizer.session(session_id: "user-42") do |sess|
  #     clean    = sess.anonymize(user_prompt)
  #     response = call_llm(clean)
  #     puts sess.deanonymize(response)
  #   end
  #
  #   # Long-lived (manage lifecycle yourself):
  #   sess = sanitizer.session
  #   loop { sess.anonymize(...) ... }
  #   sess.reset
  class Session
    attr_reader :session_id, :vault

    # @param sanitizer  [Sanitizer]
    # @param session_id [String, nil]
    def initialize(sanitizer, session_id: nil)
      @sanitizer  = sanitizer
      @session_id = session_id
      @vault      = Vault.new
    end

    # Sanitize +text+ using the session's shared vault.
    # Returns the redacted string.
    #
    # @param text [String]
    # @return [String]
    def anonymize(text)
      @sanitizer._run(text, @vault, session_id: @session_id).text
    end

    # Like #anonymize but returns the full SanitizeResult.
    #
    # @param text [String]
    # @return [SanitizeResult]
    def anonymize_with_result(text)
      @sanitizer._run(text, @vault, session_id: @session_id)
    end

    # Restore vault tokens in +text+ back to the original PII values.
    # Pass the LLM's response here to get a human-readable output.
    #
    # @param text [String]
    # @return [String]
    def deanonymize(text)
      @vault.restore(text)
    end

    # Snapshot of original → replacement mapping for this session.
    #
    # @return [Hash{String => String}]
    def mapping
      @vault.snapshot
    end

    # Number of unique PII values currently stored in the session vault.
    #
    # @return [Integer]
    def size
      @vault.snapshot.size
    end

    # Clear the vault, resetting the session for a fresh conversation.
    def reset
      @vault.clear
    end

    # Block form — vault is cleared after the block returns.
    #
    #   sanitizer.session { |s| s.anonymize(...) }
    #
    # @yieldparam session [Session] self
    # @return the block's return value
    def use
      yield self
    ensure
      reset
    end

    def inspect
      "#<PromptSanitizer::Session id=#{@session_id.inspect} mappings=#{size}>"
    end
    alias to_s inspect
  end
end
