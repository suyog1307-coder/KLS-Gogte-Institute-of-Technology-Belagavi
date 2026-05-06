"""
Face Verification Routes
========================
POST /api/v1/face/register   — enroll face (store embedding)
POST /api/v1/face/verify     — verify face (returns match result)
GET  /api/v1/face/status     — check if face is enrolled
DELETE /api/v1/face/         — remove face enrollment
"""
import logging
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

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
    enrolled:   bool
    model_name: Optional[str] = None
    enrolled_at: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=FaceEnrollResponse, status_code=201)
async def register_face(
    request:      Request,
    face_image:   UploadFile = File(..., description="Face image (JPEG/PNG, single face)"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Enroll your face. Upload a clear, well-lit photo with exactly one face.
    The raw image is NEVER stored — only the 128-d FaceNet embedding.
    Re-enrolling replaces the previous embedding.
    """
    # Validate file type
    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(
            status_code = 422,
            detail      = "Only JPEG and PNG images are accepted",
        )

    image_bytes = await face_image.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    svc = FaceService(db)
    result = svc.enroll_face(
        user_id     = current_user.id,
        image_bytes = image_bytes,
        ip_address  = request.client.host if request.client else None,
    )
    return FaceEnrollResponse(**result)


@router.post("/verify", response_model=FaceVerifyResponse)
async def verify_face(
    request:      Request,
    face_image:   UploadFile = File(..., description="Face image to verify"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Verify your face against the enrolled embedding.
    Returns match result and cosine distance.
    """
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
            else f"Face does not match (distance={distance:.4f} > threshold={settings.FACE_DISTANCE_THRESHOLD})"
        ),
    )


@router.get("/status", response_model=FaceStatusResponse)
def face_status(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Check whether the current user has a face enrolled."""
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


@router.delete("/", status_code=204)
def delete_face_enrollment(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Remove face enrollment. You will need to re-enroll to use face verification."""
    record = (
        db.query(FaceEmbedding)
        .filter(FaceEmbedding.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="No face enrollment found")
    db.delete(record)
    db.commit()
