"""Tests for the Sanitizer class — integration-level."""
import pytest

from prompt_sanitizer import Mode, Sanitizer
from prompt_sanitizer.exceptions import PIIDetectedError


@pytest.fixture
def s():
    return Sanitizer(mode=Mode.FAST)


# ── Basic sanitization ────────────────────────────────────────────────────────

class TestSanitize:
    def test_email_redacted(self, s):
        result = s.sanitize("Contact john@example.com for details.")
        assert "john@example.com" not in result.text
        assert result.has_pii

    def test_phone_redacted(self, s):
        result = s.sanitize("Call 555-867-5309 now.")
        assert "555-867-5309" not in result.text

    def test_ssn_redacted(self, s):
        result = s.sanitize("My SSN is 078-05-1120")
        assert "078-05-1120" not in result.text

    def test_credit_card_redacted(self, s):
        result = s.sanitize("Card: 4111 1111 1111 1111")
        assert "4111 1111 1111 1111" not in result.text

    def test_api_key_redacted(self, s):
        result = s.sanitize("Key: sk-abcdefghijklmnopqrstuvwxyz123456789012345678")
        assert "sk-abcdefghijklmnopqrstuvwxyz" not in result.text

    def test_no_pii(self, s):
        result = s.sanitize("The quick brown fox jumps over the lazy dog.")
        assert not result.has_pii
        assert result.text == "The quick brown fox jumps over the lazy dog."

    def test_tokens_populated(self, s):
        result = s.sanitize("Email: user@test.com")
        assert len(result.tokens) >= 1
        original = list(result.tokens.keys())[0]
        assert "user@test.com" == original

    def test_score_positive(self, s):
        result = s.sanitize("SSN 123-45-6789")
        assert result.score > 0.0

    def test_original_preserved(self, s):
        text = "Call me at 555-123-4567"
        result = s.sanitize(text)
        assert result.original == text

    def test_batch(self, s):
        results = s.sanitize_batch([
            "email a@a.com",
            "no pii here",
            "phone 800-555-1234",
        ])
        assert len(results) == 3
        assert results[0].has_pii
        assert not results[1].has_pii
        assert results[2].has_pii


# ── on_detect modes ───────────────────────────────────────────────────────────

class TestOnDetectModes:
    def test_warn_returns_original(self):
        s = Sanitizer(on_detect="warn")
        result = s.sanitize("SSN: 078-05-1120")
        assert result.text == "SSN: 078-05-1120"
        assert result.has_pii

    def test_block_raises(self):
        s = Sanitizer(on_detect="block")
        with pytest.raises(PIIDetectedError) as exc_info:
            s.sanitize("Email: user@example.com")
        assert len(exc_info.value.entities) >= 1

    def test_block_no_pii_passes(self):
        s = Sanitizer(on_detect="block")
        result = s.sanitize("Hello world, nothing sensitive here.")
        assert not result.has_pii


# ── @guard decorator ──────────────────────────────────────────────────────────

class TestGuardDecorator:
    def test_sync_redacts(self, s):
        @s.guard(on_detect="redact")
        def process(prompt: str) -> str:
            return prompt  # echo back

        result = process("My email is secret@company.org")
        assert "secret@company.org" not in result

    def test_block_raises(self, s):
        @s.guard(on_detect="block")
        def process(prompt: str) -> str:
            return prompt

        with pytest.raises(PIIDetectedError):
            process("SSN: 123-45-6789")

    @pytest.mark.asyncio
    async def test_async_guard(self, s):
        @s.guard(on_detect="redact")
        async def acall(prompt: str) -> str:
            return prompt

        result = await acall("card 4111 1111 1111 1111")
        assert "4111 1111 1111 1111" not in result


# ── entity_types filter ────────────────────────────────────────────────────────

class TestEntityFilter:
    def test_only_email(self):
        from prompt_sanitizer import EntityType
        s = Sanitizer(entities=[EntityType.EMAIL])
        result = s.sanitize("Email: a@b.com  SSN: 078-05-1120")
        # Email redacted, SSN should still be present
        assert "a@b.com" not in result.text
        assert "078-05-1120" in result.text


# ── Multiple PII in one text ──────────────────────────────────────────────────

class TestMultiplePII:
    def test_email_and_ssn(self, s):
        result = s.sanitize(
            "Hi, I'm user@example.com and my SSN is 123-45-6789"
        )
        assert "user@example.com" not in result.text
        assert "123-45-6789" not in result.text
        assert len(result.entities) >= 2
