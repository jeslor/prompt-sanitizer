# frozen_string_literal: true

RSpec.describe PromptSanitizer::Vault do
  subject(:vault) { described_class.new }

  describe "#add / #replacement_for" do
    it "stores a mapping and returns the replacement" do
      result = vault.add("john@example.com", "[EMAIL_1]")
      expect(result).to eq("[EMAIL_1]")
      expect(vault.replacement_for("john@example.com")).to eq("[EMAIL_1]")
    end

    it "is deterministic — same original always returns the same replacement" do
      vault.add("john@example.com", "[EMAIL_1]")
      second = vault.add("john@example.com", "[EMAIL_2]")  # should be ignored
      expect(second).to eq("[EMAIL_1]")
    end
  end

  describe "#original_for" do
    it "looks up originals by replacement token" do
      vault.add("555-867-5309", "[PHONE_1]")
      expect(vault.original_for("[PHONE_1]")).to eq("555-867-5309")
    end
  end

  describe "#restore" do
    it "replaces all tokens with their originals" do
      vault.add("Alice", "[PERSON_1]")
      vault.add("alice@example.com", "[EMAIL_1]")
      text = "Hello [PERSON_1], your email [EMAIL_1] is on file."
      expect(vault.restore(text)).to eq("Hello Alice, your email alice@example.com is on file.")
    end

    it "handles longest token first to avoid partial substitutions" do
      vault.add("foo@x.com", "[EMAIL_1]")
      vault.add("bar@x.com", "[EMAIL_10]")
      text = "[EMAIL_10] and [EMAIL_1]"
      restored = vault.restore(text)
      expect(restored).to eq("bar@x.com and foo@x.com")
    end
  end

  describe "#clear" do
    it "removes all mappings" do
      vault.add("secret", "[API_KEY_1]")
      vault.clear
      expect(vault.size).to eq(0)
      expect(vault.replacement_for("secret")).to be_nil
    end
  end

  describe "thread safety" do
    it "handles concurrent writes without corruption" do
      threads = 20.times.map do |i|
        Thread.new { vault.add("value_#{i}", "[TOKEN_#{i}]") }
      end
      threads.each(&:join)
      expect(vault.size).to eq(20)
    end
  end
end
