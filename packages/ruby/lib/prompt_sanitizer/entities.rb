# frozen_string_literal: true

module PromptSanitizer
  # All PII / sensitive entity types the gem can detect.
  # Values are symbols — mirror the Python/JS string enum names.
  module EntityType
    # ── Personal identifiers ──────────────────────────────────────────────
    PERSON        = :person
    EMAIL         = :email
    PHONE         = :phone
    DATE_OF_BIRTH = :date_of_birth
    AGE           = :age

    # ── Location ──────────────────────────────────────────────────────────
    ADDRESS       = :address
    ZIP_CODE      = :zip_code

    # ── Financial ─────────────────────────────────────────────────────────
    CREDIT_CARD   = :credit_card
    IBAN          = :iban
    BANK_ACCOUNT  = :bank_account
    CRYPTO_ADDRESS = :crypto_address

    # ── Government IDs ────────────────────────────────────────────────────
    SSN             = :ssn
    PASSPORT        = :passport
    DRIVING_LICENSE = :driving_license

    # ── Network / Digital ─────────────────────────────────────────────────
    IP_ADDRESS  = :ip_address
    MAC_ADDRESS = :mac_address
    URL         = :url

    # ── Secrets & credentials ─────────────────────────────────────────────
    API_KEY        = :api_key
    JWT            = :jwt
    BEARER_TOKEN   = :bearer_token
    AWS_ACCESS_KEY = :aws_access_key
    AWS_SECRET_KEY = :aws_secret_key
    PRIVATE_KEY    = :private_key
    DB_CONNECTION  = :db_connection

    # ── Temporal ──────────────────────────────────────────────────────────
    DATE = :date

    # ── NER-only (detected by SMART / FULL mode) ──────────────────────────
    ORGANIZATION = :organization
    LOCATION     = :location
    MISC         = :misc

    # ── User-defined ──────────────────────────────────────────────────────
    CUSTOM = :custom

    ALL = constants(false).map { |c| const_get(c) }.freeze
  end
end
