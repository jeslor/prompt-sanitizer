# frozen_string_literal: true

RSpec.describe PromptSanitizer::SyntheticEngine do
  subject(:engine) { described_class.new }

  describe "#placeholder" do
    it "returns a bracketed token with an incrementing counter" do
      expect(engine.placeholder(:email)).to eq("[EMAIL_1]")
      expect(engine.placeholder(:email)).to eq("[EMAIL_2]")
    end

    it "tracks counters independently per entity type" do
      engine.placeholder(:email)
      engine.placeholder(:person)
      expect(engine.placeholder(:email)).to eq("[EMAIL_2]")
      expect(engine.placeholder(:person)).to eq("[PERSON_2]")
    end

    it "uppercases the entity type in the token" do
      expect(engine.placeholder(:api_key)).to eq("[API_KEY_1]")
    end
  end

  describe "#reset!" do
    it "resets all counters to zero" do
      engine.placeholder(:email)
      engine.placeholder(:person)
      engine.reset!
      expect(engine.placeholder(:email)).to eq("[EMAIL_1]")
    end
  end

  describe "#generate" do
    context "without faker gem" do
      before do
        stub_const("PromptSanitizer::SyntheticEngine::HAS_FAKER", false)
      end

      it "falls back to placeholder tokens" do
        result = engine.generate(:email, "john@acme.com")
        expect(result).to match(/\[EMAIL_\d+\]/)
      end

      it "increments the counter on each call" do
        engine.generate(:email, "a@b.com")
        expect(engine.generate(:email, "c@d.com")).to eq("[EMAIL_2]")
      end
    end

    context "with faker available", skip: !PromptSanitizer::SyntheticEngine::HAS_FAKER do
      it "generates a realistic email" do
        result = engine.generate(:email)
        expect(result).to match(/@/)
      end

      it "generates a realistic person name" do
        result = engine.generate(:person)
        expect(result).to be_a(String)
        expect(result).not_to be_empty
      end

      it "generates a phone number" do
        result = engine.generate(:phone)
        expect(result).to be_a(String)
        expect(result).not_to be_empty
      end

      it "generates a structurally valid fake SSN (NNN-NN-NNNN)" do
        result = engine.generate(:ssn)
        expect(result).to match(/\A\d{3}-\d{2}-\d{4}\z/)
      end

      it "generates a Luhn-valid fake credit card" do
        result = engine.generate(:credit_card)
        digits = result.gsub(/\s/, "").chars.map(&:to_i)
        expect(digits.length).to eq(16)
        # Luhn check
        sum = digits.reverse.each_with_index.sum do |d, i|
          if i.odd?
            doubled = d * 2
            doubled > 9 ? doubled - 9 : doubled
          else
            d
          end
        end
        expect(sum % 10).to eq(0)
      end

      it "generates an IP address in dotted-quad format" do
        result = engine.generate(:ip_address)
        expect(result).to match(/\A\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\z/)
      end

      it "generates a MAC address" do
        result = engine.generate(:mac_address)
        expect(result).to match(/\A([0-9a-f]{2}:){5}[0-9a-f]{2}\z/)
      end

      it "generates a URL starting with https" do
        result = engine.generate(:url)
        expect(result).to start_with("https://")
      end

      it "generates a date in MM/DD/YYYY format" do
        result = engine.generate(:date)
        expect(result).to match(%r{\A\d{2}/\d{2}/\d{4}\z})
      end

      it "generates a date of birth in MM/DD/YYYY format" do
        result = engine.generate(:date_of_birth)
        expect(result).to match(%r{\A\d{2}/\d{2}/\d{4}\z})
      end

      it "generates a fake ETH-style crypto address (0x + 40 hex chars)" do
        result = engine.generate(:crypto_address)
        expect(result).to match(/\A0x[0-9a-f]{40}\z/)
      end

      it "returns the static JWT placeholder" do
        result = engine.generate(:jwt)
        expect(result).to include("REDACTED_SIGNATURE")
      end

      it "generates a fake API key starting with sk-" do
        result = engine.generate(:api_key)
        expect(result).to start_with("sk-")
        expect(result.length).to be > 10
      end

      it "returns static AWS example key" do
        expect(engine.generate(:aws_access_key)).to eq("AKIAIOSFODNN7EXAMPLE")
      end

      it "returns a PEM-style private key placeholder" do
        result = engine.generate(:private_key)
        expect(result).to include("BEGIN PRIVATE KEY")
      end

      it "falls back to placeholder for unknown entity types" do
        result = engine.generate(:custom_unknown_type)
        expect(result).to match(/\[CUSTOM_UNKNOWN_TYPE_\d+\]/)
      end
    end
  end
end
