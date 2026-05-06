"""
Key Management Service
=======================
- Generates ECDSA P-256 key pairs
- Encrypts private key with AES-256-GCM before storing
- Returns the plaintext private key ONCE to the caller (never stored in plaintext)
- Keys expire after KEY_TTL_SECONDS (default 180s = 3 minutes)
- Expired keys are auto-revoked on first use attempt
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.crypto.engine import encrypt_private_key, generate_key_pair
from app.models.models import KeyPair, User


class KeyService:
    def __init__(self, db: Session):
        self.db = db

    def generate_and_store(self, user: User) -> tuple[KeyPair, str]:
        """
        Generate a new key pair for the user.
        Returns (KeyPair ORM object, plaintext_private_key_pem).
        The plaintext private key is returned ONCE and never persisted.
        Key expires after KEY_TTL_SECONDS seconds.
        """
        public_pem, private_pem = generate_key_pair()
        encrypted  = encrypt_private_key(private_pem)
        now        = datetime.utcnow()
        expires_at = now + timedelta(seconds=settings.KEY_TTL_SECONDS)

        key_pair = KeyPair(
            user_id               = user.id,
            public_key_pem        = public_pem,
            encrypted_private_key = encrypted,
            algorithm             = "ECDSA-P256",
            is_active             = True,
            created_at            = now,
            expires_at            = expires_at,
        )
        self.db.add(key_pair)
        self.db.commit()
        self.db.refresh(key_pair)

        return key_pair, private_pem

    def get_active_key(self, user_id: str) -> Optional[KeyPair]:
        """Return the most recent active, non-expired key for the user."""
        now = datetime.utcnow()
        return (
            self.db.query(KeyPair)
            .filter(
                KeyPair.user_id   == user_id,
                KeyPair.is_active == True,
                KeyPair.expires_at > now,   # not expired
            )
            .order_by(KeyPair.created_at.desc())
            .first()
        )

    def get_key_by_id(self, key_id: str) -> Optional[KeyPair]:
        return self.db.query(KeyPair).filter(KeyPair.id == key_id).first()

    def check_key_valid(self, key_id: str, user_id: str) -> KeyPair:
        """
        Return the key if it is active and not expired.
        Auto-revokes expired keys and raises HTTP 410 Gone.
        Raises HTTP 400 if key not found or not owned by user.
        """
        key = (
            self.db.query(KeyPair)
            .filter(KeyPair.id == key_id, KeyPair.user_id == user_id)
            .first()
        )
        if not key:
            raise HTTPException(
                status_code = status.HTTP_400_BAD_REQUEST,
                detail      = "Key not found or does not belong to this user.",
            )

        now = datetime.utcnow()

        # Auto-revoke if expired
        if key.expires_at and now > key.expires_at:
            if key.is_active:
                key.is_active  = False
                key.revoked_at = now
                self.db.commit()
            raise HTTPException(
                status_code = status.HTTP_410_GONE,
                detail      = (
                    "KEY_EXPIRED: This key has expired (180-second limit). "
                    "Please generate a new key pair and try again."
                ),
            )

        if not key.is_active:
            raise HTTPException(
                status_code = status.HTTP_400_BAD_REQUEST,
                detail      = "This key has been revoked. Please generate a new key pair.",
            )

        return key

    def seconds_remaining(self, key: KeyPair) -> int:
        """Return seconds until key expires. Returns 0 if already expired."""
        if not key.expires_at:
            return settings.KEY_TTL_SECONDS
        remaining = (key.expires_at - datetime.utcnow()).total_seconds()
        return max(0, int(remaining))

    def revoke_key(self, key_id: str, user_id: str) -> bool:
        key = (
            self.db.query(KeyPair)
            .filter(KeyPair.id == key_id, KeyPair.user_id == user_id)
            .first()
        )
        if not key:
            return False
        key.is_active  = False
        key.revoked_at = datetime.utcnow()
        self.db.commit()
        return True
