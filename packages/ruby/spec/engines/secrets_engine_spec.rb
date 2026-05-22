# frozen_string_literal: true

RSpec.describe PromptSanitizer::Engines::SecretsEngine do
  subject(:engine) { described_class.new }

  describe "JWT detection" do
    it "detects a JWT token" do
      jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      entities = engine.detect("Token: #{jwt}")
      expect(entities.map(&:entity_type)).to include(:jwt)
    end
  end

  describe "AWS key detection" do
    it "detects an AWS access key ID" do
      entities = engine.detect("key=AKIAIOSFODNN7EXAMPLE")
      expect(entities.map(&:entity_type)).to include(:aws_access_key)
    end

    it "detects an AWS secret key in assignment" do
      entities = engine.detect("aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
      expect(entities.map(&:entity_type)).to include(:aws_secret_key)
    end
  end

  describe "API key detection" do
    it "detects an OpenAI API key" do
      entities = engine.detect("Using sk-proj-abcdefghijklmnopqrstuvwxyz1234 for calls.")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end

    it "detects a GitHub PAT" do
      entities = engine.detect("Token: ghp_#{"a" * 36}")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end

    it "detects a Stripe secret key" do
      entities = engine.detect("sk_live_#{"a" * 24} is the key.")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end

    it "detects a Google API key" do
      entities = engine.detect("AIza#{"A" * 35}")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end

    it "detects a HuggingFace token" do
      entities = engine.detect("hf_#{"a" * 34}")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end
  end

  describe "private key detection" do
    it "detects a PEM private key header" do
      entities = engine.detect("-----BEGIN RSA PRIVATE KEY-----")
      expect(entities.map(&:entity_type)).to include(:private_key)
    end
  end

  describe "database connection string detection" do
    it "detects a PostgreSQL connection string" do
      entities = engine.detect("postgres://user:pass@host:5432/mydb")
      expect(entities.map(&:entity_type)).to include(:db_connection)
    end

    it "detects a MongoDB connection string" do
      entities = engine.detect("mongodb+srv://user:secret@cluster.mongodb.net/db")
      expect(entities.map(&:entity_type)).to include(:db_connection)
    end
  end

  describe "bearer token detection" do
    it "detects a Bearer token in an Authorization header" do
      entities = engine.detect("Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9longtoken")
      expect(entities.map(&:entity_type)).to include(:bearer_token)
    end
  end

  describe "#add_pattern" do
    it "supports custom secret patterns" do
      engine.add_pattern(:api_key, /MYAPP-[A-Z0-9]{16}/, label: "MyApp key")
      entities = engine.detect("Key: MYAPP-ABCDEFGHIJ123456")
      expect(entities.map(&:entity_type)).to include(:api_key)
    end
  end
end
