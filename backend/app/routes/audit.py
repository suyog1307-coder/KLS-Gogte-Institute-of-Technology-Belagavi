from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.schemas.schemas import AuditLogOut
from app.services.audit_service import AuditService

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get("/", response_model=list[AuditLogOut])
def get_audit_logs(
    transaction_id: str = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retrieve append-only audit logs for the current user.
    Optionally filter by transaction_id.
    """
    svc = AuditService(db)
    return svc.get_logs(
        actor_id=current_user.id,
        transaction_id=transaction_id,
        limit=limit,
        offset=offset,
    )
