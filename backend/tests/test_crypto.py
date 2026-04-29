"""
Unit tests for the cryptography engine.
Tests: key generation, signing, verification, tamper detection.
"""
import pytest
from app.crypto.engine import (
    canonical_payload,
    decrypt_private_key,
    encrypt_private_key,
    generate_key_pair,
    hash_payload,
    sign_payload,
    verify_payload_hash,
    verify_signature,
)


SAMPLE_TX = dict(
    sender_id="user-001",
    receiver_id="user-002",
    amount=250.00,
    currency="USD",
    nonce="abc123def456ghi7",
    timestamp="2024-01-15T10:30:00",
)


class TestKeyGeneration:
    def test_generates_pem_keys(self):
        pub, priv = generate_key_pair()
        assert "BEGIN PUBLIC KEY" in pub
        assert "BEGIN PRIVATE KEY" in priv

    def test_keys_are_unique(self):
        pub1, priv1 = generate_key_pair()
        pub2, priv2 = generate_key_pair()
        assert pub1 != pub2
        assert priv1 != priv2


class TestPrivateKeyEncryption:
    def test_encrypt_decrypt_roundtrip(self):
        _, priv = generate_key_pair()
        encrypted = encrypt_private_key(priv)
        assert encrypted != priv
        decrypted = decrypt_private_key(encrypted)
        assert decrypted == priv

    def test_encrypted_key_is_base64(self):
        import base64
        _, priv = generate_key_pair()
        encrypted = encrypt_private_key(priv)
        # Should not raise
        base64.b64decode(encrypted)


class TestHashing:
    def test_canonical_is_deterministic(self):
        c1 = canonical_payload(**SAMPLE_TX)
        c2 = canonical_payload(**SAMPLE_TX)
        assert c1 == c2

    def test_hash_changes_on_amount_tamper(self):
        c1 = canonical_payload(**SAMPLE_TX)
        tampered = {**SAMPLE_TX, "amount": 999999.00}
        c2 = canonical_payload(**tampered)
        assert hash_payload(c1) != hash_payload(c2)

    def test_hash_changes_on_receiver_tamper(self):
        c1 = canonical_payload(**SAMPLE_TX)
        tampered = {**SAMPLE_TX, "receiver_id": "attacker-999"}
        c2 = canonical_payload(**tampered)
        assert hash_payload(c1) != hash_payload(c2)

    def test_verify_payload_hash_pass(self):
        canonical = canonical_payload(**SAMPLE_TX)
        h = hash_payload(canonical)
        assert verify_payload_hash(canonical, h) is True

    def test_verify_payload_hash_fail_on_tamper(self):
        canonical = canonical_payload(**SAMPLE_TX)
        h = hash_payload(canonical)
        tampered_canonical = canonical_payload(**{**SAMPLE_TX, "amount": 1.00})
        assert verify_payload_hash(tampered_canonical, h) is False


class TestSignatureVerification:
    def setup_method(self):
        self.pub, self.priv = generate_key_pair()
        self.canonical = canonical_payload(**SAMPLE_TX)

    def test_valid_signature(self):
        sig = sign_payload(self.canonical, self.priv)
        assert verify_signature(self.canonical, sig, self.pub) is True

    def test_tampered_payload_fails(self):
        sig = sign_payload(self.canonical, self.priv)
        tampered = canonical_payload(**{**SAMPLE_TX, "amount": 9999.00})
        assert verify_signature(tampered, sig, self.pub) is False

    def test_wrong_key_fails(self):
        sig = sign_payload(self.canonical, self.priv)
        other_pub, _ = generate_key_pair()
        assert verify_signature(self.canonical, sig, other_pub) is False

    def test_corrupted_signature_fails(self):
        sig = sign_payload(self.canonical, self.priv)
        corrupted = sig[:-4] + "XXXX"
        assert verify_signature(self.canonical, corrupted, self.pub) is False
