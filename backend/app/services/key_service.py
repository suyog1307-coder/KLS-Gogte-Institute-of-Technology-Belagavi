"""
Key Management Service
=======================
- Generates ECDSA P-256 key pairs
- Encrypts private key with AES-256-GCM before storing
- Returns the plaintext private key ONCE to the caller (never stored in plaintext)
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.crypto.engine import (
    decrypt_private_key,
    encrypt_private_key,
    generate_key_pair,
)
from app.models.models import KeyPair, User


class KeyService:
    def __init__(self, db: Session):
        self.db = db

    def generate_and_store(self, user: User) -> tuple[KeyPair, str]:
        """
        Generate a new key pair for the user.
        Returns (KeyPair ORM object, plaintext_private_key_pem).
        The plaintext private key is returned to the caller ONCE and never persisted.
        """
        public_pem, private_pem = generate_key_pair()
        encrypted = encrypt_private_key(private_pem)

        key_pair = KeyPair(
            user_id=user.id,
            public_key_pem=public_pem,
            encrypted_private_key=encrypted,
            algorithm="ECDSA-P256",
            is_active=True,
            created_at=datetime.utcnow(),
        )
        self.db.add(key_pair)
        self.db.commit()
        self.db.refresh(key_pair)

        # Return plaintext private key to caller — it will NOT be stored
        return key_pair, private_pem

    def get_active_key(self, user_id: str) -> Optional[KeyPair]:
        return (
            self.db.query(KeyPair)
            .filter(KeyPair.user_id == user_id, KeyPair.is_active == True)
            .order_by(KeyPair.created_at.desc())
            .first()
        )

    def get_key_by_id(self, key_id: str) -> Optional[KeyPair]:
        return self.db.query(KeyPair).filter(KeyPair.id == key_id).first()

    def revoke_key(self, key_id: str, user_id: str) -> bool:
        key = (
            self.db.query(KeyPair)
            .filter(KeyPair.id == key_id, KeyPair.user_id == user_id)
            .first()
        )
        if not key:
            return False
        key.is_active = False
        key.revoked_at = datetime.utcnow()
        self.db.commit()
        return True
