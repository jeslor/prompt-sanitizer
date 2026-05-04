"""Tests for the Session (bidirectional anonymize/deanonymize)."""
import pytest

from prompt_sanitizer import Mode, Sanitizer


@pytest.fixture
def s():
    return Sanitizer(mode=Mode.FAST)


class TestSession:
    def test_anonymize_redacts(self, s):
        sess = s.session()
        clean = sess.anonymize("Email me at real@example.com")
        assert "real@example.com" not in clean

    def test_deanonymize_restores(self, s):
        sess = s.session()
        clean = sess.anonymize("Contact real@example.com")
        # Simulate LLM echoing the token back
        llm_response = f"I will contact {clean.split()[-1]} shortly."
        restored = sess.deanonymize(llm_response)
        assert "real@example.com" in restored

    def test_determinism_across_calls(self, s):
        sess = s.session()
        first = sess.anonymize("user@example.com")
        second = sess.anonymize("user@example.com again")
        # The same original should produce the same token in both calls
        token_first = first.split()[-1] if first else ""
        assert token_first in second

    def test_multiple_entities_restored(self, s):
        sess = s.session()
        clean = sess.anonymize(
            "Name: John Doe, SSN: 078-05-1120, Email: john@example.com"
        )
        restored = sess.deanonymize(clean)
        assert "john@example.com" in restored
        assert "078-05-1120" in restored

    def test_reset_clears_vault(self, s):
        sess = s.session()
        clean = sess.anonymize("user@example.com")
        token = clean  # contains the replacement token
        sess.reset()
        # After reset, deanonymize can no longer restore
        result = sess.deanonymize(token)
        assert "user@example.com" not in result  # token no longer in vault

    def test_len(self, s):
        sess = s.session()
        assert len(sess) == 0
        sess.anonymize("email@example.com and 555-111-2222")
        assert len(sess) >= 1

    def test_context_manager(self, s):
        with s.session() as sess:
            clean = sess.anonymize("email@example.com")
            assert "email@example.com" not in clean
        # After __exit__, vault is cleared
        assert len(sess) == 0

    def test_anonymize_with_result(self, s):
        sess = s.session()
        result = sess.anonymize_with_result("SSN: 123-45-6789")
        assert result.has_pii
        assert "123-45-6789" not in result.text

    def test_mapping_snapshot(self, s):
        sess = s.session()
        sess.anonymize("user@example.com")
        mapping = sess.mapping
        assert any("user@example.com" in k for k in mapping.keys())

    def test_session_id_passed(self, s):
        from prompt_sanitizer.audit import MemoryAuditLog
        from prompt_sanitizer import Mode
        audit = MemoryAuditLog()
        s_with_audit = Sanitizer(mode=Mode.FULL, audit_log=audit)
        sess = s_with_audit.session(session_id="test-session-42")
        sess.anonymize("user@test.com")
        events = audit._events
        assert any(e.session_id == "test-session-42" for e in events)
