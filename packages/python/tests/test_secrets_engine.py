"""Tests for the Secrets Engine."""
import pytest

from prompt_sanitizer.engines.secrets_engine import SecretsEngine
from prompt_sanitizer.entities import EntityType


@pytest.fixture
def engine():
    return SecretsEngine()


class TestJWT:
    def test_detects_jwt(self, engine):
        jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        entities = engine.detect(f"Token: {jwt}")
        jwts = [e for e in entities if e.entity_type == EntityType.JWT]
        assert len(jwts) == 1
        assert entities[0].layer == "secrets"


class TestAWSKeys:
    def test_access_key_id(self, engine):
        entities = engine.detect("Access key: AKIAIOSFODNN7EXAMPLE")
        aws = [e for e in entities if e.entity_type == EntityType.AWS_ACCESS_KEY]
        assert len(aws) == 1

    def test_secret_key_assignment(self, engine):
        entities = engine.detect(
            "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        )
        aws = [e for e in entities if e.entity_type == EntityType.AWS_SECRET_KEY]
        assert len(aws) == 1


class TestOpenAIKey:
    def test_legacy_key(self, engine):
        entities = engine.detect("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456789012345678")
        keys = [e for e in entities if e.entity_type == EntityType.API_KEY]
        assert len(keys) >= 1

    def test_proj_key(self, engine):
        entities = engine.detect("key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij")
        keys = [e for e in entities if e.entity_type == EntityType.API_KEY]
        assert len(keys) >= 1


class TestGitHubToken:
    def test_classic_pat(self, engine):
        entities = engine.detect("GITHUB_TOKEN=ghp_" + "A" * 36)
        keys = [e for e in entities if e.entity_type == EntityType.API_KEY]
        assert len(keys) >= 1


class TestStripeKey:
    def test_secret_key(self, engine):
        entities = engine.detect("sk_live_" + "a" * 24)
        keys = [e for e in entities if e.entity_type == EntityType.API_KEY]
        assert len(keys) >= 1

    def test_test_key(self, engine):
        entities = engine.detect("sk_test_" + "b" * 24)
        keys = [e for e in entities if e.entity_type == EntityType.API_KEY]
        assert len(keys) >= 1


class TestPrivateKey:
    def test_pem_header(self, engine):
        entities = engine.detect("-----BEGIN RSA PRIVATE KEY-----\nMIIE...")
        pk = [e for e in entities if e.entity_type == EntityType.PRIVATE_KEY]
        assert len(pk) == 1


class TestDBConnection:
    def test_postgres(self, engine):
        entities = engine.detect(
            "DATABASE_URL=postgresql://admin:secret123@db.internal:5432/myapp"
        )
        db = [e for e in entities if e.entity_type == EntityType.DB_CONNECTION]
        assert len(db) == 1

    def test_mongodb(self, engine):
        entities = engine.detect(
            "MONGO_URI=mongodb+srv://user:pass@cluster0.mongodb.net/prod"
        )
        db = [e for e in entities if e.entity_type == EntityType.DB_CONNECTION]
        assert len(db) == 1

    def test_redis(self, engine):
        entities = engine.detect("redis://default:password@localhost:6379/0")
        db = [e for e in entities if e.entity_type == EntityType.DB_CONNECTION]
        assert len(db) == 1


class TestBearerToken:
    def test_authorization_header(self, engine):
        entities = engine.detect(
            "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature"
        )
        # JWT should be picked up; bearer token may overlap
        assert len(entities) >= 1
