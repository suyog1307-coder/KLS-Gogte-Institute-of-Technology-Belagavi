"""
Pydantic v2 request/response schemas.
"""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(..., min_length=8)

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("Username must be alphanumeric (underscores/hyphens allowed)")
        return v


class UserLogin(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token:    str
    token_type:      str = "bearer"
    user_id:         str
    username:        str
    face_registered: bool = False   # True = face enrolled, False = must enroll


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Keys ──────────────────────────────────────────────────────────────────────

class KeyPairOut(BaseModel):
    key_id:            str
    public_key_pem:    str
    algorithm:         str
    created_at:        datetime
    expires_at:        Optional[datetime] = None
    seconds_remaining: Optional[int] = None
    # Private key returned ONCE at generation, never again
    private_key_pem:   Optional[str] = None

    class Config:
        from_attributes = True


# ── Transactions ──────────────────────────────────────────────────────────────

class TransactionCreate(BaseModel):
    receiver_id: str = Field(..., min_length=1, max_length=128)
    amount: float = Field(..., gt=0, le=1_000_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    nonce: str = Field(..., min_length=16, max_length=64,
                       description="Unique random string, min 16 chars")
    timestamp: str = Field(..., description="ISO-8601 UTC timestamp")
    metadata: Optional[dict[str, Any]] = None

    @field_validator("currency")
    @classmethod
    def currency_upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("nonce")
    @classmethod
    def nonce_safe(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_\-]+$", v):
            raise ValueError("Nonce must be alphanumeric")
        return v


class TransactionSign(BaseModel):
    """Client sends the transaction data + their private key (in-memory only, never logged)."""
    transaction: TransactionCreate
    private_key_pem: str = Field(..., description="PEM private key — used in-memory, never stored")
    key_id: str = Field(..., description="ID of the registered public key")


class TransactionVerify(BaseModel):
    """Verify a previously signed transaction by its ID."""
    transaction_id: str


class TransactionVerifyPayload(BaseModel):
    """Verify an arbitrary payload (for tamper-detection demo)."""
    sender_id: str
    receiver_id: str
    amount: float
    currency: str
    nonce: str
    timestamp: str
    signature: str
    public_key_pem: str
    metadata: Optional[dict[str, Any]] = None


class TransactionOut(BaseModel):
    id:           str
    sender_id:    str
    sender_username: Optional[str] = None
    receiver_id:  str
    amount:       float
    currency:     str
    nonce:        str
    timestamp:    datetime
    payload_hash: str
    signature:    str
    key_id:       str
    status:       str
    created_at:   datetime

    class Config:
        from_attributes = True


class BalanceSummary(BaseModel):
    sent_count:  int
    sent_total:  float
    recv_count:  int
    recv_total:  float
    net_balance: float


class VerificationResult(BaseModel):
    transaction_id: str
    valid: bool
    status: str
    hash_match: bool
    signature_valid: bool
    replay_safe: bool
    message: str
    checked_at: datetime


# ── Audit Logs ────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: str
    event_type: str
    actor_id: Optional[str]
    transaction_id: Optional[str]
    detail: Optional[str]
    ip_address: Optional[str]
    success: bool
    created_at: datetime

    class Config:
        from_attributes = True
