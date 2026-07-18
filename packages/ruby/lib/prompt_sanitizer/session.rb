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
  #
  # By default a session's vault lives only in process memory. Pass +store:+
  # (see PromptSanitizer::VaultStore) to reattach to the same mapping later
  # — e.g. after a process restart — by session_id:
  #
  #   store = PromptSanitizer::VaultStore::FileVaultStore.new("./vault-data")
  #   sess  = sanitizer.session(session_id: "user-42", store: store)
  #   clean = sess.anonymize(user_prompt)
  #   sess.persist
  #   # ...later, possibly in a new process:
  #   resumed = sanitizer.session(session_id: "user-42", store: store)
  #   final   = resumed.deanonymize(llm_reply)
  class Session
    attr_reader :session_id, :vault

    # @param sanitizer  [Sanitizer]
    # @param session_id [String, nil]
    # @param store [VaultStore::Base, nil] if given (with session_id), any
    #   previously-persisted vault for this session is loaded synchronously
    #   before the session is returned to the caller.
    # @param auto_persist [Boolean] if true, persist to +store+ at the end
    #   of every #anonymize call. Default false — call #persist explicitly.
    def initialize(sanitizer, session_id: nil, store: nil, auto_persist: false)
      @sanitizer    = sanitizer
      @session_id   = session_id
      @vault        = Vault.new
      @store        = store
      @auto_persist = auto_persist
      _hydrate
    end

    # Sanitize +text+ using the session's shared vault.
    # Returns the redacted string.
    #
    # @param text [String]
    # @return [String]
    def anonymize(text)
      result = @sanitizer._run(text, @vault, session_id: @session_id).text
      persist if @auto_persist
      result
    end

    # Like #anonymize but returns the full SanitizeResult.
    #
    # @param text [String]
    # @return [SanitizeResult]
    def anonymize_with_result(text)
      result = @sanitizer._run(text, @vault, session_id: @session_id)
      persist if @auto_persist
      result
    end

    # Persists the current vault state to this session's store.
    #
    # @raise [VaultStoreError] if this session wasn't created with both a
    #   session_id and a store.
    def persist
      unless @store && @session_id
        raise VaultStoreError,
              "Session#persist requires both session_id and store to have " \
              "been passed to Sanitizer#session."
      end

      @store.save(@session_id, VaultStore.to_snapshot(@session_id, @vault.to_data))
      nil
    end

    # Deletes this session's persisted snapshot from its store, if any.
    # Does not clear the in-memory vault — call #reset for that too.
    def forget
      return unless @store && @session_id

      @store.delete(@session_id)
      nil
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

    private

    def _hydrate
      return unless @store && @session_id

      snapshot = @store.load(@session_id)
      return unless snapshot

      VaultStore.assert_supported_version!(snapshot)
      @vault.hydrate(mappings: snapshot.mappings, counters: snapshot.counters)
    end
  end
end
