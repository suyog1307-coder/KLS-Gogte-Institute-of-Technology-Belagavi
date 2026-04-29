"""
Database models — all tables are append-only by design.
audit_logs has no UPDATE/DELETE permissions enforced at the service layer.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float,
    ForeignKey, Index, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


def _uuid():
    return str(uuid.uuid4())


# ─────────────────────────────────────────────
# users
# ─────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(128), unique=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    keys = relationship("KeyPair", back_populates="user", cascade="all, delete-orphan")
    transactions_sent = relationship(
        "Transaction", foreign_keys="Transaction.sender_id", back_populates="sender"
    )


# ─────────────────────────────────────────────
# keys  — encrypted private key, plain public key
# ─────────────────────────────────────────────
class KeyPair(Base):
    __tablename__ = "keys"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # PEM-encoded public key (safe to store plaintext)
    public_key_pem = Column(Text, nullable=False)
    # AES-GCM encrypted private key (base64-encoded ciphertext + nonce + tag)
    encrypted_private_key = Column(Text, nullable=False)
    algorithm = Column(String(16), default="ECDSA-P256")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="keys")

    __table_args__ = (Index("ix_keys_user_active", "user_id", "is_active"),)


# ─────────────────────────────────────────────
# transactions
# ─────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    sender_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(String(36), nullable=False)   # external or internal user id
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="USD")
    nonce = Column(String(64), unique=True, nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False)        # client-supplied, validated
    payload_hash = Column(String(64), nullable=False)   # SHA-256 of canonical payload
    signature = Column(Text, nullable=False)            # base64 DER signature
    key_id = Column(String(36), ForeignKey("keys.id"), nullable=False)
    status = Column(
        Enum("pending", "verified", "rejected", "tampered", name="tx_status"),
        default="pending",
    )
    metadata_json = Column(Text, nullable=True)         # optional extra fields (JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

    sender = relationship("User", foreign_keys=[sender_id], back_populates="transactions_sent")
    key = relationship("KeyPair")

    __table_args__ = (Index("ix_tx_sender_ts", "sender_id", "timestamp"),)


# ─────────────────────────────────────────────
# nonces  — replay-attack prevention
# ─────────────────────────────────────────────
class Nonce(Base):
    __tablename__ = "nonces"

    id = Column(String(36), primary_key=True, default=_uuid)
    nonce = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    used_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)       # used_at + 5 min window

    __table_args__ = (UniqueConstraint("nonce", name="uq_nonce"),)


# ─────────────────────────────────────────────
# audit_logs  — APPEND-ONLY, never updated/deleted
# ─────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    event_type = Column(String(64), nullable=False)     # e.g. KEY_GENERATED, TX_SIGNED
    actor_id = Column(String(36), nullable=True)        # user who triggered event
    transaction_id = Column(String(36), nullable=True)  # linked transaction if any
    detail = Column(Text, nullable=True)                # JSON detail blob
    ip_address = Column(String(45), nullable=True)
    success = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("ix_audit_actor_ts", "actor_id", "created_at"),)
