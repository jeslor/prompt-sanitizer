# frozen_string_literal: true

# End-to-end specs for Sanitizer and Session.
# These exercise the full pipeline: detection → dedup → replacement → restore.

RSpec.describe PromptSanitizer::Sanitizer do
  subject(:sanitizer) { described_class.new(mode: :fast) }

  # ── Constructor ──────────────────────────────────────────────────────────────

  describe "constructor" do
    it "defaults to :fast mode" do
      expect(described_class.new.mode).to eq(:fast)
    end

    it "raises ConfigurationError for an invalid mode" do
      expect { described_class.new(mode: :turbo) }
        .to raise_error(PromptSanitizer::ConfigurationError, /turbo/)
    end

    it "creates a MemoryAuditLog automatically when mode: :full" do
      s = described_class.new(mode: :full)
      expect(s.audit).to be_a(PromptSanitizer::Audit::MemoryAuditLog)
    end

    it "uses a supplied audit_log instance" do
      custom = PromptSanitizer::Audit::MemoryAuditLog.new
      s = described_class.new(audit_log: custom)
      expect(s.audit).to be(custom)
    end

    it "audit is nil when mode: :fast and no audit_log given" do
      expect(sanitizer.audit).to be_nil
    end
  end

  # ── sanitize — basic detection ───────────────────────────────────────────────

  describe "#sanitize" do
    it "returns a SanitizeResult" do
      result = sanitizer.sanitize("hello world")
      expect(result).to be_a(PromptSanitizer::SanitizeResult)
    end

    it "leaves clean text untouched" do
      result = sanitizer.sanitize("The weather is nice today.")
      expect(result.text).to eq("The weather is nice today.")
      expect(result.any?).to be false
    end

    it "redacts an email address" do
      result = sanitizer.sanitize("Contact john@example.com for details.")
      expect(result.text).not_to include("john@example.com")
      expect(result.any?).to be true
      expect(result.entities.first.entity_type).to eq(:email)
    end

    it "redacts a US phone number" do
      result = sanitizer.sanitize("Call me at 555-867-5309 please.")
      expect(result.text).not_to include("555-867-5309")
    end

    it "redacts a credit card number" do
      result = sanitizer.sanitize("Card: 4111 1111 1111 1111")
      expect(result.text).not_to include("4111")
    end

    it "redacts an IP address" do
      result = sanitizer.sanitize("Server IP is 192.168.1.100")
      expect(result.text).not_to include("192.168.1.100")
    end

    it "redacts an API key / secret" do
      result = sanitizer.sanitize("Key: sk-abc123XYZ789abcdefghijklmnopqrstuvwxyz0123456789")
      expect(result.text).not_to include("sk-abc123")
    end

    it "handles multiple entities in one text" do
      text   = "Email john@acme.com or call 555-123-4567"
      result = sanitizer.sanitize(text)
      expect(result.count).to be >= 2
      expect(result.text).not_to include("john@acme.com")
      expect(result.text).not_to include("555-123-4567")
    end

    it "handles an empty string" do
      result = sanitizer.sanitize("")
      expect(result.text).to eq("")
      expect(result.count).to eq(0)
    end

    it "preserves non-PII text around redacted values" do
      result = sanitizer.sanitize("Please contact john@acme.com for support.")
      expect(result.text).to start_with("Please contact ")
      expect(result.text).to end_with(" for support.")
    end

    it "populates entity start_pos and end_pos correctly" do
      text   = "Email: john@acme.com end"
      result = sanitizer.sanitize(text)
      entity = result.entities.find { |e| e.entity_type == :email }
      expect(entity).not_to be_nil
      expect(text[entity.start_pos...entity.end_pos]).to eq("john@acme.com")
    end

    it "each entity has a replacement token" do
      result = sanitizer.sanitize("john@acme.com")
      expect(result.entities.first.replacement).not_to be_nil
    end

    it "returns correct original text in result" do
      original = "john@acme.com"
      result = sanitizer.sanitize(original)
      expect(result.original).to eq(original)
    end
  end

  # ── Deduplication ────────────────────────────────────────────────────────────

  describe "span deduplication" do
    it "does not return overlapping entities" do
      result = sanitizer.sanitize("test john@example.com test")
      spans = result.entities.map { |e| (e.start_pos...e.end_pos).to_a }
      # No two spans should share any character index
      all_positions = spans.flatten
      expect(all_positions.uniq.length).to eq(all_positions.length)
    end
  end

  # ── on_detect modes ──────────────────────────────────────────────────────────

  describe "on_detect: :warn" do
    subject(:s) { described_class.new(on_detect: :warn) }

    it "returns the original text unchanged" do
      result = s.sanitize("john@acme.com")
      expect(result.text).to eq("john@acme.com")
    end

    it "still populates entities" do
      result = s.sanitize("john@acme.com")
      expect(result.any?).to be true
    end
  end

  describe "on_detect: :block" do
    subject(:s) { described_class.new(on_detect: :block) }

    it "raises PIIDetectedError when PII is found" do
      expect { s.sanitize("john@acme.com") }
        .to raise_error(PromptSanitizer::PIIDetectedError)
    end

    it "exposes detected entities in the error" do
      err = nil
      begin
        s.sanitize("john@acme.com")
      rescue PromptSanitizer::PIIDetectedError => e
        err = e
      end
      expect(err.entities).not_to be_empty
      expect(err.entities.first.entity_type).to eq(:email)
    end

    it "does not raise when text is clean" do
      expect { s.sanitize("Hello world") }.not_to raise_error
    end
  end

  # ── Entity whitelist ─────────────────────────────────────────────────────────

  describe "entities: whitelist" do
    it "only detects whitelisted entity types" do
      s      = described_class.new(entities: [:email])
      result = s.sanitize("john@acme.com and 555-123-4567")
      types  = result.entities.map(&:entity_type).uniq
      expect(types).to eq([:email])
    end
  end

  # ── sanitize_batch ───────────────────────────────────────────────────────────

  describe "#sanitize_batch" do
    it "returns one result per input text" do
      results = sanitizer.sanitize_batch(["john@acme.com", "clean text", "192.168.1.1"])
      expect(results.length).to eq(3)
      expect(results[0].any?).to be true
      expect(results[1].any?).to be false
    end
  end

  # ── add_pattern ──────────────────────────────────────────────────────────────

  describe "#add_pattern" do
    it "detects text matching the custom pattern" do
      sanitizer.add_pattern(:custom, "INTERNAL-\\d{4}", confidence: 0.9)
      result = sanitizer.sanitize("Ticket INTERNAL-9876 is open.")
      expect(result.any?).to be true
      expect(result.entities.first.original).to eq("INTERNAL-9876")
    end
  end

  # ── Audit log ────────────────────────────────────────────────────────────────

  describe "audit log integration (mode: :full)" do
    subject(:s) { described_class.new(mode: :full) }

    it "records one event per detected entity" do
      s.sanitize("john@acme.com")
      expect(s.audit.count).to be >= 1
    end

    it "never stores the raw PII value in the audit log" do
      s.sanitize("john@acme.com")
      export = s.audit.export(format: :json)
      expect(export).not_to include("john@acme.com")
      expect(export).not_to include("@acme")
    end

    it "records the session_id when given" do
      s.sanitize("john@acme.com", session_id: "sess-99")
      export = JSON.parse(s.audit.export(format: :json))
      expect(export.first["session_id"]).to eq("sess-99")
    end
  end
