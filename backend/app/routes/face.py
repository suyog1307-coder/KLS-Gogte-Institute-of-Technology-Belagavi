"""
Face Verification Routes
========================
POST /api/v1/face/register          — enroll face (stores embedding, marks face_registered=True)
POST /api/v1/face/verify            — verify face standalone
GET  /api/v1/face/status            — check enrollment status
DELETE /api/v1/face/                — delete face (REQUIRES live face verification first)
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import FaceEmbedding, User
from app.services.face_service import FaceService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/face", tags=["Face Verification"])


# ── Response schemas ──────────────────────────────────────────────────────────

class FaceEnrollResponse(BaseModel):
    message:       str
    model:         str
    embedding_dim: int


class FaceVerifyResponse(BaseModel):
    match:     bool
    distance:  float
    threshold: float
    message:   str


class FaceStatusResponse(BaseModel):
    enrolled:    bool
    model_name:  Optional[str] = None
    enrolled_at: Optional[str] = None


# ── Enroll ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=FaceEnrollResponse, status_code=201)
async def register_face(
    request:      Request,
    face_image:   UploadFile = File(..., description="Face image (JPEG/PNG, single face)"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Enroll face. Raw image never stored — only 128-d FaceNet embedding.
    Sets user.face_registered = True after successful enrollment.
    """
    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Only JPEG and PNG images are accepted")

    image_bytes = await face_image.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    svc    = FaceService(db)
    result = svc.enroll_face(
        user_id     = current_user.id,
        image_bytes = image_bytes,
        ip_address  = request.client.host if request.client else None,
    )

    # Mark face as registered on the user record
    current_user.face_registered = True
    db.commit()

    return FaceEnrollResponse(**result)


# ── Verify ────────────────────────────────────────────────────────────────────

@router.post("/verify", response_model=FaceVerifyResponse)
async def verify_face(
    request:      Request,
    face_image:   UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """Verify face against enrolled embedding."""
    from app.core.config import settings

    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Only JPEG and PNG images are accepted")

    image_bytes = await face_image.read()
    svc = FaceService(db)
    is_match, distance = svc.verify_face(
        user_id     = current_user.id,
        image_bytes = image_bytes,
        ip_address  = request.client.host if request.client else None,
    )

    return FaceVerifyResponse(
        match     = is_match,
        distance  = round(distance, 4),
        threshold = settings.FACE_DISTANCE_THRESHOLD,
        message   = (
            "Face verified successfully"
            if is_match
            else f"Face does not match (distance={distance:.4f})"
        ),
    )


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=FaceStatusResponse)
def face_status(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    record = (
        db.query(FaceEmbedding)
        .filter(FaceEmbedding.user_id == current_user.id)
        .first()
    )
    if not record:
        return FaceStatusResponse(enrolled=False)
    return FaceStatusResponse(
        enrolled    = True,
        model_name  = record.model_name,
        enrolled_at = record.created_at.isoformat(),
    )


# ── Delete — REQUIRES live face verification ──────────────────────────────────

@router.delete("/", status_code=200)
async def delete_face_enrollment(
    request:      Request,
    face_image:   UploadFile = File(...,
        description="Live face capture — must match enrolled face to authorize deletion"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    SECURE DELETE: User CANNOT delete face data without first verifying
    their currently enrolled face via live webcam capture.

    Flow:
      1. Check face is enrolled
      2. Verify submitted face against stored embedding
      3. Only if match → delete embedding + set face_registered=False
      4. If no match → deny, log attempt, return 401
    """
    ip = request.client.host if request.client else None

    # 1. Check enrollment exists
    record = (
        db.query(FaceEmbedding)
        .filter(FaceEmbedding.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="No face enrollment found")

    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Face image must be JPEG or PNG")

    image_bytes = await face_image.read()

    # 2. Verify face BEFORE deleting
    svc = FaceService(db)
    try:
        is_match, distance = svc.verify_face(
            user_id     = current_user.id,
            image_bytes = image_bytes,
            ip_address  = ip,
        )
    except HTTPException as e:
        # Rate limit or other face error — propagate
        raise

    if not is_match:
        # Log suspicious deletion attempt
        from app.services.audit_service import AuditService
        AuditService(db).log(
            "FACE_DELETE_DENIED", "FAIL",
            actor_id   = current_user.id,
            ip_address = ip,
            detail     = {
                "reason":   "Face verification failed before deletion",
                "distance": round(distance, 4),
            },
        )
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = (
                f"Face verification failed (distance={distance:.4f}). "
                "You must verify your enrolled face to delete it. "
                "Deletion denied."
            ),
        )

    # 3. Verification passed — now delete
    db.delete(record)
    current_user.face_registered = False
    db.commit()

    from app.services.audit_service import AuditService
    AuditService(db).log(
        "FACE_DELETED", "PASS",
        actor_id   = current_user.id,
        ip_address = ip,
        detail     = {"verified_before_delete": True, "distance": round(distance, 4)},
    )

    return {
        "message":  "Face enrollment deleted successfully after verification",
        "verified": True,
    }
