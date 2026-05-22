# frozen_string_literal: true

require "spec_helper"

RSpec.describe "End-to-end LLM pipeline", type: :integration do
  let(:sanitizer) { PromptSanitizer::Sanitizer.new(mode: :fast) }

  # Simulates an LLM that echoes any token it receives back in its reply.
  def mock_llm(prompt)
    "Sure! Based on your query '#{prompt}', here is what I found."
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Single-shot sanitize → send → deanonymize
  # ─────────────────────────────────────────────────────────────────────────

  context "single-shot round-trip" do
    it "strips PII before sending and restores it from the reply" do
      session = sanitizer.session

      original = "Reach me at alice@example.com or 555-867-5309, SSN 234-56-7890"
      clean    = session.anonymize(original)

      # No PII leaks to the model
      expect(clean).not_to include("alice@example.com")
      expect(clean).not_to include("555-867-5309")
      expect(clean).not_to include("234-56-7890")

      # Placeholder tokens are present
      expect(clean).to match(/\[EMAIL_\d+\]/)
      expect(clean).to match(/\[PHONE_\d+\]/)
      expect(clean).to match(/\[SSN_\d+\]/)

      # Mock LLM echoes the tokens in its reply
      llm_reply = mock_llm(clean)
      restored  = session.deanonymize(llm_reply)

      # Original values are restored in the final reply
      expect(restored).to include("alice@example.com")
      expect(restored).to include("555-867-5309")
      expect(restored).to include("234-56-7890")
    end

    it "preserves non-PII content unchanged" do
      session  = sanitizer.session
      original = "What is the capital of France?"
      clean    = session.anonymize(original)

      expect(clean).to eq(original)
      llm_reply = mock_llm(clean)
      expect(session.deanonymize(llm_reply)).to eq(mock_llm(original))
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Multi-turn conversation with shared vault
  # ─────────────────────────────────────────────────────────────────────────

  context "multi-turn conversation" do
    it "remembers tokens across turns" do
      session = sanitizer.session

      # Turn 1 — introduce the user
      t1_clean = session.anonymize("Hi, my email is bob@example.com")
      expect(t1_clean).not_to include("bob@example.com")

      # Turn 2 — reference same person again
      t2_clean = session.anonymize("Please send a summary to bob@example.com")
      # Must reuse the same EMAIL token from turn 1
      email_token = t1_clean[/\[EMAIL_\d+\]/]
      expect(email_token).not_to be_nil
      expect(t2_clean).to include(email_token)

      # Deanonymize a response referencing the token
      reply    = "Done, I sent the summary to #{email_token}."
      restored = session.deanonymize(reply)
      expect(restored).to include("bob@example.com")
    end

    it "clears vault after block form" do
      email_token = nil

      sanitizer.session do |s|
        clean = s.anonymize("Contact Jane at jane@corp.com")
        email_token = clean[/\[EMAIL_\d+\]/]
        expect(email_token).not_to be_nil
      end

      # New session — vault is empty, so the token is unknown
      session2  = sanitizer.session
      leftover  = session2.deanonymize("Reply to #{email_token}")
      expect(leftover).to eq("Reply to #{email_token}")   # token stays unreplaced
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Batch sanitization
  # ─────────────────────────────────────────────────────────────────────────

  context "batch processing" do
    it "sanitizes an array of prompts" do
      prompts = [
        "Email me at alice@example.com",
        "Call me at 555-123-4567",
        "What is 2 + 2?"
      ]

      results = sanitizer.sanitize_batch(prompts)

      expect(results[0].text).not_to include("alice@example.com")
      expect(results[1].text).not_to include("555-123-4567")
      expect(results[2].text).to eq("What is 2 + 2?")
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Sensitive secrets
  # ─────────────────────────────────────────────────────────────────────────

  context "secrets detection" do
    it "redacts API keys" do
      key    = "sk-proj-" + ("A".."Z").to_a.cycle.first(40).join
      result = sanitizer.sanitize("Use API key: #{key}")
      expect(result.text).not_to include(key)
      expect(result.entities.map(&:entity_type)).to include(:api_key)
    end

    it "redacts JWT tokens" do
      # Realistic-looking JWT (not necessarily valid signature)
      jwt    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." \
               "eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjoxNzAwMDAwMDAwfQ." \
               "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      result = sanitizer.sanitize("Authorization: Bearer #{jwt}")
      expect(result.text).not_to include(jwt)
    end

    it "redacts AWS access keys" do
      key    = "AKIAIOSFODNN7EXAMPLE"
      result = sanitizer.sanitize("AWS key: #{key}")
      expect(result.text).not_to include(key)
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # on_detect: :block — raise on PII
  # ─────────────────────────────────────────────────────────────────────────

  context "on_detect :block mode" do
    let(:blocking_sanitizer) { PromptSanitizer::Sanitizer.new(on_detect: :block) }

    it "raises PIIDetectedError when PII is found" do
      expect do
        blocking_sanitizer.sanitize("My SSN is 123-45-6789")
      end.to raise_error(PromptSanitizer::PIIDetectedError) do |e|
        expect(e.entities).not_to be_empty
        expect(e.entities.first.entity_type).to eq(:ssn)
      end
    end

    it "does not raise when no PII is present" do
      expect do
        blocking_sanitizer.sanitize("What is the speed of light?")
      end.not_to raise_error
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Whitelist — allow specific entities through
  # ─────────────────────────────────────────────────────────────────────────

  context "entity whitelist" do
    it "skips whitelisted entity types" do
      s      = PromptSanitizer::Sanitizer.new(entities: %i[email])
      result = s.sanitize("Email alice@example.com, SSN 123-45-6789")

      # Only email is in the allowed list, so SSN is skipped
      expect(result.text).not_to include("alice@example.com")
      expect(result.text).to include("123-45-6789")
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Custom patterns
  # ─────────────────────────────────────────────────────────────────────────

  context "custom patterns" do
    it "detects user-defined patterns" do
      s = PromptSanitizer::Sanitizer.new
      s.add_pattern(:custom, /EMP-\d{6}/)

      result = s.sanitize("Assigned to employee EMP-004821")
      expect(result.text).not_to include("EMP-004821")
      expect(result.entities.map(&:entity_type)).to include(:custom)
    end
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Thread safety
  # ─────────────────────────────────────────────────────────────────────────

  context "thread safety" do
    it "handles concurrent sanitize calls without data corruption" do
      results = Array.new(20)
      threads = 20.times.map do |i|
        Thread.new do
          results[i] = sanitizer.sanitize("User #{i}: email#{i}@example.com").text
        end
      end
      threads.each(&:join)

      results.each_with_index do |text, i|
        expect(text).not_to include("email#{i}@example.com"),
          "Thread #{i} result leaked PII: #{text}"
      end
    end
  end
end
