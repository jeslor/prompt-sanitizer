# frozen_string_literal: true

RSpec.describe PromptSanitizer::Audit do
  let(:make_event) do
    lambda do |**overrides|
      PromptSanitizer::Audit::AuditEvent.new(
        timestamp:        PromptSanitizer::Audit.now_iso,
        entity_type:      :email,
        confidence:       0.99,
        layer:            :regex,
        redaction_method: :synthetic,
        text_hash:        PromptSanitizer::Audit.hash_value("john@acme.com"),
        session_id:       nil,
        **overrides
      )
    end
  end

  # ── Module helpers ──────────────────────────────────────────────────────────

  describe ".hash_value" do
    it "returns a 16-char hex string" do
      h = described_class.hash_value("secret@email.com")
      expect(h).to match(/\A[0-9a-f]{16}\z/)
    end

    it "is deterministic for the same input" do
      expect(described_class.hash_value("foo")).to eq(described_class.hash_value("foo"))
    end

    it "differs for different inputs" do
      expect(described_class.hash_value("a")).not_to eq(described_class.hash_value("b"))
    end

    it "never exposes the original PII value" do
      h = described_class.hash_value("john@acme.com")
      expect(h).not_to include("john")
      expect(h).not_to include("@")
    end
  end

  describe ".parse_since" do
    it "returns nil for nil input" do
      expect(described_class.parse_since(nil)).to be_nil
    end

    it "parses '7d' as approximately 7 days ago" do
      result = described_class.parse_since("7d")
      expect(result).to be_within(5).of(Time.now.utc - 7 * 86_400)
    end

    it "parses '1h' as approximately 1 hour ago" do
      result = described_class.parse_since("1h")
      expect(result).to be_within(5).of(Time.now.utc - 3_600)
    end

    it "passes a Time object through unchanged" do
      t = Time.now.utc - 100
      expect(described_class.parse_since(t)).to eq(t)
    end
  end

  # ── AuditEvent ──────────────────────────────────────────────────────────────

  describe PromptSanitizer::Audit::AuditEvent do
    subject(:event) do
      described_class.new(
        timestamp: "2026-01-01T00:00:00Z",
        entity_type: :phone,
        confidence: 0.95,
        layer: :regex,
        redaction_method: :placeholder,
        text_hash: "deadbeef12345678",
        session_id: "sess-abc"
      )
    end

    it "exposes all fields" do
      expect(event.entity_type).to eq(:phone)
      expect(event.confidence).to eq(0.95)
      expect(event.text_hash).to eq("deadbeef12345678")
      expect(event.session_id).to eq("sess-abc")
    end

    it "#to_h returns string keys" do
      h = event.to_h
      expect(h.keys).to all(be_a(String))
      expect(h["entity_type"]).to eq(:phone)
    end
  end

  # ── Base (interface contract) ────────────────────────────────────────────────

  describe PromptSanitizer::Audit::Base do
    subject(:log) { described_class.new }

    it "raises NotImplementedError on #record" do
      expect { log.record(nil) }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError on #export" do
      expect { log.export }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError on #count" do
      expect { log.count }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError on #clear" do
      expect { log.clear }.to raise_error(NotImplementedError)
    end
  end

  # ── MemoryAuditLog ──────────────────────────────────────────────────────────

  describe PromptSanitizer::Audit::MemoryAuditLog do
    subject(:log) { described_class.new }

    describe "#record and #count" do
      it "starts empty" do
        expect(log.count).to eq(0)
      end

      it "increments count for each recorded event" do
        log.record(make_event.call)
        log.record(make_event.call(entity_type: :ssn))
        expect(log.count).to eq(2)
      end
    end

    describe "#events" do
      it "returns a copy of recorded events" do
        e = make_event.call
        log.record(e)
        expect(log.events).to eq([e])
      end

      it "returns a dup (mutations do not affect internal state)" do
        log.record(make_event.call)
        log.events.clear
        expect(log.count).to eq(1)
      end
    end

    describe "#clear" do
      it "removes all events" do
        log.record(make_event.call)
        log.clear
        expect(log.count).to eq(0)
      end
    end

    describe "#export JSON" do
      it "returns an empty JSON array when no events" do
        expect(log.export(format: :json)).to eq("[]")
      end

      it "serialises events with string keys" do
        log.record(make_event.call(entity_type: :email))
        data = JSON.parse(log.export(format: :json))
        expect(data.length).to eq(1)
        expect(data.first["entity_type"]).to eq("email")
      end

      it "never includes PII — only hashed values" do
        log.record(make_event.call)
        output = log.export(format: :json)
        expect(output).not_to include("john@acme.com")
        expect(output).not_to include("@acme")
      end
    end

    describe "#export CSV" do
      it "returns empty string when no events" do
        expect(log.export(format: :csv)).to eq("")
      end

      it "includes a header row and one data row" do
        log.record(make_event.call(entity_type: :phone))
        lines = log.export(format: :csv).split("\n")
        expect(lines.length).to eq(2)
        expect(lines.first).to include("entity_type")
        expect(lines.last).to include("phone")
      end
    end

    describe "#export with unknown format" do
      it "raises ArgumentError" do
        expect { log.export(format: :xml) }.to raise_error(ArgumentError, /xml/i)
      end
    end

    describe "filtering by since:" do
      it "returns all events when since is nil" do
        2.times { log.record(make_event.call) }
        expect(log.count(since: nil)).to eq(2)
      end

      it "returns all events for '0d'" do
        2.times { log.record(make_event.call) }
        expect(log.count(since: "0d")).to eq(2)
      end

      it "excludes old events outside the window" do
        old_ts = (Time.now.utc - 10 * 86_400).iso8601
        log.record(make_event.call(timestamp: old_ts))
        log.record(make_event.call) # recent
        expect(log.count(since: "1d")).to eq(1)
      end
    end

    describe "filtering by session_id:" do
      it "returns only events matching the given session" do
        log.record(make_event.call(session_id: "s1"))
        log.record(make_event.call(session_id: "s2"))
        data = JSON.parse(log.export(format: :json, session_id: "s1"))
        expect(data.length).to eq(1)
        expect(data.first["session_id"]).to eq("s1")
      end
    end

    describe "thread safety" do
      it "handles concurrent record calls without corruption" do
        threads = 20.times.map do
          Thread.new { log.record(make_event.call) }
        end
        threads.each(&:join)
        expect(log.count).to eq(20)
      end
    end
  end
end
