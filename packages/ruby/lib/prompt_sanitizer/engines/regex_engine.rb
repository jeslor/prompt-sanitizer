# frozen_string_literal: true

module PromptSanitizer
  module Engines
    # Regex Engine — Layer 1 of prompt-sanitizer.
    #
    # Detects structured PII (email, phone, SSN, credit cards, IBANs, IPs,
    # crypto addresses, MAC addresses, URLs, passport numbers, driving licences,
    # and date patterns) using regular expressions with optional checksum
    # validation (Luhn for credit cards, IBAN mod-97).
    #
    # All patterns run on every sanitize() call regardless of Mode.
    class RegexEngine
      Pattern = Struct.new(:entity_type, :regex, :confidence, :validator, keyword_init: true)

      # ── Validators ──────────────────────────────────────────────────────────

      # Luhn algorithm — validates credit/debit card numbers.
      def self.luhn_valid?(card)
        digits = card.gsub(/\D/, "").chars.map(&:to_i)
        return false if digits.size < 13

        total = digits.reverse.each_with_index.sum do |d, i|
          i.odd? ? [d * 2 - 9, d * 2].min + (d * 2 >= 10 ? 0 : 0) : d
          # Standard Luhn: double every second digit from the right
          if i.odd?
            doubled = d * 2
            doubled > 9 ? doubled - 9 : doubled
          else
            d
          end
        end
        total % 10 == 0
      end

      # IBAN mod-97 validation.
      def self.iban_valid?(iban)
        raw = iban.gsub(/[\s\-]/, "").upcase
        return false unless raw.length.between?(15, 34)

        rearranged = raw[4..] + raw[0..3]
        numeric    = rearranged.chars.map { |c| c =~ /[A-Z]/ ? (c.ord - 55).to_s : c }.join
        numeric.to_i % 97 == 1
      rescue ArgumentError
        false
      end

      # ── Pattern registry ─────────────────────────────────────────────────────

      PATTERNS = [
        # ── Email ──────────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::EMAIL,
          regex:       /(?<![a-zA-Z0-9._%+\-])[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,253}\.[a-zA-Z]{2,}(?![a-zA-Z0-9._%+\-@])/i,
          confidence:  0.99
        ),

        # ── US phone ───────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::PHONE,
          regex:       /(?<!\d)(?:\+?1[\s.\-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/,
          confidence:  0.85
        ),

        # ── International phone — compact E.164 e.g. +447946123456 ────────────
        Pattern.new(
          entity_type: EntityType::PHONE,
          regex:       /(?<!\d)\+[1-9]\d{6,14}(?!\d)/,
          confidence:  0.80
        ),

        # ── International phone — spaced/dashed e.g. +44 20 7946 0958 ─────────
        Pattern.new(
          entity_type: EntityType::PHONE,
          regex:       /(?<!\d)\+[1-9]\d{0,3}(?:[\s.\-]\d{2,4}){2,4}(?!\d)/,
          confidence:  0.78
        ),

        # ── US SSN ─────────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::SSN,
          regex:       /(?<!\d)(?!000|666|9\d{2})\d{3}[\s\-](?!00)\d{2}[\s\-](?!0000)\d{4}(?!\d)/,
          confidence:  0.95
        ),

        # ── Credit / debit card (Luhn-validated) ──────────────────────────────
        Pattern.new(
          entity_type: EntityType::CREDIT_CARD,
          regex:       /(?<!\d)(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|3(?:0[0-5]|[68][0-9])[0-9]|6(?:011|5[0-9]{2})|(?:2131|1800|35\d{3}))[\s\-]?(?:\d{4}[\s\-]?){2}\d{1,4}(?!\d)/,
          confidence:  0.95,
          validator:   ->(m) { luhn_valid?(m) }
        ),

        # ── IBAN (mod-97 validated) ────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::IBAN,
          regex:       /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4}\b/i,
          confidence:  0.92,
          validator:   ->(m) { iban_valid?(m) }
        ),

        # ── IPv4 ───────────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::IP_ADDRESS,
          regex:       /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?!\d)/,
          confidence:  0.90
        ),

        # ── IPv6 (full and compressed forms) ──────────────────────────────────
        Pattern.new(
          entity_type: EntityType::IP_ADDRESS,
          regex:       /(?<![:\w])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,4}[0-9a-fA-F]{1,4})(?![:\w])/i,
          confidence:  0.90
        ),

        # ── MAC address ────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::MAC_ADDRESS,
          regex:       /(?<![:\w])(?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}(?![:\w])/i,
          confidence:  0.90
        ),

        # ── URL (http/https) ───────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::URL,
          regex:       /https?:\/\/(?:[a-zA-Z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]|(?:%[0-9a-fA-F]{2}))+/i,
          confidence:  0.85
        ),

        # ── Bitcoin address (P2PKH, P2SH, Bech32) ─────────────────────────────
        Pattern.new(
          entity_type: EntityType::CRYPTO_ADDRESS,
          regex:       /(?<![a-zA-Z0-9])(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87})(?![a-zA-Z0-9])/,
          confidence:  0.88
        ),

        # ── Ethereum address ───────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::CRYPTO_ADDRESS,
          regex:       /(?<![a-fA-F0-9])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/,
          confidence:  0.92
        ),

        # ── US Passport ────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::PASSPORT,
          regex:       /(?<![A-Z0-9])[A-Z]{1,2}\d{7,9}(?![A-Z0-9])/,
          confidence:  0.72
        ),

        # ── US ZIP code ────────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::ZIP_CODE,
          regex:       /(?<!\d)\d{5}(?:-\d{4})?(?!\d)/,
          confidence:  0.55
        ),

        # ── Date patterns (DD/MM/YYYY, YYYY-MM-DD, Month DD YYYY, etc.) ────────
        Pattern.new(
          entity_type: EntityType::DATE,
          regex:       /(?<!\d)(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})(?!\d)/i,
          confidence:  0.75
        ),
      ].freeze

      # ── Instance ─────────────────────────────────────────────────────────────

      def initialize
        @patterns = PATTERNS.dup
      end

      # Register a custom regex pattern at runtime.
      #
      #   engine.add_pattern(:custom, /\bACME-\d{6}\b/, confidence: 0.90)
      def add_pattern(entity_type, regex, confidence: 0.80, validator: nil)
        @patterns << Pattern.new(
          entity_type: entity_type,
          regex:       regex,
          confidence:  confidence,
          validator:   validator
        )
      end

      # Run all patterns against +text+ and return an Array of DetectedEntity.
      # Overlapping matches from different patterns are kept — deduplication
      # happens in the Sanitizer, which has the full multi-engine view.
      def detect(text)
        safe_text = text.encode("UTF-8", invalid: :replace, undef: :replace, replace: "")
        entities  = []

        @patterns.each do |pat|
          safe_text.scan(pat.regex) do
            m     = Regexp.last_match
            value = m[0]

            next if pat.validator && !self.class.instance_exec(value, &pat.validator)

            entities << DetectedEntity.new(
              entity_type: pat.entity_type,
              original:    value,
              replacement: nil,
              start_pos:   m.begin(0),
              end_pos:     m.end(0),
              confidence:  pat.confidence,
              layer:       :regex
            )
          end
        end

        entities
      end
    end
  end
end
