# frozen_string_literal: true

RSpec.describe PromptSanitizer::EntityType do
  it "defines the expected core entity types" do
    expect(PromptSanitizer::EntityType::EMAIL).to        eq(:email)
    expect(PromptSanitizer::EntityType::PERSON).to       eq(:person)
    expect(PromptSanitizer::EntityType::SSN).to          eq(:ssn)
    expect(PromptSanitizer::EntityType::CREDIT_CARD).to  eq(:credit_card)
    expect(PromptSanitizer::EntityType::JWT).to          eq(:jwt)
    expect(PromptSanitizer::EntityType::AWS_ACCESS_KEY).to eq(:aws_access_key)
  end

  it "exposes an ALL list with no duplicates" do
    expect(PromptSanitizer::EntityType::ALL.uniq.size).to eq(
      PromptSanitizer::EntityType::ALL.size
    )
  end
end

RSpec.describe PromptSanitizer::Mode do
  it "validates known modes" do
    expect(PromptSanitizer::Mode.valid?(:fast)).to  be true
    expect(PromptSanitizer::Mode.valid?(:smart)).to be true
    expect(PromptSanitizer::Mode.valid?(:full)).to  be true
    expect(PromptSanitizer::Mode.valid?(:turbo)).to be false
  end
end

RSpec.describe PromptSanitizer::SanitizeResult do
  let(:entity) do
    PromptSanitizer::DetectedEntity.new(
      entity_type: :email,
      original:    "bob@acme.com",
      replacement: "[EMAIL_1]",
      start_pos:   10,
      end_pos:     22,
      confidence:  0.99,
      layer:       :regex
    )
  end

  subject(:result) do
    PromptSanitizer::SanitizeResult.new(
      text:     "Contact [EMAIL_1] for details.",
      original: "Contact bob@acme.com for details.",
      entities: [entity]
    )
  end

  it "reports count and any?" do
    expect(result.count).to eq(1)
    expect(result.any?).to  be true
  end

  it "filters by type" do
    expect(result.by_type(:email)).to  eq([entity])
    expect(result.by_type(:phone)).to  be_empty
  end

  it "builds a mapping hash" do
    expect(result.mapping).to eq({ "bob@acme.com" => "[EMAIL_1]" })
  end
end
