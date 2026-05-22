# frozen_string_literal: true

module PromptSanitizer
  # Generates realistic fake replacement values per EntityType.
  #
  # When the +faker+ gem is installed, each call produces a
  # contextually appropriate fake (names, emails, IPs, …).
  # Without faker the engine falls back to sequential placeholder
  # tokens: +[EMAIL_1]+, +[PERSON_2]+, etc.
  #
  # Determinism within a session is guaranteed by the Vault: the
  # same original value always receives the same token/fake because
  # Session#anonymize only calls +generate+ once per unique original.
  #
  # Usage:
  #
  #   engine = SyntheticEngine.new(locale: "en_US")
  #   engine.generate(:email, "john@acme.com")   # => "xavier@mailnull.net"
  #   engine.generate(:person, "Alice Smith")    # => "Carlos Rivera"
  class SyntheticEngine
    CHARS_ALPHA_NUM = ("a".."z").to_a + ("A".."Z").to_a + ("0".."9").to_a

    begin
      require "faker"
      HAS_FAKER = true
    rescue LoadError
      HAS_FAKER = false
    end

    # @param locale [String] BCP-47 locale tag forwarded to Faker (e.g. "en", "fr", "de")
    def initialize(locale: "en")
      @locale   = locale
      @counters = Hash.new(0) # entity_type Symbol → Integer
      if HAS_FAKER
        Faker::Config.locale = locale
      end
    end

    # Returns a fake replacement string for +entity_type+.
    #
    # @param entity_type [Symbol]  one of the EntityType constants
    # @param _original   [String]  original text (unused here; determinism via Vault)
    # @return [String]
    def generate(entity_type, _original = "")
      if HAS_FAKER
        faker_value(entity_type)
      else
        placeholder(entity_type)
      end
    end

    # Force a placeholder token regardless of faker availability.
    # Used by Session when the replacement must survive round-trips.
    def placeholder(entity_type)
      @counters[entity_type] += 1
      "[#{entity_type.to_s.upcase}_#{@counters[entity_type]}]"
    end

    def reset!
      @counters.clear
    end

    private

    # rubocop:disable Metrics/MethodLength, Metrics/CyclomaticComplexity
    def faker_value(entity_type) # rubocop:disable Metrics/AbcSize
      case entity_type
      when :person
        Faker::Name.name
      when :email
        Faker::Internet.email
      when :phone
        Faker::PhoneNumber.phone_number
      when :ssn
        "#{rand(100..899).to_s.rjust(3, "0")}-" \
          "#{rand(10..99).to_s.rjust(2, "0")}-" \
          "#{rand(1000..9999)}"
      when :credit_card
        fake_luhn_card
      when :iban
        "GB#{rand(10..99)}MOCK" \
          "#{rand(10_000_000..99_999_999)}" \
          "#{rand(100_000_000_000..999_999_999_999)}"
      when :ip_address
        "#{rand(1..254)}.#{rand(0..255)}.#{rand(0..255)}.#{rand(1..254)}"
      when :mac_address
        Array.new(6) { rand(0..255).to_s(16).rjust(2, "0") }.join(":")
      when :url
        "https://#{Faker::Internet.domain_name}/#{Faker::Internet.slug}"
      when :address
        Faker::Address.full_address.tr("\n", ", ")
      when :zip_code
        Faker::Address.postcode
      when :date
        Faker::Date.between(from: "1990-01-01", to: "2020-12-31").strftime("%m/%d/%Y")
      when :date_of_birth
        Faker::Date.birthday(min_age: 18, max_age: 80).strftime("%m/%d/%Y")
      when :crypto_address
        "0x" + Array.new(40) { rand(0..15).to_s(16) }.join
      when :passport
        "#{("A".."Z").to_a.sample}#{rand(10_000_000..99_999_999)}"
      when :driving_license
        "#{("A".."Z").to_a.sample}#{rand(100_000..999_999)}"
      when :organization
        Faker::Company.name
      when :location
        Faker::Address.city
      when :api_key
        "sk-" + Array.new(48) { CHARS_ALPHA_NUM.sample }.join
      when :jwt, :jwt_token
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJSRURBQ1RFRCJ9.REDACTED_SIGNATURE"
      when :bearer_token, :oauth_token
        "REDACTED_" + Array.new(16) { (("A".."Z").to_a + ("0".."9").to_a).sample }.join
      when :aws_access_key
        "AKIA" + Array.new(16) { (("A".."Z").to_a + ("0".."9").to_a).sample }.join
      when :aws_secret_key
        Array.new(40) { (("a".."z").to_a + ("A".."Z").to_a + ("0".."9").to_a + ["+", "/"]).sample }.join
      when :private_key
        "-----BEGIN PRIVATE KEY-----\nREDACTED\n-----END PRIVATE KEY-----"
      when :db_connection, :database_url
        "postgresql://user:password@localhost:5432/#{Faker::Lorem.word}"
      when :secret_key, :password
        placeholder(entity_type)
      else
        placeholder(entity_type)
      end
    end
    # rubocop:enable Metrics/MethodLength, Metrics/CyclomaticComplexity

    # Generates a Luhn-valid 16-digit fake Visa card number.
    def fake_luhn_card
      digits = [4] + Array.new(14) { rand(0..9) }

      # Calculate check digit — double digits at even indices (0,2,4,...,14)
      # so that in the final 16-digit number they sit at even positions from
      # the right (2,4,...,16) as required by the Luhn algorithm.
      sum = digits.each_with_index.sum do |d, i|
        if i.even?
          doubled = d * 2
          doubled > 9 ? doubled - 9 : doubled
        else
          d
        end
      end
      check = (10 - (sum % 10)) % 10
      digits << check

      raw = digits.join
      "#{raw[0, 4]} #{raw[4, 4]} #{raw[8, 4]} #{raw[12, 4]}"
    end
  end
end
