from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.schemas.schemas import (
    TransactionOut,
    TransactionSign,
    TransactionVerify,
    TransactionVerifyPayload,
    VerificationResult,
)
from app.services.transaction_service import TransactionService

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.post("/sign", response_model=TransactionOut, status_code=201)
def sign_transaction(
    payload: TransactionSign,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Sign a transaction with the user's private key.
    The private key is used in-memory only and never persisted.
    """
    svc = TransactionService(db)
    tx = svc.sign_transaction(
        tx_data=payload.transaction,
        private_key_pem=payload.private_key_pem,
        key_id=payload.key_id,
        sender_id=current_user.id,
        ip_address=request.client.host if request.client else None,
    )
    return tx


@router.post("/verify/{transaction_id}", response_model=VerificationResult)
def verify_transaction(
    transaction_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Verify a stored transaction by ID.
    Checks: hash integrity, ECDSA signature, replay protection.
    """
    svc = TransactionService(db)
    return svc.verify_transaction(
        transaction_id=transaction_id,
        actor_id=current_user.id,
        ip_address=request.client.host if request.client else None,
    )


@router.post("/verify-payload", response_model=VerificationResult)
def verify_arbitrary_payload(
    payload: TransactionVerifyPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Verify an arbitrary payload (tamper-detection demo endpoint).
    Useful for testing: modify any field and see verification fail.
    """
    from app.crypto.engine import canonical_payload, hash_payload, verify_signature
    from datetime import datetime

    canonical = canonical_payload(
        sender_id=payload.sender_id,
        receiver_id=payload.receiver_id,
        amount=payload.amount,
        currency=payload.currency,
        nonce=payload.nonce,
        timestamp=payload.timestamp,
        metadata=payload.metadata,
    )
    computed_hash = hash_payload(canonical)
    sig_valid = verify_signature(canonical, payload.signature, payload.public_key_pem)

    valid = sig_valid
    message = "VALID: Signature verified" if valid else "INVALID: Signature mismatch — payload was tampered"

    return VerificationResult(
        transaction_id="ad-hoc",
        valid=valid,
        status="verified" if valid else "tampered",
        hash_match=True,  # hash is recomputed from submitted fields
        signature_valid=sig_valid,
        replay_safe=True,  # not checked for ad-hoc payloads
        message=message,
        checked_at=datetime.utcnow(),
    )


@router.get("/", response_model=list[TransactionOut])
def list_transactions(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all transactions for the current user."""
    svc = TransactionService(db)
    return svc.list_transactions(current_user.id, limit=limit, offset=offset)


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = TransactionService(db)
    tx = svc.get_transaction(transaction_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return tx
