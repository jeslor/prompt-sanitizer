# frozen_string_literal: true

require "time"

module PromptSanitizer
  # Pluggable persistence for session vaults.
  #
  # A Vault normally lives only in process memory — it's gone on restart,
  # worker swap, or serverless cold start. A VaultStore lets Session
  # reattach to a previously-persisted vault by session_id, so a multi-turn
  # conversation's PII mapping survives beyond one process's lifetime.
  #
  # No store is active unless you explicitly pass one — this is opt-in and
  # changes nothing for existing callers. The bundled stores write the
  # *actual original values* (that's the point — restoration needs them),
  # so treat the underlying file/db with the same sensitivity as the source
  # PII.
  #
  # Two backends are provided, mirroring PromptSanitizer::Audit:
  # - MemoryVaultStore — in-process Hash, same-process reattach only
  # - FileVaultStore   — one JSON file per session (stdlib json + File)
  #
  # A VaultStore::Base subclass allows custom backends (e.g. Redis, ActiveRecord).
  module VaultStore
    # Current on-disk/on-wire shape of a persisted vault. Bump on breaking changes.
    VERSION = 1

    # What gets persisted for one session.
    VaultSnapshot = Struct.new(
      :version,    # Integer
      :session_id, # String
      :updated_at, # String — ISO-8601 UTC
      :mappings,   # Hash{String => String}
      :counters,   # Hash{String => Integer}
      keyword_init: true
    )

    # Builds a fresh VaultSnapshot envelope around a vault's data.
    # @param session_id [String]
    # @param data [Hash] { mappings:, counters: } — see Vault#to_data
    # @return [VaultSnapshot]
    def self.to_snapshot(session_id, data)
      VaultSnapshot.new(
        version: VERSION,
        session_id: session_id,
        updated_at: Time.now.utc.iso8601,
        mappings: data[:mappings],
        counters: data[:counters]
      )
    end

    # Raises VaultStoreError if +snapshot.version+ isn't understood.
    # @param snapshot [VaultSnapshot]
    def self.assert_supported_version!(snapshot)
      return if snapshot.version == VERSION

      raise PromptSanitizer::VaultStoreError,
            "Vault snapshot for session #{snapshot.session_id.inspect} has version " \
            "#{snapshot.version}, but this build of prompt-sanitizer only " \
            "understands version #{VERSION}."
    end

    # Abstract base class for vault persistence backends.
    #
    # Subclass and implement +load+, +save+, +delete+.
    #
    # Example custom backend:
    #
    #   class MyVaultStore < PromptSanitizer::VaultStore::Base
    #     def load(session_id) = ...    # return a VaultSnapshot or nil
    #     def save(session_id, snapshot) = ...
    #     def delete(session_id) = ...
    #   end
    class Base
      # @param _session_id [String]
      # @return [VaultSnapshot, nil]
      def load(_session_id)
        raise NotImplementedError, "#{self.class}#load is not implemented"
      end

      # @param _session_id [String]
      # @param _snapshot [VaultSnapshot]
      def save(_session_id, _snapshot)
        raise NotImplementedError, "#{self.class}#save is not implemented"
      end

      # @param _session_id [String]
      def delete(_session_id)
        raise NotImplementedError, "#{self.class}#delete is not implemented"
      end
    end
  end
end
