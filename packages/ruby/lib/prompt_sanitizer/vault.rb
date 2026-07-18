# frozen_string_literal: true

module PromptSanitizer
  # Thread-safe bidirectional in-memory store for a sanitization session.
  #
  # Maps original PII values → their replacement tokens and vice-versa.
  # Deterministic within a session: the same original always maps to the
  # same replacement.
  #
  # Each vault also owns its own per-entity-type placeholder counters (the
  # "1" in "[PERSON_1]"), so a vault is a fully self-contained unit that can
  # be serialized and restored later (e.g. via a VaultStore, after a process
  # restart) without colliding with counters from unrelated sessions.
  #
  # Safe for use across Puma threads — all reads and writes are guarded by
  # a Mutex.
  class Vault
    def initialize
      @forward  = {}  # original  → replacement
      @reverse  = {}  # replacement → original
      @counters = Hash.new(0) # entity type → next index
      @mutex    = Mutex.new
    end

    # ── Write ───────────────────────────────────────────────────────────────

    # Store an original → replacement mapping.
    # If the original is already mapped, the existing replacement is returned
    # (determinism guarantee). Returns the active replacement string.
    #
    # Raises VaultCollisionError if +replacement+ is already mapped to a
    # *different* original — silently overwriting it would make the old
    # placeholder deanonymize to the wrong value.
    def add(original, replacement)
      @mutex.synchronize do
        if @forward.key?(original)
          next @forward[original]
        end

        claimed_by = @reverse[replacement]
        if claimed_by && claimed_by != original
          raise VaultCollisionError.new(replacement, claimed_by, original)
        end

        @forward[original]    = replacement
        @reverse[replacement] = original
        replacement
      end
    end

    # Returns the next counter value for +entity_type+ (starting at 1) and
    # advances it. Used to number placeholders like "[PERSON_1]".
    #
    # +entity_type+ may be a Symbol or String (e.g. :person or "PERSON") —
    # normalized internally so both forms share one counter.
    def next_count(entity_type)
      key = entity_type.to_s.upcase
      @mutex.synchronize do
        @counters[key] += 1
      end
    end

    # Ensures this vault's counter for +entity_type+ is at least +count+.
    # Used when hydrating from a persisted snapshot to guarantee newly
    # generated placeholders never reuse an already-restored token.
    def ensure_counter_at_least(entity_type, count)
      key = entity_type.to_s.upcase
      @mutex.synchronize do
        @counters[key] = count if count > @counters[key]
      end
    end

    # ── Read ────────────────────────────────────────────────────────────────

    def replacement_for(original)
      @mutex.synchronize { @forward[original] }
    end

    def original_for(replacement)
      @mutex.synchronize { @reverse[replacement] }
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
        @counters.clear
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

    # Returns a frozen copy of the per-entity-type counters.
    def counter_snapshot
      @mutex.synchronize { @counters.dup.freeze }
    end

    # Plain-data view of this vault's mappings + counters, for persistence.
    # @return [Hash] { mappings: Hash, counters: Hash }
    def to_data
      { mappings: snapshot, counters: counter_snapshot }
    end

    PLACEHOLDER_RE = /\A\[([A-Z_]+)_(\d+)\]\z/

    # Populates this (normally freshly-constructed, empty) vault from
    # previously-persisted data.
    #
    # Counters are restored from +data[:counters]+ directly, then
    # additionally reconciled by scanning +data[:mappings]+ for
    # "[TYPE_N]"-shaped tokens and bumping the counter for TYPE to at least
    # N — defense in depth for a hand-rolled VaultStore that persists
    # mappings but forgets counters. This reconciliation can't disambiguate
    # the small set of secret types that share one placeholder pattern —
    # explicit counter persistence is what makes those safe; the
    # reconciliation pass is a best-effort backstop, not a substitute for it.
    #
    # @param data [Hash] { mappings: Hash, counters: Hash }
    def hydrate(data)
      @mutex.synchronize do
        data[:mappings].each do |original, replacement|
          @forward[original]    = replacement
          @reverse[replacement] = original
        end
        data[:counters].each do |entity_type, n|
          key = entity_type.to_s.upcase
          @counters[key] = n if n > @counters[key]
        end
        data[:mappings].each_value do |replacement|
          match = PLACEHOLDER_RE.match(replacement)
          next unless match

          key = match[1]
          count = match[2].to_i
          @counters[key] = count if count > @counters[key]
        end
      end
    end

    def inspect
      "#<#{self.class.name} size=#{size}>"
    end
  end
end
