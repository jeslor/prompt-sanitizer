# frozen_string_literal: true

module PromptSanitizer
  module Audit
    # Thread-safe in-memory audit log backend.
    #
    # Events are stored in a plain Array protected by a Mutex.
    # Data is lost on process restart — use this for development,
    # testing, or short-lived jobs. For persistence, implement a
    # custom backend (e.g. ActiveRecord, SQLite) using Audit::Base.
    #
    # Usage:
    #
    #   log = PromptSanitizer::Audit::MemoryAuditLog.new
    #   sanitizer = PromptSanitizer.sanitizer(audit_log: log)
    #   sanitizer.sanitize("contact john@acme.com")
    #   log.count          # => 1
    #   log.export         # => "[{\"entity_type\":\"email\", ...}]"
    class MemoryAuditLog < Base
      def initialize
        super
        @mutex  = Mutex.new
        @events = []
      end

      # @param event [AuditEvent]
      def record(event)
        @mutex.synchronize { @events << event }
        nil
      end

      # @return [Array<AuditEvent>] a frozen snapshot (thread-safe copy)
      def events
        @mutex.synchronize { @events.dup }
      end

      # @param format  [:json, :csv]
      # @param since   [String, Time, nil] e.g. "7d", "1h", Time.now - 3600
      # @param session_id [String, nil]
      # @return [String]
      def export(format: :json, since: nil, session_id: nil)
        rows = _filter(since: since, session_id: session_id).map(&:to_h)
        case format.to_sym
        when :json
          JSON.generate(rows)
        when :csv
          return "" if rows.empty?

          fields = rows.first.keys
          lines  = [fields.join(",")]
          rows.each { |r| lines << fields.map { |f| r[f].to_s }.join(",") }
          lines.join("\n")
        else
          raise ArgumentError, "Unknown format: #{format.inspect}. Use :json or :csv"
        end
      end

      # @param since [String, Time, nil]
      # @return [Integer]
      def count(since: nil)
        _filter(since: since).length
      end

      def clear
        @mutex.synchronize { @events.clear }
        nil
      end

      private

      def _filter(since: nil, session_id: nil)
        cutoff = Audit.parse_since(since)
        evts   = @mutex.synchronize { @events.dup }

        if cutoff
          evts = evts.select do |e|
            Time.parse(e.timestamp).utc >= cutoff
          end
        end

        evts = evts.select { |e| e.session_id == session_id } if session_id
        evts
      end
    end
  end
end
