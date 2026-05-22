# frozen_string_literal: true

require "digest"
require "time"
require "json"

module PromptSanitizer
  module Audit
    # Immutable value object representing a single PII-detection event.
    #
    # The original PII text is *never* stored — only a 16-char SHA-256 prefix
    # hash, making the log itself safe to persist or export for compliance.
    AuditEvent = Struct.new(
      :timestamp,        # String — ISO-8601 UTC
      :entity_type,      # Symbol — EntityType constant
      :confidence,       # Float  — detection confidence 0.0..1.0
      :layer,            # Symbol — :regex | :secrets | :ner
      :redaction_method, # Symbol — :synthetic | :placeholder
      :text_hash,        # String — SHA-256[:16] of original PII (NOT the value)
      :session_id,       # String | nil — caller-supplied session identifier
      keyword_init: true
    ) do
      def to_h
        super.transform_keys(&:to_s)
      end
    end

    # Compute a SHA-256 prefix hash of a PII value for safe audit storage.
    def self.hash_value(value)
      Digest::SHA256.hexdigest(value.to_s)[0, 16]
    end

    # Return the current UTC time as an ISO-8601 string.
    def self.now_iso
      Time.now.utc.iso8601
    end

    # Parse a "since" argument into a comparable UTC Time.
    #
    # Accepts:
    # - +nil+       → no cutoff
    # - Integer     → seconds ago
    # - "7d"        → 7 days ago
    # - "12h"       → 12 hours ago
    # - Time        → as-is
    # - ISO-8601 String → parsed
    def self.parse_since(since)
      return nil if since.nil?
      return since if since.is_a?(Time)

      if since.is_a?(String)
        if since =~ /\A(\d+)d\z/
          Time.now.utc - (Regexp.last_match(1).to_i * 86_400) - 1
        elsif since =~ /\A(\d+)h\z/
          Time.now.utc - (Regexp.last_match(1).to_i * 3_600) - 1
        else
          Time.parse(since).utc
        end
      elsif since.is_a?(Integer)
        Time.now.utc - since
      end
    end

    # Abstract base class for audit log backends.
    #
    # Subclass and implement +record+, +export+, +count+, and +clear+.
    #
    # Example custom backend:
    #
    #   class MyAuditLog < PromptSanitizer::Audit::Base
    #     def record(event) = MyDB.insert(event.to_h)
    #     def export(format: :json, since: nil, session_id: nil) = "..."
    #     def count(since: nil) = MyDB.count
    #     def clear = MyDB.truncate
    #   end
    class Base
      # Record a detection event. Must not store the original PII value.
      # @param event [AuditEvent]
      def record(_event)
        raise NotImplementedError, "#{self.class}#record is not implemented"
      end

      # Export events as a formatted string.
      # @param format [Symbol] :json or :csv
      # @param since  [String, Time, nil] cutoff (e.g. "7d", "1h", Time object)
      # @param session_id [String, nil] filter to a specific session
      # @return [String]
      def export(format: :json, since: nil, session_id: nil)
        raise NotImplementedError, "#{self.class}#export is not implemented"
      end

      # Count matching events.
      # @param since [String, Time, nil]
      # @return [Integer]
      def count(since: nil)
        raise NotImplementedError, "#{self.class}#count is not implemented"
      end

      # Remove all stored events.
      def clear
        raise NotImplementedError, "#{self.class}#clear is not implemented"
      end
    end
  end
end
