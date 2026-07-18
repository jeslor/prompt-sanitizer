# frozen_string_literal: true

require "json"
require "digest"
require "fileutils"

module PromptSanitizer
  module VaultStore
    # File-backed reference store — one JSON file per session under +dir+.
    #
    # Uses only stdlib (json, digest, fileutils) — no new gem dependency,
    # consistent with this gem's "no hard runtime deps" design.
    #
    # +session_id+ is hashed into the filename (rather than used directly)
    # so an arbitrary/attacker-influenced session id can't be used for path
    # traversal.
    #
    # For real production deployments with multiple processes/servers,
    # prefer implementing VaultStore::Base against infrastructure you
    # already run (Redis, ActiveRecord, etc.) — the interface is
    # intentionally three methods wide.
    class FileVaultStore < Base
      # @param dir [String] directory to store one JSON file per session in
      def initialize(dir)
        super()
        @dir = dir
      end

      def load(session_id)
        path = path_for(session_id)
        return nil unless File.exist?(path)

        # Only the top-level keys need symbolizing (for VaultSnapshot's
        # keyword_init); mappings/counters keys must stay Strings — they're
        # PII values and entity-type names, not symbols.
        data = JSON.parse(File.read(path))
        VaultSnapshot.new(
          version: data["version"],
          session_id: data["session_id"],
          updated_at: data["updated_at"],
          mappings: data["mappings"] || {},
          counters: data["counters"] || {}
        )
      rescue JSON::ParserError => e
        raise PromptSanitizer::VaultStoreError,
              "Failed to parse stored vault snapshot for session #{session_id.inspect}: #{e.message}"
      end

      def save(session_id, snapshot)
        FileUtils.mkdir_p(@dir)
        File.write(path_for(session_id), JSON.generate(snapshot.to_h))
        nil
      rescue SystemCallError => e
        raise PromptSanitizer::VaultStoreError,
              "Failed to save vault snapshot for session #{session_id.inspect}: #{e.message}"
      end

      def delete(session_id)
        path = path_for(session_id)
        File.delete(path) if File.exist?(path)
        nil
      end

      private

      def path_for(session_id)
        digest = Digest::SHA256.hexdigest(session_id.to_s)
        File.join(@dir, "#{digest}.json")
      end
    end
  end
end
