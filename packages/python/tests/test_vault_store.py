"""Tests for Vault counters/hydration and the VaultStore persistence layer."""
import pytest

from prompt_sanitizer import Mode, Sanitizer
from prompt_sanitizer.exceptions import VaultCollisionError, VaultStoreError
from prompt_sanitizer.vault import Vault
from prompt_sanitizer.vault_store import (
    MemoryVaultStore,
    SQLiteVaultStore,
    to_vault_snapshot,
)


# ---------------------------------------------------------------------------
# Vault counters
# ---------------------------------------------------------------------------

def test_next_count_increments_independently_per_type():
    vault = Vault()
    assert vault.next_count("PERSON") == 1
    assert vault.next_count("PERSON") == 2
    assert vault.next_count("EMAIL") == 1


def test_add_raises_collision_error_when_token_claimed_by_different_original():
    vault = Vault()
    vault.add("alice@example.com", "[EMAIL_1]")
    with pytest.raises(VaultCollisionError):
        vault.add("bob@example.com", "[EMAIL_1]")


def test_add_does_not_raise_when_readding_same_original_same_token():
    vault = Vault()
    vault.add("alice@example.com", "[EMAIL_1]")
    vault.add("alice@example.com", "[EMAIL_1]")  # should not raise


def test_hydrate_restores_mappings_and_reconciles_counters():
    vault = Vault()
    vault.hydrate({
        "mappings": {"alice@example.com": "[EMAIL_1]", "Bob Smith": "[PERSON_3]"},
        "counters": {"EMAIL": 1},  # PERSON counter deliberately omitted
    })
    assert vault.restore("Hi [PERSON_3], email [EMAIL_1]") == "Hi Bob Smith, email alice@example.com"
    # Reconciled from mapping text since it wasn't in counters.
    assert vault.next_count("PERSON") == 4
    # Explicitly restored.
    assert vault.next_count("EMAIL") == 2


def test_clear_resets_counters():
    vault = Vault()
    vault.next_count("EMAIL")
    vault.clear()
    assert vault.next_count("EMAIL") == 1


# ---------------------------------------------------------------------------
# MemoryVaultStore
# ---------------------------------------------------------------------------

def test_memory_store_round_trip():
    store = MemoryVaultStore()
    snapshot = to_vault_snapshot("s1", {"mappings": {"a": "[A_1]"}, "counters": {"A": 1}})
    store.save("s1", snapshot)
    loaded = store.load("s1")
    assert loaded.mappings == {"a": "[A_1]"}
    assert loaded.counters == {"A": 1}


def test_memory_store_unknown_session_returns_none():
    store = MemoryVaultStore()
    assert store.load("nope") is None


def test_memory_store_delete():
    store = MemoryVaultStore()
    store.save("s1", to_vault_snapshot("s1", {"mappings": {}, "counters": {}}))
    store.delete("s1")
    assert store.load("s1") is None


# ---------------------------------------------------------------------------
# SQLiteVaultStore
# ---------------------------------------------------------------------------

def test_sqlite_store_round_trip(tmp_path):
    store = SQLiteVaultStore(tmp_path / "vault.db")
    snapshot = to_vault_snapshot("s1", {"mappings": {"a": "[A_1]"}, "counters": {"A": 1}})
    store.save("s1", snapshot)
    loaded = store.load("s1")
    assert loaded.mappings == {"a": "[A_1]"}
    assert loaded.counters == {"A": 1}


def test_sqlite_store_unknown_session_returns_none(tmp_path):
    store = SQLiteVaultStore(tmp_path / "vault.db")
    assert store.load("never-saved") is None


def test_sqlite_store_upsert_overwrites(tmp_path):
    store = SQLiteVaultStore(tmp_path / "vault.db")
    store.save("s1", to_vault_snapshot("s1", {"mappings": {"a": "[A_1]"}, "counters": {"A": 1}}))
    store.save("s1", to_vault_snapshot("s1", {"mappings": {"a": "[A_1]", "b": "[B_1]"}, "counters": {"A": 1, "B": 1}}))
    loaded = store.load("s1")
    assert loaded.mappings == {"a": "[A_1]", "b": "[B_1]"}


# ---------------------------------------------------------------------------
# Session persistence — restart simulation
# ---------------------------------------------------------------------------

def test_reattached_session_deanonymizes_old_tokens_and_avoids_new_collisions(tmp_path):
    store = SQLiteVaultStore(tmp_path / "vault.db")

    # Process 1: populate + persist.
    sanitizer_a = Sanitizer(mode=Mode.FAST)
    session_a = sanitizer_a.session(session_id="user-42", store=store)
    clean_a = session_a.anonymize("Contact alice@example.com")
    alice_token = session_a.mapping["alice@example.com"]
    assert "alice@example.com" not in clean_a
    session_a.persist()

    # Simulate a restart: brand new Sanitizer, brand new Session, same store + id.
    sanitizer_b = Sanitizer(mode=Mode.FAST)
    session_b = sanitizer_b.session(session_id="user-42", store=store)

    # Old placeholder text must still deanonymize correctly in the new process.
    assert "alice@example.com" in session_b.deanonymize(f"Reply to {alice_token}")

    # A brand new value must never reuse alice's token.
    clean_b = session_b.anonymize("Contact bob@example.com")
    assert "bob@example.com" not in clean_b
    bob_token = session_b.mapping["bob@example.com"]
    assert bob_token != alice_token

    combined = session_b.deanonymize(f"{alice_token} and {clean_b}")
    assert "alice@example.com" in combined
    assert "bob@example.com" in combined


def test_persist_without_store_raises():
    sanitizer = Sanitizer(mode=Mode.FAST)
    session = sanitizer.session()
    with pytest.raises(VaultStoreError):
        session.persist()


def test_auto_persist_saves_after_each_anonymize(tmp_path):
    store = SQLiteVaultStore(tmp_path / "vault.db")
    sanitizer = Sanitizer(mode=Mode.FAST)
    session = sanitizer.session(session_id="auto-1", store=store, auto_persist=True)
    session.anonymize("alice@example.com")

    reloaded = sanitizer.session(session_id="auto-1", store=store)
    assert "alice@example.com" in reloaded.mapping
