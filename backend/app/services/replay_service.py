"""
Replay Attack Prevention Service
=================================
Strategy:
  1. Every transaction carries a unique nonce (UUID or random hex, min 16 chars).
  2. The nonce is stored in the `nonces` table on first use.
  3. Any subsequent request with the same nonce is rejected immediately.
  4. The transaction timestamp must be within ±REPLAY_WINDOW_SECONDS of server time.
  5. Expired nonce records are kept for audit purposes (no deletion).
"""
from datetime import datetime, timedelta
from typing import Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import Nonce


class ReplayProtectionService:
    def __init__(self, db: Session):
        self.db = db

    def check_and_consume(
        self, nonce: str, user_id: str, tx_timestamp: datetime
    ) -> Tuple[bool, str]:
        """
        Returns (is_safe, reason).
        is_safe=True means the nonce is fresh and the timestamp is within window.
        """
        now = datetime.utcnow()

        # 1. Timestamp window check
        delta = abs((now - tx_timestamp).total_seconds())
        if delta > settings.REPLAY_WINDOW_SECONDS:
            return False, (
                f"Timestamp out of allowed window "
                f"({delta:.0f}s > {settings.REPLAY_WINDOW_SECONDS}s)"
            )

        # 2. Nonce uniqueness check
        existing = self.db.query(Nonce).filter(Nonce.nonce == nonce).first()
        if existing:
            return False, (
                "This transaction has already been submitted (duplicate nonce). "
                "A new nonce has been generated — please try again."
            )

        # 3. Consume the nonce
        record = Nonce(
            nonce=nonce,
            user_id=user_id,
            used_at=now,
            expires_at=now + timedelta(seconds=settings.REPLAY_WINDOW_SECONDS),
        )
        self.db.add(record)
        self.db.commit()

        return True, "OK"

    def is_nonce_used(self, nonce: str) -> bool:
        return self.db.query(Nonce).filter(Nonce.nonce == nonce).first() is not None
