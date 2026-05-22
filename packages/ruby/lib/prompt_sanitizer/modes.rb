# frozen_string_literal: true

module PromptSanitizer
  module Mode
    # Regex + secrets only. Sub-millisecond. Zero dependencies.
    # Catches: email, phone, SSN, credit card, IBAN, IP, crypto, MAC, URL,
    # API keys, JWTs, bearer tokens, AWS keys, DB connection strings,
    # private keys, passport, driving licence, date-of-birth.
    FAST = :fast

    # FAST + NER (informers/distilbert or mitie). ~25–50 ms on CPU.
    # Additionally catches: names, organisations, locations, misc entities.
    # Requires: gem "informers"  (or gem "mitie")
    SMART = :smart

    # Everything in SMART plus synthetic replacements and audit logging.
    # Requires: gem "informers", gem "faker"
    FULL = :full

    ALL = [FAST, SMART, FULL].freeze

    def self.valid?(mode)
      ALL.include?(mode)
    end
  end
end