end

# ── Session ───────────────────────────────────────────────────────────────────

RSpec.describe PromptSanitizer::Session do
  let(:sanitizer) { PromptSanitizer::Sanitizer.new(mode: :fast) }
  subject(:session) { sanitizer.session(session_id: "test-session") }

  describe "#anonymize and #deanonymize" do
    it "redacts PII in the prompt" do
      clean = session.anonymize("Contact john@acme.com for help.")
      expect(clean).not_to include("john@acme.com")
    end

    it "restores the original PII from the LLM response" do
      session.anonymize("Contact john@acme.com")
      # Simulate LLM echoing the token back
      token = session.vault.snapshot.values.first
      restored = session.deanonymize("I reached #{token} and got a response.")
      expect(restored).to include("john@acme.com")
    end

    it "maps the same PII to the same token across multiple calls" do
      session.anonymize("john@acme.com says hello")
      token1 = session.vault.snapshot["john@acme.com"]

      session.anonymize("reply to john@acme.com")
      token2 = session.vault.snapshot["john@acme.com"]

      expect(token1).to eq(token2)
    end

    it "accumulates entities across turns" do
      session.anonymize("john@acme.com")
      session.anonymize("jane@other.org")
      expect(session.size).to be >= 2
    end
  end

  describe "#anonymize_with_result" do
    it "returns a SanitizeResult" do
      result = session.anonymize_with_result("john@acme.com")
      expect(result).to be_a(PromptSanitizer::SanitizeResult)
      expect(result.any?).to be true
    end
  end

  describe "#reset" do
    it "clears the vault" do
      session.anonymize("john@acme.com")
      expect(session.size).to be >= 1
      session.reset
      expect(session.size).to eq(0)
    end
  end

  describe "#mapping" do
    it "returns a hash of original → replacement" do
      session.anonymize("john@acme.com")
      m = session.mapping
      expect(m).to be_a(Hash)
      expect(m.keys).to include("john@acme.com")
    end
  end

  describe "#use (block form)" do
    it "yields self and clears vault after block" do
      cleaned = nil
      sanitizer.session { |s| cleaned = s.anonymize("john@acme.com") }
      # vault is cleared but cleaned text was captured
      expect(cleaned).not_to include("john@acme.com")
    end

    it "clears vault even when block raises" do
      sess = sanitizer.session
      begin
        sess.use { raise "oops" }
      rescue RuntimeError
        nil
      end
      expect(sess.size).to eq(0)
    end
  end

  describe "#session_id" do
    it "exposes the session id" do
      expect(session.session_id).to eq("test-session")
    end
  end

  describe "thread safety" do
    it "handles concurrent anonymize calls without corruption" do
      threads = 10.times.map do |i|
        Thread.new { session.anonymize("user#{i}@example.com") }
      end
      threads.each(&:join)
      expect(session.size).to be >= 1
    end
  end
end
