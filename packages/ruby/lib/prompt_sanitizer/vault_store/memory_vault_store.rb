# frozen_string_literal: true

module PromptSanitizer
  module VaultStore
    # Same-process-only reference store — a plain Hash keyed by session_id.
    #
    # Useful for reattaching a session by id within one long-lived process
    # (e.g. a server holding many users' sessions) or in tests. Does NOT
    # survive a process restart; for that, use FileVaultStore or implement
    # VaultStore::Base against your own infrastructure.
    class MemoryVaultStore < Base
      def initialize
        super
        @mutex = Mutex.new
        @snapshots = {}
      end

      def load(session_id)
        @mutex.synchronize { @snapshots[session_id]&.dup }
      end

      def save(session_id, snapshot)
        @mutex.synchronize { @snapshots[session_id] = snapshot.dup }
        nil
      end

      def delete(session_id)
        @mutex.synchronize { @snapshots.delete(session_id) }
        nil
      end
    end
  end
end
