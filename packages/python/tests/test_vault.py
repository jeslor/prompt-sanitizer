"""Tests for the bidirectional Vault."""
import threading

import pytest

from prompt_sanitizer.vault import Vault


def test_add_and_restore():
    vault = Vault()
    vault.add("john@example.com", "alex@fake.net")
    restored = vault.restore("Send email to alex@fake.net please")
    assert restored == "Send email to john@example.com please"


def test_determinism():
    vault = Vault()
    r1 = vault.add("555-1234", "[PHONE_1]")
    r2 = vault.add("555-1234", "[PHONE_DIFFERENT]")
    assert r1 == r2 == "[PHONE_1]"


def test_multiple_values():
    vault = Vault()
    vault.add("John Doe", "Alex Smith")
    vault.add("john@example.com", "alex@fake.net")
    result = vault.restore("Hello Alex Smith, your email is alex@fake.net")
    assert "John Doe" in result
    assert "john@example.com" in result


def test_get_replacement():
    vault = Vault()
    vault.add("secret123", "REDACTED_TOKEN")
    assert vault.get_replacement("secret123") == "REDACTED_TOKEN"
    assert vault.get_replacement("nonexistent") is None


def test_get_original():
    vault = Vault()
    vault.add("real@email.com", "fake@email.com")
    assert vault.get_original("fake@email.com") == "real@email.com"
    assert vault.get_original("nonexistent") is None


def test_clear():
    vault = Vault()
    vault.add("foo", "bar")
    vault.clear()
    assert len(vault) == 0
    assert vault.get_replacement("foo") is None


def test_contains():
    vault = Vault()
    vault.add("hello", "world")
    assert "hello" in vault
    assert "world" not in vault


def test_snapshot():
    vault = Vault()
    vault.add("a", "1")
    vault.add("b", "2")
    snap = vault.snapshot()
    assert snap == {"a": "1", "b": "2"}


def test_restore_no_match():
    vault = Vault()
    vault.add("original", "replacement")
    # text without any replacement tokens — should be unchanged
    result = vault.restore("nothing to restore here")
    assert result == "nothing to restore here"


def test_restore_longest_first():
    """Ensure longer tokens are restored first to avoid partial replacement."""
    vault = Vault()
    vault.add("foo", "[A]")
    vault.add("foobar", "[AB]")
    result = vault.restore("value is [AB] and [A]")
    assert result == "value is foobar and foo"


def test_thread_safety():
    vault = Vault()
    errors = []

    def writer(n: int):
        try:
            for i in range(100):
                vault.add(f"key_{n}_{i}", f"val_{n}_{i}")
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(t,)) for t in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0
    assert len(vault) == 1000
