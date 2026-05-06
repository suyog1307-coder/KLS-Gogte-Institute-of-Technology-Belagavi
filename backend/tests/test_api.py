"""
Integration tests for the full API flow.
Covers: registration, key generation, signing, verification,
tamper detection, and replay attack prevention.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest


def _now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")


def _nonce():
    return uuid.uuid4().hex  # 32-char hex nonce


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_register_and_login(self, client):
        uname = f"user_{uuid.uuid4().hex[:8]}"
        r = client.post("/api/v1/auth/register", json={
            "username": uname,
            "email": f"{uname}@test.com",
            "password": "password123",
        })
        assert r.status_code == 201

        r2 = client.post("/api/v1/auth/login", data={
            "username": uname, "password": "password123"
        })
        assert r2.status_code == 200
        assert "access_token" in r2.json()

    def test_duplicate_username_rejected(self, client):
        uname = f"dup_{uuid.uuid4().hex[:8]}"
        client.post("/api/v1/auth/register", json={
            "username": uname, "email": f"{uname}@a.com", "password": "pass1234"
        })
        r = client.post("/api/v1/auth/register", json={
            "username": uname, "email": f"{uname}2@a.com", "password": "pass1234"
        })
        assert r.status_code == 400


# ── Keys ──────────────────────────────────────────────────────────────────────

class TestKeys:
    def test_generate_keys_returns_private_key_once(self, client, auth_headers):
        r = client.post("/api/v1/keys/generate", headers=auth_headers)
        assert r.status_code == 201
        data = r.json()
        assert "private_key_pem" in data
        assert "BEGIN PRIVATE KEY" in data["private_key_pem"]
        assert "BEGIN PUBLIC KEY" in data["public_key_pem"]

    def test_list_keys_hides_private_key(self, client, auth_headers):
        client.post("/api/v1/keys/generate", headers=auth_headers)
        r = client.get("/api/v1/keys/my-keys", headers=auth_headers)
        assert r.status_code == 200
        for key in r.json():
            assert key.get("private_key_pem") is None


# ── Full Transaction Flow ─────────────────────────────────────────────────────

class TestTransactionFlow:
    def _setup(self, client, auth_headers):
        """Generate keys and return (key_id, private_key_pem)."""
        r = client.post("/api/v1/keys/generate", headers=auth_headers)
        data = r.json()
        return data["key_id"], data["private_key_pem"]

    def test_sign_and_verify_success(self, client, auth_headers):
        key_id, priv = self._setup(client, auth_headers)

        sign_resp = client.post("/api/v1/transactions/sign-json", headers=auth_headers, json={
            "transaction": {
                "receiver_id": "receiver-001",
                "amount": 100.00,
                "currency": "USD",
                "nonce": _nonce(),
                "timestamp": _now_iso(),
            },
            "private_key_pem": priv,
            "key_id": key_id,
        })
        assert sign_resp.status_code == 201
        tx_id = sign_resp.json()["id"]

        verify_resp = client.post(
            f"/api/v1/transactions/verify/{tx_id}", headers=auth_headers
        )
        assert verify_resp.status_code == 200
        result = verify_resp.json()
        assert result["valid"] is True
        assert result["status"] == "verified"
        assert result["hash_match"] is True
        assert result["signature_valid"] is True

    def test_replay_attack_rejected(self, client, auth_headers):
        """Same nonce used twice must be rejected."""
        key_id, priv = self._setup(client, auth_headers)
        nonce = _nonce()

        payload = {
            "transaction": {
                "receiver_id": "receiver-001",
                "amount": 50.00,
                "currency": "USD",
                "nonce": nonce,
                "timestamp": _now_iso(),
            },
            "private_key_pem": priv,
            "key_id": key_id,
        }

        r1 = client.post("/api/v1/transactions/sign-json", headers=auth_headers, json=payload)
        assert r1.status_code == 201

        r2 = client.post("/api/v1/transactions/sign-json", headers=auth_headers, json=payload)
        assert r2.status_code == 409  # Conflict — replay detected

    def test_tamper_detection_via_verify_payload(self, client, auth_headers):
        """
        Sign a payload, then modify the amount and verify — must fail.
        """
        from app.crypto.engine import canonical_payload, sign_payload

        _, priv = self._setup(client, auth_headers)
        key_resp = client.get("/api/v1/keys/my-keys", headers=auth_headers)
        pub = key_resp.json()[0]["public_key_pem"]

        original = dict(
            sender_id="user-001",
            receiver_id="user-002",
            amount=100.00,
            currency="USD",
            nonce=_nonce(),
            timestamp=_now_iso(),
        )
        canonical = canonical_payload(**original)
        signature = sign_payload(canonical, priv)

        # Tamper: change amount
        tampered_payload = {**original, "amount": 999999.00, "signature": signature,
                            "public_key_pem": pub}

        r = client.post(
            "/api/v1/transactions/verify-payload",
            headers=auth_headers,
            json=tampered_payload,
        )
        assert r.status_code == 200
        result = r.json()
        assert result["valid"] is False
        assert result["signature_valid"] is False

    def test_expired_timestamp_rejected(self, client, auth_headers):
        """Timestamp older than 5 minutes must be rejected."""
        key_id, priv = self._setup(client, auth_headers)
        old_ts = (datetime.utcnow() - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S")

        r = client.post("/api/v1/transactions/sign-json", headers=auth_headers, json={
            "transaction": {
                "receiver_id": "receiver-001",
                "amount": 75.00,
                "currency": "USD",
                "nonce": _nonce(),
                "timestamp": old_ts,
            },
            "private_key_pem": priv,
            "key_id": key_id,
        })
        assert r.status_code == 409  # Timestamp out of window


# ── Audit Logs ────────────────────────────────────────────────────────────────

class TestAuditLogs:
    def test_audit_logs_populated_after_actions(self, client, auth_headers):
        client.post("/api/v1/keys/generate", headers=auth_headers)
        r = client.get("/api/v1/audit/", headers=auth_headers)
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) > 0
        event_types = [l["event_type"] for l in logs]
        assert any("KEY" in e or "USER" in e for e in event_types)
