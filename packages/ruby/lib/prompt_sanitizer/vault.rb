# frozen_string_literal: true

module PromptSanitizer
  # Thread-safe bidirectional in-memory store for a sanitization session.
  #
  # Maps original PII values → their replacement tokens and vice-versa.
  # Deterministic within a session: the same original always maps to the
  # same replacement. The vault is never persisted — it lives only in memory.
  #
  # Safe for use across Puma threads — all reads and writes are guarded by
  # a Mutex.
  class Vault
    def initialize
      @forward = {}  # original  → replacement
      @reverse = {}  # replacement → original
      @mutex   = Mutex.new
    end

    # ── Write ───────────────────────────────────────────────────────────────

    # Store an original → replacement mapping.
    # If the original is already mapped, the existing replacement is returned
    # (determinism guarantee). Returns the active replacement string.
    def add(original, replacement)
      @mutex.synchronize do
        unless @forward.key?(original)
          @forward[original]    = replacement
          @reverse[replacement] = original
        end
        @forward[original]
      end
    end

    # ── Read ────────────────────────────────────────────────────────────────

    def replacement_for(original)
      @forward[original]
    end

    def original_for(replacement)
      @reverse[replacement]
    end

    # ── Restore ─────────────────────────────────────────────────────────────

    # Replace all known replacement tokens in +text+ with their originals.
    # Tokens are substituted longest-first to avoid partial matches
    # (e.g. "[EMAIL_1]" before "[EMAIL]").
    def restore(text)
      @mutex.synchronize do
        result = text.dup
        @reverse
          .keys
          .sort_by { |k| -k.length }
          .each { |token| result.gsub!(token, @reverse[token]) }
        result
      end
    end

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def clear
      @mutex.synchronize do
        @forward.clear
        @reverse.clear
      end
    end

    # ── Introspection ────────────────────────────────────────────────────────

    def size = @forward.size
    alias length size

    def empty? = @forward.empty?

    def include?(original) = @forward.key?(original)

    # Returns a frozen copy of the forward mapping (original → replacement).
    # Safe to call from any thread.
    def snapshot
      @mutex.synchronize { @forward.dup.freeze }
    end

    def inspect
      "#<#{self.class.name} size=#{size}>"
    end
  end
end
