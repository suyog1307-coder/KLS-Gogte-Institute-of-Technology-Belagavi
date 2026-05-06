"""
FaceService
===========
Business logic for:
  - Face enrollment (register embedding)
  - Face verification (compare embedding)
  - Rate limiting (max attempts per window)
  - Audit logging of all face events
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.crypto.face_engine import (
    embedding_to_json,
    extract_embedding,
    json_to_embedding,
    verify_face_embedding,
)
from app.models.models import FaceEmbedding, FaceVerificationAttempt
from app.services.audit_service import AuditService

logger = logging.getLogger(__name__)


class FaceService:
    def __init__(self, db: Session):
        self.db    = db
        self.audit = AuditService(db)

    # ── Rate Limiting ─────────────────────────────────────────────────────────

    def _check_rate_limit(self, user_id: str, ip_address: Optional[str]) -> None:
        """
        Reject if user has exceeded FACE_MAX_ATTEMPTS failed attempts
        within FACE_RATE_WINDOW_SECONDS.
        """
        window_start = datetime.utcnow() - timedelta(
            seconds=settings.FACE_RATE_WINDOW_SECONDS
        )
        failed_count = (
            self.db.query(FaceVerificationAttempt)
            .filter(
                FaceVerificationAttempt.user_id   == user_id,
                FaceVerificationAttempt.success   == False,
                FaceVerificationAttempt.created_at >= window_start,
            )
            .count()
        )
        if failed_count >= settings.FACE_MAX_ATTEMPTS:
            self.audit.log(
                "FACE_RATE_LIMITED", "FAIL",
                actor_id   = user_id,
                ip_address = ip_address,
                detail     = {
                    "failed_attempts": failed_count,
                    "window_seconds":  settings.FACE_RATE_WINDOW_SECONDS,
                },
            )
            raise HTTPException(
                status_code = status.HTTP_429_TOO_MANY_REQUESTS,
                detail      = (
                    f"Too many failed face verification attempts "
                    f"({failed_count}/{settings.FACE_MAX_ATTEMPTS}). "
                    f"Try again in {settings.FACE_RATE_WINDOW_SECONDS // 60} minutes."
                ),
            )

    def _record_attempt(
        self,
        user_id:    str,
        success:    bool,
        distance:   Optional[float],
        ip_address: Optional[str],
    ) -> None:
        attempt = FaceVerificationAttempt(
            user_id    = user_id,
            success    = success,
            distance   = distance,
            ip_address = ip_address,
        )
        self.db.add(attempt)
        self.db.commit()

    # ── Enrollment ────────────────────────────────────────────────────────────

    def enroll_face(
        self,
        user_id:     str,
        image_bytes: bytes,
        ip_address:  Optional[str] = None,
    ) -> dict:
        """
        Extract FaceNet embedding from image and store in DB.
        Replaces any existing embedding for the user.
        Raw image is NEVER stored.
        """
        try:
            embedding = extract_embedding(image_bytes)
        except ValueError as e:
            self.audit.log(
                "FACE_ENROLL_FAILED", "FAIL",
                actor_id   = user_id,
                ip_address = ip_address,
                detail     = {"reason": str(e)},
            )
            raise HTTPException(status_code=422, detail=str(e))
        except RuntimeError as e:
            self.audit.log(
                "FACE_ENROLL_FAILED", "FAIL",
                actor_id   = user_id,
                ip_address = ip_address,
                detail     = {"reason": str(e)},
            )
            raise HTTPException(status_code=500, detail=str(e))

        # Upsert — replace existing embedding
        existing = (
            self.db.query(FaceEmbedding)
            .filter(FaceEmbedding.user_id == user_id)
            .first()
        )
        if existing:
            existing.embedding  = embedding_to_json(embedding)
            existing.model_name = settings.FACE_MODEL
            existing.updated_at = datetime.utcnow()
            self.db.commit()
            action = "updated"
        else:
            record = FaceEmbedding(
                user_id    = user_id,
                embedding  = embedding_to_json(embedding),
                model_name = settings.FACE_MODEL,
            )
            self.db.add(record)
            self.db.commit()
            action = "created"

        self.audit.log(
            "FACE_ENROLLED", "PASS",
            actor_id   = user_id,
            ip_address = ip_address,
            detail     = {
                "action":     action,
                "model":      settings.FACE_MODEL,
                "embedding_dim": len(embedding),
            },
        )
        return {
            "message":       f"Face enrollment successful ({action})",
            "model":         settings.FACE_MODEL,
            "embedding_dim": len(embedding),
        }

    # ── Verification ──────────────────────────────────────────────────────────

    def verify_face(
        self,
        user_id:     str,
        image_bytes: bytes,
        ip_address:  Optional[str] = None,
    ) -> tuple[bool, float]:
        """
        Verify face against stored embedding.

        Returns (is_match, distance).
        Raises HTTPException on rate limit, no enrollment, or extraction error.
        """
        # 1. Rate limit check
        self._check_rate_limit(user_id, ip_address)

        # 2. Load stored embedding
        record = (
            self.db.query(FaceEmbedding)
            .filter(FaceEmbedding.user_id == user_id)
            .first()
        )
        if not record:
            raise HTTPException(
                status_code = status.HTTP_404_NOT_FOUND,
                detail      = (
                    "No face enrolled for this user. "
                    "Please enroll your face first via POST /api/v1/face/register"
                ),
            )

        # 3. Extract embedding from input image
        try:
            input_embedding = extract_embedding(image_bytes)
        except ValueError as e:
            self._record_attempt(user_id, False, None, ip_address)
            self.audit.log(
                "FACE_VERIFY_FAILED", "FAIL",
                actor_id   = user_id,
                ip_address = ip_address,
                detail     = {"reason": str(e)},
            )
            raise HTTPException(status_code=422, detail=str(e))
        except RuntimeError as e:
            self._record_attempt(user_id, False, None, ip_address)
            raise HTTPException(status_code=500, detail=str(e))

        # 4. Compare embeddings
        stored_embedding = json_to_embedding(record.embedding)
        is_match, distance = verify_face_embedding(stored_embedding, input_embedding)

        # 5. Record attempt
        self._record_attempt(user_id, is_match, distance, ip_address)

        # 6. Audit log
        self.audit.log(
            "FACE_VERIFIED" if is_match else "FACE_VERIFY_FAILED",
            "PASS" if is_match else "FAIL",
            actor_id   = user_id,
            ip_address = ip_address,
            detail     = {
                "distance":  round(distance, 4),
                "threshold": settings.FACE_DISTANCE_THRESHOLD,
                "match":     is_match,
            },
        )

        return is_match, distance

    def has_face_enrolled(self, user_id: str) -> bool:
        return (
            self.db.query(FaceEmbedding)
            .filter(FaceEmbedding.user_id == user_id)
            .first()
        ) is not None
