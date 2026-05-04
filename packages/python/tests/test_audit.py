"""Tests for the Audit Log backends."""
import json
import tempfile
from pathlib import Path

import pytest

from prompt_sanitizer.audit import AuditEvent, MemoryAuditLog, SQLiteAuditLog, _now_iso


def _make_event(**kwargs) -> AuditEvent:
    defaults = dict(
        timestamp=_now_iso(),
        entity_type="EMAIL",
        confidence=0.99,
        layer="regex",
        redaction_method="synthetic",
        text_hash="abc123",
        session_id=None,
    )
    defaults.update(kwargs)
    return AuditEvent(**defaults)


# ── MemoryAuditLog ────────────────────────────────────────────────────────────

class TestMemoryAuditLog:
    def test_record_and_count(self):
        log = MemoryAuditLog()
        log.record(_make_event())
        log.record(_make_event(entity_type="SSN"))
        assert log.count() == 2

    def test_export_json(self):
        log = MemoryAuditLog()
        log.record(_make_event(entity_type="PHONE"))
        output = log.export(format="json")
        data = json.loads(output)
        assert len(data) == 1
        assert data[0]["entity_type"] == "PHONE"

    def test_export_csv(self):
        log = MemoryAuditLog()
        log.record(_make_event(entity_type="EMAIL"))
        output = log.export(format="csv")
        lines = output.strip().split("\n")
        assert len(lines) == 2  # header + 1 row
        assert "EMAIL" in lines[1]

    def test_export_empty(self):
        log = MemoryAuditLog()
        assert log.export(format="json") == "[]"

    def test_filter_since(self):
        log = MemoryAuditLog()
        log.record(_make_event())
        log.record(_make_event())
        # since "0d" should return all
        assert log.count(since="0d") == 2

    def test_no_pii_in_export(self):
        """Audit log must never contain original PII values."""
        log = MemoryAuditLog()
        log.record(_make_event(text_hash="deadbeef1234"))
        output = log.export(format="json")
        # text_hash is present, but should be a short hash not an email
        assert "@" not in output


# ── SQLiteAuditLog ────────────────────────────────────────────────────────────

class TestSQLiteAuditLog:
    def test_record_and_count(self, tmp_path):
        db = tmp_path / "audit.db"
        log = SQLiteAuditLog(db)
        log.record(_make_event())
        assert log.count() == 1

    def test_persistence(self, tmp_path):
        db = tmp_path / "audit.db"
        log1 = SQLiteAuditLog(db)
        log1.record(_make_event(entity_type="CREDIT_CARD"))
        # Reconnect
        log2 = SQLiteAuditLog(db)
        assert log2.count() == 1

    def test_export_json(self, tmp_path):
        db = tmp_path / "audit.db"
        log = SQLiteAuditLog(db)
        log.record(_make_event(entity_type="SSN"))
        data = json.loads(log.export(format="json"))
        assert data[0]["entity_type"] == "SSN"

    def test_export_csv(self, tmp_path):
        db = tmp_path / "audit.db"
        log = SQLiteAuditLog(db)
        log.record(_make_event())
        csv = log.export(format="csv")
        assert "EMAIL" in csv

    def test_session_filter(self, tmp_path):
        db = tmp_path / "audit.db"
        log = SQLiteAuditLog(db)
        log.record(_make_event(session_id="s1"))
        log.record(_make_event(session_id="s2"))
        result = json.loads(log.export(session_id="s1"))
        assert len(result) == 1
        assert result[0]["session_id"] == "s1"
