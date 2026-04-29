from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.services.fraud_service import FraudAssessment, FraudDetectionService

router = APIRouter(prefix="/fraud", tags=["Fraud Detection"])


class FraudCheckRequest(BaseModel):
    amount: float = Field(..., gt=0)
    currency: str = Field(default="USD")


@router.post("/assess", response_model=FraudAssessment)
def assess_fraud(
    payload: FraudCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Assess fraud risk for a proposed transaction amount.
    Call this before signing to get a risk assessment.
    """
    svc = FraudDetectionService(db)
    return svc.assess(current_user.id, payload.amount, payload.currency)
