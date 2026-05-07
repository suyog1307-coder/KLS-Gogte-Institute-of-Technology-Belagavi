"""
Key Management Service
=======================
- Generates ECDSA P-256 key pairs
- Encrypts private key with AES-256-GCM before storing
- Returns the plaintext private key ONCE to the caller (never stored in plaintext)
- Keys do NOT expire — they stay active until manually revoked
"""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

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
        Keys do not expire — they stay active until revoked.
        """
        public_pem, private_pem = generate_key_pair()
        encrypted = encrypt_private_key(private_pem)
        now       = datetime.utcnow()

        key_pair = KeyPair(
            user_id               = user.id,
            public_key_pem        = public_pem,
            encrypted_private_key = encrypted,
            algorithm             = "ECDSA-P256",
            is_active             = True,
            created_at            = now,
            expires_at            = None,   # no expiry
        )
        self.db.add(key_pair)
        self.db.commit()
        self.db.refresh(key_pair)
        return key_pair, private_pem

    def get_active_key(self, user_id: str) -> Optional[KeyPair]:
        """Return the most recent active key for the user."""
        return (
            self.db.query(KeyPair)
            .filter(KeyPair.user_id == user_id, KeyPair.is_active == True)
            .order_by(KeyPair.created_at.desc())
            .first()
        )

    def get_key_by_id(self, key_id: str) -> Optional[KeyPair]:
        return self.db.query(KeyPair).filter(KeyPair.id == key_id).first()

    def check_key_valid(self, key_id: str, user_id: str) -> KeyPair:
        """
        Return the key if it is active.
        Raises HTTP 400 if not found or revoked.
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
        if not key.is_active:
            raise HTTPException(
                status_code = status.HTTP_400_BAD_REQUEST,
                detail      = "This key has been revoked. Please generate a new key pair.",
            )
        return key

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
