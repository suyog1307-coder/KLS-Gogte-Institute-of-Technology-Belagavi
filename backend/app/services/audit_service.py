"""
Audit Service — append-only event logging.
This service ONLY inserts records; it never updates or deletes them.
"""
import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import AuditLog


class AuditService:
    def __init__(self, db: Session):
        self.db = db

    def log(
        self,
        event_type: str,
        actor_id: Optional[str] = None,
        transaction_id: Optional[str] = None,
        detail: Optional[dict] = None,
        ip_address: Optional[str] = None,
        success: bool = True,
    ) -> AuditLog:
        """Insert an immutable audit log entry."""
        entry = AuditLog(
            event_type=event_type,
            actor_id=actor_id,
            transaction_id=transaction_id,
            detail=json.dumps(detail) if detail else None,
            ip_address=ip_address,
            success=success,
            created_at=datetime.utcnow(),
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def get_logs(
        self,
        actor_id: Optional[str] = None,
        transaction_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditLog]:
        query = self.db.query(AuditLog)
        if actor_id:
            query = query.filter(AuditLog.actor_id == actor_id)
        if transaction_id:
            query = query.filter(AuditLog.transaction_id == transaction_id)
        return (
            query.order_by(AuditLog.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
