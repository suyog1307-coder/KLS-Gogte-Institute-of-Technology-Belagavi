"""
Database models — MySQL-first, SQLite-compatible for tests.
All tables use utf8mb4 charset on MySQL.
audit_logs is append-only (enforced at service layer).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float,
    ForeignKey, Index, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT as _MYSQL_MEDIUMTEXT
from sqlalchemy.orm import relationship

from app.models.base import Base


def _uuid():
    return str(uuid.uuid4())


def _text_col(**kwargs):
    """
    Returns MEDIUMTEXT on MySQL, plain Text on every other dialect (SQLite for tests).
    SQLAlchemy picks the right type at DDL time based on the bound engine.
    """
    return Column(Text().with_variant(_MYSQL_MEDIUMTEXT(), "mysql"), **kwargs)


# Shared MySQL table options
_MYSQL_OPTS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


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

    __table_args__ = (_MYSQL_OPTS,)


# ─────────────────────────────────────────────
# keys  — encrypted private key, plain public key
# ─────────────────────────────────────────────
class KeyPair(Base):
    __tablename__ = "keys"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    public_key_pem = _text_col(nullable=False)
    encrypted_private_key = _text_col(nullable=False)
    algorithm = Column(String(16), default="ECDSA-P256")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="keys")

    __table_args__ = (
        Index("ix_keys_user_active", "user_id", "is_active"),
        _MYSQL_OPTS,
    )


# ─────────────────────────────────────────────
# transactions
# ─────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    sender_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(String(128), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="USD")
    nonce = Column(String(64), unique=True, nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False)
    payload_hash = Column(String(64), nullable=False)
    signature = _text_col(nullable=False)
    key_id = Column(String(36), ForeignKey("keys.id"), nullable=False)
    status = Column(
        Enum("pending", "verified", "rejected", "tampered"),
        default="pending",
        nullable=False,
    )
    metadata_json = _text_col(nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sender = relationship("User", foreign_keys=[sender_id], back_populates="transactions_sent")
    key = relationship("KeyPair")

    __table_args__ = (
        Index("ix_tx_sender_ts", "sender_id", "timestamp"),
        _MYSQL_OPTS,
    )


# ─────────────────────────────────────────────
# nonces  — replay-attack prevention
# ─────────────────────────────────────────────
class Nonce(Base):
    __tablename__ = "nonces"

    id = Column(String(36), primary_key=True, default=_uuid)
    nonce = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    used_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("nonce", name="uq_nonce"),
        _MYSQL_OPTS,
    )


# ─────────────────────────────────────────────
# audit_logs  — APPEND-ONLY, never updated/deleted
# ─────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    event_type = Column(String(64), nullable=False)
    actor_id = Column(String(36), nullable=True)
    transaction_id = Column(String(36), nullable=True)
    detail = _text_col(nullable=True)
    ip_address = Column(String(45), nullable=True)
    success = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_audit_actor_ts", "actor_id", "created_at"),
        _MYSQL_OPTS,
    )
