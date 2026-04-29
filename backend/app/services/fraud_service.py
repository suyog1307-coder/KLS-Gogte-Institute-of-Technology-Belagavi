"""
Basic ML Fraud Detection (Anomaly Detection)
=============================================
Uses statistical z-score analysis on transaction amounts per user.
In production, replace with Isolation Forest or a trained model.

Risk levels:
  LOW    — amount within 2 std deviations of user's history
  MEDIUM — amount 2–3 std deviations above mean
  HIGH   — amount > 3 std deviations above mean, or first transaction
           with unusually large amount
"""
import math
import statistics
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Transaction


@dataclass
class FraudAssessment:
    risk_level: str          # LOW | MEDIUM | HIGH
    risk_score: float        # 0.0 – 1.0
    reason: str
    recommended_action: str  # ALLOW | REVIEW | BLOCK


class FraudDetectionService:
    # Thresholds
    HIGH_AMOUNT_THRESHOLD = 10_000.0   # flag any single tx above this
    Z_SCORE_MEDIUM = 2.0
    Z_SCORE_HIGH = 3.0
    MIN_HISTORY = 3                    # need at least N txs for z-score

    def __init__(self, db: Session):
        self.db = db

    def assess(self, sender_id: str, amount: float, currency: str) -> FraudAssessment:
        """Assess fraud risk for a new transaction before it is committed."""
        history = self._get_amount_history(sender_id, currency)

        # Rule 1: Absolute high-value threshold
        if amount >= self.HIGH_AMOUNT_THRESHOLD:
            return FraudAssessment(
                risk_level="HIGH",
                risk_score=0.9,
                reason=f"Amount {amount} {currency} exceeds high-value threshold "
                       f"({self.HIGH_AMOUNT_THRESHOLD})",
                recommended_action="REVIEW",
            )

        # Rule 2: Not enough history — treat as medium risk
        if len(history) < self.MIN_HISTORY:
            return FraudAssessment(
                risk_level="MEDIUM" if amount > 1000 else "LOW",
                risk_score=0.3,
                reason="Insufficient transaction history for statistical analysis",
                recommended_action="ALLOW",
            )

        # Rule 3: Z-score anomaly detection
        mean = statistics.mean(history)
        stdev = statistics.stdev(history) or 1.0  # avoid division by zero
        z = (amount - mean) / stdev

        if z > self.Z_SCORE_HIGH:
            return FraudAssessment(
                risk_level="HIGH",
                risk_score=min(0.95, 0.6 + (z - self.Z_SCORE_HIGH) * 0.1),
                reason=f"Amount is {z:.1f} standard deviations above user mean "
                       f"(mean={mean:.2f}, stdev={stdev:.2f})",
                recommended_action="REVIEW",
            )
        elif z > self.Z_SCORE_MEDIUM:
            return FraudAssessment(
                risk_level="MEDIUM",
                risk_score=0.4 + (z - self.Z_SCORE_MEDIUM) * 0.1,
                reason=f"Amount is {z:.1f} standard deviations above user mean",
                recommended_action="ALLOW",
            )
        else:
            return FraudAssessment(
                risk_level="LOW",
                risk_score=max(0.0, z * 0.1),
                reason="Amount is within normal range for this user",
                recommended_action="ALLOW",
            )

    def _get_amount_history(self, sender_id: str, currency: str) -> list[float]:
        """Fetch last 100 verified transaction amounts for the user."""
        rows = (
            self.db.query(Transaction.amount)
            .filter(
                Transaction.sender_id == sender_id,
                Transaction.currency == currency,
                Transaction.status == "verified",
            )
            .order_by(Transaction.created_at.desc())
            .limit(100)
            .all()
        )
        return [r.amount for r in rows]
