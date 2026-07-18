# frozen_string_literal: true

require "tmpdir"

RSpec.describe "Vault counters" do
  subject(:vault) { PromptSanitizer::Vault.new }

  it "increments counters independently per entity type" do
    expect(vault.next_count(:person)).to eq(1)
    expect(vault.next_count(:person)).to eq(2)
    expect(vault.next_count(:email)).to eq(1)
  end

  it "raises VaultCollisionError when a token is claimed by a different original" do
    vault.add("alice@example.com", "[EMAIL_1]")
    expect { vault.add("bob@example.com", "[EMAIL_1]") }.to raise_error(PromptSanitizer::VaultCollisionError)
  end

  it "does not raise when re-adding the same original with the same token" do
    vault.add("alice@example.com", "[EMAIL_1]")
    expect { vault.add("alice@example.com", "[EMAIL_1]") }.not_to raise_error
  end

  it "hydrates mappings and reconciles counters from placeholder text" do
    vault.hydrate(
      mappings: { "alice@example.com" => "[EMAIL_1]", "Bob Smith" => "[PERSON_3]" },
      counters: { "EMAIL" => 1 } # PERSON counter deliberately omitted
    )
    expect(vault.restore("Hi [PERSON_3], email [EMAIL_1]")).to eq("Hi Bob Smith, email alice@example.com")
    expect(vault.next_count(:person)).to eq(4)
    expect(vault.next_count(:email)).to eq(2)
  end

  it "resets counters on clear" do
    vault.next_count(:email)
    vault.clear
    expect(vault.next_count(:email)).to eq(1)
  end
end

RSpec.describe PromptSanitizer::VaultStore::MemoryVaultStore do
  subject(:store) { described_class.new }

  it "round-trips a snapshot by session_id" do
    snapshot = PromptSanitizer::VaultStore.to_snapshot("s1", mappings: { "a" => "[A_1]" }, counters: { "A" => 1 })
    store.save("s1", snapshot)
    loaded = store.load("s1")
    expect(loaded.mappings).to eq({ "a" => "[A_1]" })
    expect(loaded.counters).to eq({ "A" => 1 })
  end

  it "returns nil for an unknown session_id" do
    expect(store.load("nope")).to be_nil
  end

  it "delete removes the snapshot" do
    store.save("s1", PromptSanitizer::VaultStore.to_snapshot("s1", mappings: {}, counters: {}))
    store.delete("s1")
    expect(store.load("s1")).to be_nil
  end
end

RSpec.describe PromptSanitizer::VaultStore::FileVaultStore do
  around do |example|
    Dir.mktmpdir("vault-store-") do |dir|
      @dir = dir
      example.run
    end
  end

  subject(:store) { described_class.new(@dir) }

  it "round-trips a snapshot through the filesystem" do
    snapshot = PromptSanitizer::VaultStore.to_snapshot("s1", mappings: { "a" => "[A_1]" }, counters: { "A" => 1 })
    store.save("s1", snapshot)
    loaded = store.load("s1")
    expect(loaded.mappings).to eq({ "a" => "[A_1]" })
  end

  it "returns nil when no file exists yet" do
    expect(store.load("never-saved")).to be_nil
  end

  it "does not leak session_id into a path-traversing filename" do
    evil_id = "../../etc/passwd"
    store.save(evil_id, PromptSanitizer::VaultStore.to_snapshot(evil_id, mappings: {}, counters: {}))
    entries = Dir.children(@dir)
    expect(entries.length).to eq(1)
    expect(entries.first).to match(/\A[0-9a-f]{64}\.json\z/)
  end
end

RSpec.describe "Session persistence — restart simulation" do
  around do |example|
    Dir.mktmpdir("vault-store-") do |dir|
      @dir = dir
      example.run
    end
  end

  it "a new Sanitizer/Session reattached by session_id correctly deanonymizes old tokens and never collides on new ones" do
    store = PromptSanitizer::VaultStore::FileVaultStore.new(@dir)

    # Process 1: populate + persist.
    sanitizer_a = PromptSanitizer::Sanitizer.new(mode: :fast)
    session_a = sanitizer_a.session(session_id: "user-42", store: store)
    clean_a = session_a.anonymize("Contact alice@example.com")
    alice_token = session_a.mapping["alice@example.com"]
    expect(clean_a).not_to include("alice@example.com")
    session_a.persist

    # Simulate a restart: brand new Sanitizer, brand new Session, same store + id.
    sanitizer_b = PromptSanitizer::Sanitizer.new(mode: :fast)
    session_b = sanitizer_b.session(session_id: "user-42", store: store)

    expect(session_b.deanonymize("Reply to #{alice_token}")).to include("alice@example.com")

    clean_b = session_b.anonymize("Contact bob@example.com")
    expect(clean_b).not_to include("bob@example.com")
    bob_token = session_b.mapping["bob@example.com"]
    expect(bob_token).not_to eq(alice_token)

    combined = session_b.deanonymize("#{alice_token} and #{clean_b}")
    expect(combined).to include("alice@example.com")
    expect(combined).to include("bob@example.com")
  end

  it "#persist raises without a store/session_id" do
    sanitizer = PromptSanitizer::Sanitizer.new(mode: :fast)
    session = sanitizer.session
    expect { session.persist }.to raise_error(PromptSanitizer::VaultStoreError)
  end

  it "auto_persist saves after each #anonymize call" do
    store = PromptSanitizer::VaultStore::FileVaultStore.new(@dir)
    sanitizer = PromptSanitizer::Sanitizer.new(mode: :fast)
    session = sanitizer.session(session_id: "auto-1", store: store, auto_persist: true)
    session.anonymize("alice@example.com")

    reloaded = sanitizer.session(session_id: "auto-1", store: store)
    expect(reloaded.mapping).to include("alice@example.com")
  end
end
