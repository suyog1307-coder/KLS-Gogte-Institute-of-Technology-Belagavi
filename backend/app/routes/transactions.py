"""
Transaction Routes
==================
POST /api/v1/transactions/sign          — sign (face required if enabled)
POST /api/v1/transactions/verify/{id}   — verify
POST /api/v1/transactions/verify-payload — ad-hoc tamper check
GET  /api/v1/transactions/              — list
GET  /api/v1/transactions/{id}          — get one

Face verification is injected BEFORE the cryptographic signing flow.
It does NOT change the signing logic — it is an additional gate.
"""
import logging
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    Query, Request, UploadFile, status,
)
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.schemas.schemas import (
    TransactionOut, TransactionSign, TransactionVerify,
    TransactionVerifyPayload, VerificationResult, BalanceSummary,
)
from app.services.face_service import FaceService
from app.services.key_service import KeyService
from app.services.transaction_service import TransactionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/transactions", tags=["Transactions"])


# ── Sign Transaction (with face gate) ────────────────────────────────────────

@router.post("/sign", response_model=TransactionOut, status_code=201)
async def sign_transaction(
    request:         Request,
    # ── Transaction fields (form data so we can also accept face image) ──
    receiver_id:     str   = Form(...),
    amount:          float = Form(...),
    currency:        str   = Form(default="INR"),
    nonce:           str   = Form(...),
    timestamp:       str   = Form(...),
    private_key_pem: str   = Form(...),
    key_id:          str   = Form(...),
    # ── Face image (required when FACE_REQUIRED_FOR_SIGNING=true) ────────
    face_image:      Optional[UploadFile] = File(
        default=None,
        description="Face image for verification (required when face signing is enabled)",
    ),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Sign a transaction with ECDSA P-256.

    When FACE_REQUIRED_FOR_SIGNING=true (default):
      - face_image is REQUIRED
      - Face is verified against enrolled embedding BEFORE signing
      - If face does not match → HTTP 401, transaction blocked

    The private key is used in-memory only — never persisted.
    """
    ip = request.client.host if request.client else None

    # ── Key expiry check (BEFORE face verification) ──────────────────────────
    key_svc = KeyService(db)
    key_svc.check_key_valid(key_id, current_user.id)   # raises 410 if expired

    # ── Face verification gate ────────────────────────────────────────────────
    if settings.FACE_REQUIRED_FOR_SIGNING and settings.FACE_ENABLED:
        if face_image is None:
            raise HTTPException(
                status_code = status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail      = (
                    "Face image is required for transaction signing. "
                    "Include face_image in the multipart form data."
                ),
            )

        if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
            raise HTTPException(
                status_code = 422,
                detail      = "Face image must be JPEG or PNG",
            )

        image_bytes = await face_image.read()
        face_svc    = FaceService(db)

        try:
            is_match, distance = face_svc.verify_face(
                user_id     = current_user.id,
                image_bytes = image_bytes,
                ip_address  = ip,
            )
        except HTTPException:
            raise  # re-raise rate limit / not enrolled errors

        if not is_match:
            logger.warning(
                f"Face verification FAILED for user {current_user.id} "
                f"(distance={distance:.4f}) — transaction blocked"
            )
            raise HTTPException(
                status_code = status.HTTP_401_UNAUTHORIZED,
                detail      = (
                    f"Face verification failed (distance={distance:.4f}, "
                    f"threshold={settings.FACE_DISTANCE_THRESHOLD}). "
                    "Transaction blocked."
                ),
            )

        logger.info(
            f"Face verified for user {current_user.id} "
            f"(distance={distance:.4f}) — proceeding to sign"
        )

    # ── Existing cryptographic signing flow (unchanged) ───────────────────────
    from app.schemas.schemas import TransactionCreate

    tx_data = TransactionCreate(
        receiver_id = receiver_id,
        amount      = amount,
        currency    = currency,
        nonce       = nonce,
        timestamp   = timestamp,
    )

    svc = TransactionService(db)
    tx  = svc.sign_transaction(
        tx_data         = tx_data,
        private_key_pem = private_key_pem,
        key_id          = key_id,
        sender_id       = current_user.id,
        ip_address      = ip,
    )
    return tx


# ── JSON sign endpoint (no face — for backward compat / testing) ──────────────

@router.post("/sign-json", response_model=TransactionOut, status_code=201)
def sign_transaction_json(
    payload:      TransactionSign,
    request:      Request,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """JSON-only signing (face bypassed). Key expiry still enforced."""
    KeyService(db).check_key_valid(payload.key_id, current_user.id)
    svc = TransactionService(db)
    return svc.sign_transaction(
        tx_data         = payload.transaction,
        private_key_pem = payload.private_key_pem,
        key_id          = payload.key_id,
        sender_id       = current_user.id,
        ip_address      = request.client.host if request.client else None,
    )


# ── Verify ────────────────────────────────────────────────────────────────────

@router.post("/verify/{transaction_id}", response_model=VerificationResult)
def verify_transaction(
    transaction_id: str,
    request:        Request,
    db:             Session = Depends(get_db),
    current_user:   User    = Depends(get_current_user),
):
    """Verify a stored transaction — hash, signature, replay protection."""
    svc = TransactionService(db)
    return svc.verify_transaction(
        transaction_id = transaction_id,
        actor_id       = current_user.id,
        ip_address     = request.client.host if request.client else None,
    )


@router.post("/verify-payload", response_model=VerificationResult)
def verify_arbitrary_payload(
    payload:      TransactionVerifyPayload,
    request:      Request,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Ad-hoc tamper detection — modify any field and see verification fail."""
    from app.crypto.engine import canonical_payload, hash_payload, verify_signature
    from datetime import datetime

    canonical = canonical_payload(
        sender_id  = payload.sender_id,
        receiver_id = payload.receiver_id,
        amount     = payload.amount,
        currency   = payload.currency,
        nonce      = payload.nonce,
        timestamp  = payload.timestamp,
        metadata   = payload.metadata,
    )
    sig_valid = verify_signature(canonical, payload.signature, payload.public_key_pem)
    return VerificationResult(
        transaction_id  = "ad-hoc",
        valid           = sig_valid,
        status          = "verified" if sig_valid else "tampered",
        hash_match      = True,
        signature_valid = sig_valid,
        replay_safe     = True,
        message         = "VALID: Signature verified" if sig_valid else "INVALID: Tampered payload",
        checked_at      = datetime.utcnow(),
    )


def _enrich(tx, db) -> dict:
    """Add sender_username to a transaction dict."""
    from app.models.models import User as UserModel
    d = {c.name: getattr(tx, c.name) for c in tx.__table__.columns}
    user = db.query(UserModel).filter(UserModel.id == tx.sender_id).first()
    d["sender_username"] = user.username if user else tx.sender_id
    return d


# ── List / Get ────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[TransactionOut])
def list_transactions(
    limit:        int     = Query(default=50, le=200),
    offset:       int     = Query(default=0,  ge=0),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List all transactions SENT by the current user."""
    txs = TransactionService(db).list_transactions(current_user.id, limit=limit, offset=offset)
    return [_enrich(tx, db) for tx in txs]


@router.get("/received", response_model=list[TransactionOut])
def list_received_transactions(
    limit:        int     = Query(default=50, le=200),
    offset:       int     = Query(default=0,  ge=0),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List all transactions RECEIVED by the current user (matched by username or user_id)."""
    txs = TransactionService(db).list_received(current_user.username, limit=limit, offset=offset)
    return [_enrich(tx, db) for tx in txs]


@router.get("/balance", response_model=BalanceSummary)
def get_balance(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Get sent/received totals and net balance for the current user."""
    return TransactionService(db).get_balance_summary(current_user.id, current_user.username)


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: str,
    db:             Session = Depends(get_db),
    current_user:   User    = Depends(get_current_user),
):
    svc = TransactionService(db)
    tx  = svc.get_transaction(transaction_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # Allow sender OR receiver to view — no one can delete
    if tx.sender_id != current_user.id and tx.receiver_id not in (
        current_user.id, current_user.username
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    return _enrich(tx, db)


# ── Explicitly block DELETE on transactions (immutable audit trail) ───────────

@router.delete("/{transaction_id}", status_code=403)
def delete_transaction_blocked():
    """
    Transactions are immutable and cannot be deleted.
    This endpoint exists only to return a clear error if attempted.
    """
    raise HTTPException(
        status_code = 403,
        detail      = (
            "Transactions are immutable and cannot be deleted. "
            "They form part of the cryptographic audit trail."
        ),
    )
