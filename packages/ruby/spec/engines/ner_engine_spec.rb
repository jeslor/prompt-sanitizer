# frozen_string_literal: true

RSpec.describe PromptSanitizer::Engines::NEREngine do
  # ── When no NER gem is installed (default CI environment) ─────────────────

  context "when informers gem is not installed" do
    subject(:engine) do
      described_class.new(backend: :informers, model: "distilbert")
    end

    it "reports as unavailable" do
      expect(engine.available?).to be false
    end

    it "returns an empty array from detect" do
      expect(engine.detect("Hello, my name is Alice.")).to eq([])
    end

    it "does not raise — degrades gracefully" do
      expect { engine.detect("Some text with John Smith inside.") }.not_to raise_error
    end
  end

  context "when mitie gem is not installed" do
    subject(:engine) do
      described_class.new(backend: :mitie, model: "/nonexistent/ner_model.dat")
    end

    it "reports as unavailable" do
      expect(engine.available?).to be false
    end

    it "returns an empty array from detect" do
      expect(engine.detect("Acme Corp is in London.")).to eq([])
    end
  end

  context "with an unknown backend" do
    it "raises ConfigurationError immediately" do
      expect {
        described_class.new(backend: :unknown_backend)
      }.to raise_error(PromptSanitizer::ConfigurationError, /Unknown NER backend/)
    end
  end

  # ── informers backend (stubbed pipeline) ──────────────────────────────────

  context "with a stubbed informers pipeline" do
    let(:mock_pipeline) do
      lambda do |text|
        # Simulate informers returning BIO-tagged tokens for "Alice Smith"
        [
          { entity: "B-PER", word: "Alice", score: 0.999, start: 0, end: 5 },
          { entity: "I-PER", word: "Smith", score: 0.997, start: 6, end: 11 },
          { entity: "B-ORG", word: "Acme", score: 0.990, start: 22, end: 26 },
        ]
      end
    end

    subject(:engine) do
      e = described_class.allocate
      e.instance_variable_set(:@backend,      :informers)
      e.instance_variable_set(:@backend_type, :informers)
      e.instance_variable_set(:@model,        "distilbert")
      e.instance_variable_set(:@pipeline,     mock_pipeline)
      e.instance_variable_set(:@mutex,        Mutex.new)
      e
    end

    it "is available" do
      expect(engine.available?).to be true
    end

    it "detects PERSON entities" do
      entities = engine.detect("Alice Smith works at Acme Corp.")
      types    = entities.map(&:entity_type)
      expect(types).to include(:person)
    end

    it "detects ORGANIZATION entities" do
      entities = engine.detect("Alice Smith works at Acme Corp.")
      types    = entities.map(&:entity_type)
      expect(types).to include(:organization)
    end

    it "merges B- and I- tags into a single entity span" do
      entities = engine.detect("Alice Smith works at Acme Corp.")
      person   = entities.find { |e| e.entity_type == :person }
      expect(person.original).to eq("Alice Smith")
    end

    it "sets the layer to :ner" do
      entities = engine.detect("Alice Smith works at Acme Corp.")
      expect(entities.map(&:layer).uniq).to eq([:ner])
    end

    it "returns [] for blank input" do
      expect(engine.detect("")).to eq([])
      expect(engine.detect("   ")).to eq([])
    end
  end

  # ── Chunking behaviour ────────────────────────────────────────────────────

  context "chunking long texts" do
    let(:call_count) { [] }
    let(:mock_pipeline) do
      lambda do |text|
        call_count << text.length
        []
      end
    end

    subject(:engine) do
      e = described_class.allocate
      e.instance_variable_set(:@backend,      :informers)
      e.instance_variable_set(:@backend_type, :informers)
      e.instance_variable_set(:@model,        "distilbert")
      e.instance_variable_set(:@pipeline,     mock_pipeline)
      e.instance_variable_set(:@mutex,        Mutex.new)
      e
    end

    it "splits texts longer than CHUNK_SIZE into multiple calls" do
      long_text = "word " * 500  # ~2500 chars > CHUNK_SIZE (1800)
      engine.detect(long_text)
      expect(call_count.size).to be >= 2
    end

    it "processes short texts in a single call" do
      engine.detect("Short prompt text.")
      expect(call_count.size).to eq(1)
    end
  end

  # ── TAG_MAP coverage ──────────────────────────────────────────────────────

  describe "TAG_MAP" do
    it "maps PER to :person" do
      expect(described_class::TAG_MAP["PER"]).to eq(:person)
    end

    it "maps ORG to :organization" do
      expect(described_class::TAG_MAP["ORG"]).to eq(:organization)
    end

    it "maps LOC to :location" do
      expect(described_class::TAG_MAP["LOC"]).to eq(:location)
    end

    it "maps MISC to :misc" do
      expect(described_class::TAG_MAP["MISC"]).to eq(:misc)
    end
  end
end
