"""
Database models — SQLite (default) / PostgreSQL compatible.
audit_logs is append-only (enforced at service layer).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float,
    ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


def _uuid():
    return str(uuid.uuid4())


# ── users ─────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id              = Column(String(36), primary_key=True, default=_uuid)
    username        = Column(String(64),  unique=True, nullable=False, index=True)
    email           = Column(String(128), unique=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    keys = relationship("KeyPair", back_populates="user", cascade="all, delete-orphan")
    transactions_sent = relationship(
        "Transaction", foreign_keys="Transaction.sender_id", back_populates="sender"
    )

    @property
    def username_or_id(self):
        return self.username or self.id


# ── keys — encrypted private key, plain public key ────────────────────────────
class KeyPair(Base):
    __tablename__ = "keys"

    id                    = Column(String(36), primary_key=True, default=_uuid)
    user_id               = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    public_key_pem        = Column(Text, nullable=False)
    encrypted_private_key = Column(Text, nullable=False)   # AES-256-GCM encrypted
    algorithm             = Column(String(16), default="ECDSA-P256")
    is_active             = Column(Boolean, default=True)
    created_at            = Column(DateTime, default=datetime.utcnow)
    revoked_at            = Column(DateTime, nullable=True)
    # Key expires 180 seconds after creation (configurable via KEY_TTL_SECONDS)
    expires_at            = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="keys")

    __table_args__ = (Index("ix_keys_user_active", "user_id", "is_active"),)


# ── transactions ──────────────────────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"

    id           = Column(String(36), primary_key=True, default=_uuid)
    sender_id    = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    receiver_id  = Column(String(128), nullable=False)
    amount       = Column(Float, nullable=False)
    currency     = Column(String(8), default="USD")
    nonce        = Column(String(64), unique=True, nullable=False, index=True)
    timestamp    = Column(DateTime, nullable=False)
    payload_hash = Column(String(64), nullable=False)   # SHA-256 hex
    signature    = Column(Text, nullable=False)          # base64 ECDSA signature
    key_id       = Column(String(36), ForeignKey("keys.id"), nullable=False)
    status       = Column(String(16), default="pending", nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)

    sender = relationship("User", foreign_keys=[sender_id], back_populates="transactions_sent")
    key    = relationship("KeyPair")

    __table_args__ = (Index("ix_tx_sender_ts", "sender_id", "timestamp"),)


# ── nonces — replay-attack prevention ────────────────────────────────────────
class Nonce(Base):
    __tablename__ = "nonces"

    id         = Column(String(36), primary_key=True, default=_uuid)
    nonce      = Column(String(64), unique=True, nullable=False, index=True)
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=False)
    used_at    = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (UniqueConstraint("nonce", name="uq_nonce"),)


# ── audit_logs — APPEND-ONLY, never updated/deleted ──────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id             = Column(String(36), primary_key=True, default=_uuid)
    event_type     = Column(String(64), nullable=False)
    actor_id       = Column(String(36), nullable=True)
    transaction_id = Column(String(36), nullable=True)
    detail         = Column(Text, nullable=True)
    ip_address     = Column(String(45), nullable=True)
    success        = Column(Boolean, nullable=False, default=True)
    created_at     = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("ix_audit_actor_ts", "actor_id", "created_at"),)


# ── face_embeddings — FaceNet embeddings (NOT raw images) ────────────────────
class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id         = Column(String(36), primary_key=True, default=_uuid)
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # 128-float FaceNet embedding stored as JSON array string
    embedding  = Column(Text, nullable=False)
    model_name = Column(String(32), default="Facenet")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_face_user_id", "user_id"),)


# ── face_verification_attempts — rate limiting ────────────────────────────────
class FaceVerificationAttempt(Base):
    __tablename__ = "face_verification_attempts"

    id         = Column(String(36), primary_key=True, default=_uuid)
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    success    = Column(Boolean, nullable=False)
    distance   = Column(Float, nullable=True)    # cosine distance recorded
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (Index("ix_face_attempt_user_ts", "user_id", "created_at"),)
