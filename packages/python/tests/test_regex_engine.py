"""Tests for the Regex Engine."""
import pytest

from prompt_sanitizer.engines.regex_engine import RegexEngine
from prompt_sanitizer.entities import EntityType


@pytest.fixture
def engine():
    return RegexEngine()


# ── Email ────────────────────────────────────────────────────────────────────

class TestEmail:
    def test_simple(self, engine):
        entities = engine.detect("Contact me at john.doe@example.com please.")
        emails = [e for e in entities if e.entity_type == EntityType.EMAIL]
        assert len(emails) == 1
        assert emails[0].original == "john.doe@example.com"

    def test_subdomain(self, engine):
        entities = engine.detect("support@mail.acme.co.uk")
        emails = [e for e in entities if e.entity_type == EntityType.EMAIL]
        assert any(e.original == "support@mail.acme.co.uk" for e in emails)

    def test_plus_alias(self, engine):
        entities = engine.detect("user+tag@domain.org")
        emails = [e for e in entities if e.entity_type == EntityType.EMAIL]
        assert emails[0].original == "user+tag@domain.org"

    def test_no_false_positive_no_at(self, engine):
        entities = engine.detect("hello world no email here")
        emails = [e for e in entities if e.entity_type == EntityType.EMAIL]
        assert len(emails) == 0

    def test_multiple_emails(self, engine):
        entities = engine.detect("a@a.com and b@b.com")
        emails = [e for e in entities if e.entity_type == EntityType.EMAIL]
        assert len(emails) == 2


# ── Phone ────────────────────────────────────────────────────────────────────

class TestPhone:
    def test_us_dashes(self, engine):
        entities = engine.detect("Call me at 555-867-5309")
        phones = [e for e in entities if e.entity_type == EntityType.PHONE]
        assert len(phones) >= 1

    def test_us_parens(self, engine):
        entities = engine.detect("Reach us at (800) 555-1234")
        phones = [e for e in entities if e.entity_type == EntityType.PHONE]
        assert len(phones) >= 1

    def test_international(self, engine):
        entities = engine.detect("Call +44 20 7946 0958")
        phones = [e for e in entities if e.entity_type == EntityType.PHONE]
        assert len(phones) >= 1

    def test_e164(self, engine):
        entities = engine.detect("+12025551234 is my number")
        phones = [e for e in entities if e.entity_type == EntityType.PHONE]
        assert len(phones) >= 1


# ── SSN ──────────────────────────────────────────────────────────────────────

class TestSSN:
    def test_dashes(self, engine):
        entities = engine.detect("SSN: 078-05-1120")
        ssns = [e for e in entities if e.entity_type == EntityType.SSN]
        assert len(ssns) == 1
        assert ssns[0].original == "078-05-1120"

    def test_spaces(self, engine):
        entities = engine.detect("Social: 123 45 6789")
        ssns = [e for e in entities if e.entity_type == EntityType.SSN]
        assert len(ssns) == 1

    def test_invalid_group_000(self, engine):
        # 000 area group is invalid
        entities = engine.detect("000-45-6789")
        ssns = [e for e in entities if e.entity_type == EntityType.SSN]
        assert len(ssns) == 0

    def test_invalid_group_666(self, engine):
        entities = engine.detect("666-45-6789")
        ssns = [e for e in entities if e.entity_type == EntityType.SSN]
        assert len(ssns) == 0


# ── Credit Card ──────────────────────────────────────────────────────────────

class TestCreditCard:
    def test_visa_luhn_valid(self, engine):
        entities = engine.detect("Card: 4111 1111 1111 1111")
        cards = [e for e in entities if e.entity_type == EntityType.CREDIT_CARD]
        assert len(cards) == 1

    def test_visa_dashes(self, engine):
        entities = engine.detect("4111-1111-1111-1111")
        cards = [e for e in entities if e.entity_type == EntityType.CREDIT_CARD]
        assert len(cards) == 1

    def test_mastercard(self, engine):
        entities = engine.detect("5500 0000 0000 0004")
        cards = [e for e in entities if e.entity_type == EntityType.CREDIT_CARD]
        assert len(cards) == 1

    def test_invalid_luhn_rejected(self, engine):
        entities = engine.detect("4111 1111 1111 1112")  # invalid Luhn
        cards = [e for e in entities if e.entity_type == EntityType.CREDIT_CARD]
        assert len(cards) == 0


# ── IPv4 ─────────────────────────────────────────────────────────────────────

class TestIPv4:
    def test_standard(self, engine):
        entities = engine.detect("Server at 192.168.1.100")
        ips = [e for e in entities if e.entity_type == EntityType.IP_ADDRESS]
        assert len(ips) == 1
        assert ips[0].original == "192.168.1.100"

    def test_no_false_positive_year(self, engine):
        # "2024.01.01" should NOT match IP
        entities = engine.detect("version 2024.01.01 released")
        ips = [e for e in entities if e.entity_type == EntityType.IP_ADDRESS]
        assert len(ips) == 0


# ── MAC Address ───────────────────────────────────────────────────────────────

class TestMAC:
    def test_colon_separated(self, engine):
        entities = engine.detect("MAC: 00:1A:2B:3C:4D:5E")
        macs = [e for e in entities if e.entity_type == EntityType.MAC_ADDRESS]
        assert len(macs) == 1

    def test_dash_separated(self, engine):
        entities = engine.detect("00-1A-2B-3C-4D-5E")
        macs = [e for e in entities if e.entity_type == EntityType.MAC_ADDRESS]
        assert len(macs) == 1


# ── URL ───────────────────────────────────────────────────────────────────────

class TestURL:
    def test_https(self, engine):
        entities = engine.detect("Visit https://example.com/path?q=1")
        urls = [e for e in entities if e.entity_type == EntityType.URL]
        assert len(urls) == 1

    def test_http(self, engine):
        entities = engine.detect("Go to http://old.site.com")
        urls = [e for e in entities if e.entity_type == EntityType.URL]
        assert len(urls) == 1


# ── Crypto ───────────────────────────────────────────────────────────────────

class TestCrypto:
    def test_eth_address(self, engine):
        entities = engine.detect("Send to 0xAbCd1234abcd1234AbCd1234abcd1234AbCd1234")
        cryptos = [e for e in entities if e.entity_type == EntityType.CRYPTO_ADDRESS]
        assert len(cryptos) == 1

    def test_btc_p2pkh(self, engine):
        entities = engine.detect("BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na")
        cryptos = [e for e in entities if e.entity_type == EntityType.CRYPTO_ADDRESS]
        assert len(cryptos) >= 1


# ── Custom pattern ────────────────────────────────────────────────────────────

class TestCustomPattern:
    def test_add_and_detect(self, engine):
        engine.add_pattern(EntityType.CUSTOM, r"EMP-\d{4}")
        entities = engine.detect("Employee EMP-1234 submitted request")
        custom = [e for e in entities if e.entity_type == EntityType.CUSTOM]
        assert len(custom) == 1
        assert custom[0].original == "EMP-1234"


# ── IBAN ─────────────────────────────────────────────────────────────────────

class TestIBAN:
    def test_valid_gb_iban(self, engine):
        entities = engine.detect("IBAN: GB29 NWBK 6016 1331 9268 19")
        ibans = [e for e in entities if e.entity_type == EntityType.IBAN]
        assert len(ibans) == 1

    def test_invalid_iban_rejected(self, engine):
        entities = engine.detect("IBAN: GB00 FAKE 0000 0000 0000 00")
        ibans = [e for e in entities if e.entity_type == EntityType.IBAN]
        assert len(ibans) == 0
