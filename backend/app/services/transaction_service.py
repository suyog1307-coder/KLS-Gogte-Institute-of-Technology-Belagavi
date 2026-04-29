"""
Transaction Service
====================
Handles:
  - Signing a transaction payload
  - Verifying a stored transaction
  - Tamper detection (hash mismatch)
  - Replay attack prevention (delegates to ReplayProtectionService)
"""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.crypto.engine import (
    canonical_payload,
    hash_payload,
    sign_payload,
    verify_payload_hash,
    verify_signature,
)
from app.models.models import KeyPair, Transaction
from app.schemas.schemas import (
    TransactionCreate,
    VerificationResult,
)
from app.services.audit_service import AuditService
from app.services.replay_service import ReplayProtectionService


class TransactionService:
    def __init__(self, db: Session):
        self.db = db
        self.audit = AuditService(db)
        self.replay = ReplayProtectionService(db)

    # ── Sign ──────────────────────────────────────────────────────────────────

    def sign_transaction(
        self,
        tx_data: TransactionCreate,
        private_key_pem: str,
        key_id: str,
        sender_id: str,
        ip_address: Optional[str] = None,
    ) -> Transaction:
        """
        1. Validate key ownership
        2. Build canonical payload
        3. Hash it (SHA-256)
        4. Sign with ECDSA
        5. Check replay (nonce + timestamp)
        6. Persist transaction
        7. Audit log
        """
        # Validate key exists and belongs to sender
        key: Optional[KeyPair] = (
            self.db.query(KeyPair)
            .filter(KeyPair.id == key_id, KeyPair.user_id == sender_id, KeyPair.is_active == True)
            .first()
        )
        if not key:
            self.audit.log(
                "TX_SIGN_FAILED",
                actor_id=sender_id,
                detail={"reason": "Key not found or inactive", "key_id": key_id},
                ip_address=ip_address,
                success=False,
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Key not found or not active for this user")

        # Parse timestamp
        try:
            tx_ts = datetime.fromisoformat(tx_data.timestamp.replace("Z", "+00:00"))
            tx_ts = tx_ts.replace(tzinfo=None)  # store as naive UTC
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp format (use ISO-8601)")

        # Replay check BEFORE signing (fail fast)
        safe, reason = self.replay.check_and_consume(tx_data.nonce, sender_id, tx_ts)
        if not safe:
            self.audit.log(
                "TX_REPLAY_REJECTED",
                actor_id=sender_id,
                detail={"reason": reason, "nonce": tx_data.nonce},
                ip_address=ip_address,
                success=False,
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)

        # Build canonical payload and sign
        canonical = canonical_payload(
            sender_id=sender_id,
            receiver_id=tx_data.receiver_id,
            amount=tx_data.amount,
            currency=tx_data.currency,
            nonce=tx_data.nonce,
            timestamp=tx_data.timestamp,
            metadata=tx_data.metadata,
        )
        payload_hash = hash_payload(canonical)
        signature = sign_payload(canonical, private_key_pem)

        # Persist
        tx = Transaction(
            sender_id=sender_id,
            receiver_id=tx_data.receiver_id,
            amount=tx_data.amount,
            currency=tx_data.currency,
            nonce=tx_data.nonce,
            timestamp=tx_ts,
            payload_hash=payload_hash,
            signature=signature,
            key_id=key_id,
            status="pending",
        )
        self.db.add(tx)
        self.db.commit()
        self.db.refresh(tx)

        self.audit.log(
            "TX_SIGNED",
            actor_id=sender_id,
            transaction_id=tx.id,
            detail={
                "receiver_id": tx_data.receiver_id,
                "amount": tx_data.amount,
                "currency": tx_data.currency,
                "hash": payload_hash,
            },
            ip_address=ip_address,
            success=True,
        )
        return tx

    # ── Verify ────────────────────────────────────────────────────────────────

    def verify_transaction(
        self,
        transaction_id: str,
        actor_id: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> VerificationResult:
        """
        Full verification pipeline:
          1. Load transaction + key
          2. Rebuild canonical payload from stored fields
          3. Verify hash (tamper detection)
          4. Verify ECDSA signature
          5. Check nonce was consumed (replay guard)
          6. Update transaction status
          7. Audit log
        """
        tx: Optional[Transaction] = (
            self.db.query(Transaction).filter(Transaction.id == transaction_id).first()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")

        key: Optional[KeyPair] = (
            self.db.query(KeyPair).filter(KeyPair.id == tx.key_id).first()
        )
        if not key:
            raise HTTPException(status_code=404, detail="Signing key not found")

        # Rebuild canonical payload from stored fields
        canonical = canonical_payload(
            sender_id=tx.sender_id,
            receiver_id=tx.receiver_id,
            amount=tx.amount,
            currency=tx.currency,
            nonce=tx.nonce,
            timestamp=tx.timestamp.isoformat(),
        )

        # 1. Hash check
        hash_match = verify_payload_hash(canonical, tx.payload_hash)

        # 2. Signature check
        sig_valid = verify_signature(canonical, tx.signature, key.public_key_pem)

        # 3. Nonce was consumed (replay guard — nonce must exist in DB)
        replay_safe = self.replay.is_nonce_used(tx.nonce)

        overall_valid = hash_match and sig_valid and replay_safe

        # Determine status
        if not hash_match:
            new_status = "tampered"
            message = "TAMPERED: Payload hash does not match — fields were modified"
        elif not sig_valid:
            new_status = "rejected"
            message = "INVALID: Signature verification failed"
        elif not replay_safe:
            new_status = "rejected"
            message = "INVALID: Nonce not found — possible replay attack"
        else:
            new_status = "verified"
            message = "VALID: Transaction is authentic and untampered"

        # Update status (idempotent — only move forward)
        if tx.status == "pending":
            tx.status = new_status
            self.db.commit()

        self.audit.log(
            "TX_VERIFIED" if overall_valid else "TX_VERIFICATION_FAILED",
            actor_id=actor_id,
            transaction_id=tx.id,
            detail={
                "hash_match": hash_match,
                "sig_valid": sig_valid,
                "replay_safe": replay_safe,
                "status": new_status,
            },
            ip_address=ip_address,
            success=overall_valid,
        )

        return VerificationResult(
            transaction_id=tx.id,
            valid=overall_valid,
            status=new_status,
            hash_match=hash_match,
            signature_valid=sig_valid,
            replay_safe=replay_safe,
            message=message,
            checked_at=datetime.utcnow(),
        )

    def get_transaction(self, tx_id: str) -> Optional[Transaction]:
        return self.db.query(Transaction).filter(Transaction.id == tx_id).first()

    def list_transactions(
        self, sender_id: str, limit: int = 50, offset: int = 0
    ) -> list[Transaction]:
        return (
            self.db.query(Transaction)
            .filter(Transaction.sender_id == sender_id)
            .order_by(Transaction.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
