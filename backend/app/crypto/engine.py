"""
Cryptography Engine
===================
- ECDSA P-256 key generation
- SHA-256 canonical payload hashing
- Digital signature creation & verification
- AES-256-GCM private key encryption/decryption at rest
"""
import base64
import hashlib
import json
import os
from typing import Tuple

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend

from app.core.config import settings


# ── Key Generation ────────────────────────────────────────────────────────────

def generate_key_pair() -> Tuple[str, str]:
    """
    Generate an ECDSA P-256 key pair.
    Returns (public_key_pem, private_key_pem) — both as PEM strings.
    The private key PEM is NEVER stored; caller must encrypt it immediately.
    """
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    return public_pem, private_pem


# ── Private Key Encryption at Rest (AES-256-GCM) ─────────────────────────────

def _derive_aes_key() -> bytes:
    """Derive a 32-byte AES key from the application secret using SHA-256."""
    return hashlib.sha256(settings.KEY_ENCRYPTION_SECRET.encode()).digest()


def encrypt_private_key(private_key_pem: str) -> str:
    """
    Encrypt a PEM private key with AES-256-GCM.
    Returns a base64-encoded string: nonce(12) + ciphertext + tag(16).
    """
    aes_key = _derive_aes_key()
    aesgcm = AESGCM(aes_key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, private_key_pem.encode(), None)
    # nonce || ciphertext (ciphertext already includes the 16-byte GCM tag)
    blob = nonce + ciphertext
    return base64.b64encode(blob).decode()


def decrypt_private_key(encrypted_blob: str) -> str:
    """Decrypt an AES-256-GCM encrypted private key blob back to PEM."""
    aes_key = _derive_aes_key()
    aesgcm = AESGCM(aes_key)
    raw = base64.b64decode(encrypted_blob)
    nonce = raw[:12]
    ciphertext = raw[12:]
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode()


# ── Canonical Payload Hashing ─────────────────────────────────────────────────

def canonical_payload(
    sender_id: str,
    receiver_id: str,
    amount: float,
    currency: str,
    nonce: str,
    timestamp: str,          # ISO-8601 string
    metadata: dict | None = None,
) -> str:
    """
    Build a deterministic JSON string for hashing.
    Keys are sorted; floats are rounded to 8 decimal places to avoid
    floating-point representation drift.
    """
    payload = {
        "sender_id": sender_id,
        "receiver_id": receiver_id,
        "amount": round(float(amount), 8),
        "currency": currency.upper(),
        "nonce": nonce,
        "timestamp": timestamp,
    }
    if metadata:
        payload["metadata"] = metadata
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def hash_payload(canonical: str) -> str:
    """Return hex-encoded SHA-256 of the canonical payload string."""
    return hashlib.sha256(canonical.encode()).hexdigest()


# ── Signing ───────────────────────────────────────────────────────────────────

def sign_payload(canonical: str, private_key_pem: str) -> str:
    """
    Sign the canonical payload with ECDSA P-256 + SHA-256.
    Returns base64-encoded DER signature.
    """
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(), password=None, backend=default_backend()
    )
    signature_der = private_key.sign(canonical.encode(), ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(signature_der).decode()


# ── Verification ──────────────────────────────────────────────────────────────

def verify_signature(canonical: str, signature_b64: str, public_key_pem: str) -> bool:
    """
    Verify an ECDSA P-256 signature against the canonical payload.
    Returns True if valid, False otherwise (never raises on bad sig).
    """
    try:
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode(), backend=default_backend()
        )
        signature_der = base64.b64decode(signature_b64)
        public_key.verify(signature_der, canonical.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


def verify_payload_hash(canonical: str, stored_hash: str) -> bool:
    """Recompute hash and compare — detects field-level tampering."""
    return hash_payload(canonical) == stored_hash
