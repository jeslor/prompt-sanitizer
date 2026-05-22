# frozen_string_literal: true

RSpec.describe PromptSanitizer::Engines::RegexEngine do
  subject(:engine) { described_class.new }

  # ── Validators ────────────────────────────────────────────────────────────

  describe ".luhn_valid?" do
    it "accepts a valid Visa card" do
      expect(described_class.luhn_valid?("4532015112830366")).to be true
    end

    it "rejects an invalid card number" do
      expect(described_class.luhn_valid?("4532015112830367")).to be false
    end
  end

  describe ".iban_valid?" do
    it "accepts a valid UK IBAN" do
      expect(described_class.iban_valid?("GB82 WEST 1234 5698 7654 32")).to be true
    end

    it "rejects a tampered IBAN" do
      expect(described_class.iban_valid?("GB82 WEST 1234 5698 7654 33")).to be false
    end
  end

  # ── Email ─────────────────────────────────────────────────────────────────

  describe "email detection" do
    it "detects a plain email address" do
      entities = engine.detect("Contact alice@example.com for help.")
      expect(entities.map(&:original)).to include("alice@example.com")
    end

    it "detects mixed-case email" do
      entities = engine.detect("Send to Alice.Smith@Company.ORG please.")
      expect(entities.map(&:entity_type)).to include(:email)
    end

    it "does not flag email-like text without TLD" do
      entities = engine.detect("user@localhost").select { |e| e.entity_type == :email }
      expect(entities).to be_empty
    end
  end

  # ── Phone ─────────────────────────────────────────────────────────────────

  describe "phone detection" do
    it "detects a US phone in parenthesis format" do
      entities = engine.detect("Call me at (800) 555-1234 anytime.")
      expect(entities.map(&:entity_type)).to include(:phone)
    end

    it "detects an E.164 international number" do
      entities = engine.detect("Reach me on +447946123456.")
      expect(entities.map(&:entity_type)).to include(:phone)
    end
  end

  # ── SSN ───────────────────────────────────────────────────────────────────

  describe "SSN detection" do
    it "detects a hyphenated SSN" do
      entities = engine.detect("SSN: 123-45-6789")
      expect(entities.map(&:entity_type)).to include(:ssn)
    end

    it "does not flag 000-xx-xxxx (invalid area)" do
      entities = engine.detect("000-45-6789").select { |e| e.entity_type == :ssn }
      expect(entities).to be_empty
    end
  end

  # ── Credit card ───────────────────────────────────────────────────────────

  describe "credit card detection" do
    it "detects a valid Visa card number" do
      entities = engine.detect("Card: 4532 0151 1283 0366")
      expect(entities.map(&:entity_type)).to include(:credit_card)
    end

    it "skips a Luhn-invalid card number" do
      entities = engine.detect("Bad: 4532 0151 1283 0367").select { |e| e.entity_type == :credit_card }
      expect(entities).to be_empty
    end
  end

  # ── IP address ────────────────────────────────────────────────────────────

  describe "IP address detection" do
    it "detects an IPv4 address" do
      entities = engine.detect("Server at 192.168.1.100.")
      expect(entities.map(&:entity_type)).to include(:ip_address)
    end
  end

  # ── MAC address ───────────────────────────────────────────────────────────

  describe "MAC address detection" do
    it "detects a colon-separated MAC address" do
      entities = engine.detect("Device 00:1A:2B:3C:4D:5E connected.")
      expect(entities.map(&:entity_type)).to include(:mac_address)
    end
  end

  # ── URL ───────────────────────────────────────────────────────────────────

  describe "URL detection" do
    it "detects an https URL" do
      entities = engine.detect("Visit https://example.com/path?q=1 for info.")
      expect(entities.map(&:entity_type)).to include(:url)
    end
  end

  # ── Crypto ────────────────────────────────────────────────────────────────

  describe "crypto address detection" do
    it "detects a Bitcoin P2PKH address" do
      entities = engine.detect("Send BTC to 1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf NA.")
      expect(entities.map(&:entity_type)).to include(:crypto_address)
    end

    it "detects an Ethereum address" do
      entities = engine.detect("ETH: 0x742d35Cc6634C0532925a3b8D4C9B5e1fF4C3d2.")
      expect(entities.map(&:entity_type)).to include(:crypto_address)
    end
  end

  # ── Date ──────────────────────────────────────────────────────────────────

  describe "date detection" do
    it "detects ISO date format" do
      entities = engine.detect("Born on 1990-05-15.")
      expect(entities.map(&:entity_type)).to include(:date)
    end

    it "detects written month format" do
      entities = engine.detect("Joined January 3, 2022.")
      expect(entities.map(&:entity_type)).to include(:date)
    end
  end

  # ── Custom pattern ────────────────────────────────────────────────────────

  describe "#add_pattern" do
    it "detects custom patterns added at runtime" do
      engine.add_pattern(:custom, /\bACME-\d{6}\b/)
      entities = engine.detect("Order ACME-123456 is ready.")
      expect(entities.map(&:entity_type)).to include(:custom)
    end
  end

  # ── Offsets ───────────────────────────────────────────────────────────────

  describe "character offsets" do
    it "records correct start and end positions" do
      text     = "Email: test@example.com here."
      entities = engine.detect(text).select { |e| e.entity_type == :email }
      expect(entities.first.start_pos).to eq(7)
      expect(entities.first.end_pos).to eq(23)
    end
  end
end
