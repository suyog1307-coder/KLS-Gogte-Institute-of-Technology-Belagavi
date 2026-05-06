"""
Authentication Routes
=====================
POST /api/v1/auth/register        — register (JSON)
POST /api/v1/auth/login           — login with password (+ optional face)
POST /api/v1/auth/login-with-face — login with password + face (multipart)
"""
import logging
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    Request, UploadFile, status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.base import get_db
from app.models.models import User
from app.schemas.schemas import TokenResponse, UserOut, UserRegister
from app.services.audit_service import AuditService
from app.services.face_service import FaceService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Register ──────────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        username        = payload.username,
        email           = payload.email,
        hashed_password = hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    AuditService(db).log("USER_REGISTERED", actor_id=user.id,
                         detail={"username": user.username})
    return user


# ── Standard Login (password only) ───────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db:   Session = Depends(get_db),
):
    """
    Standard login with username + password.
    If FACE_REQUIRED_FOR_LOGIN=true, use /login-with-face instead.
    """
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = "Incorrect username or password",
        )

    if settings.FACE_REQUIRED_FOR_LOGIN:
        raise HTTPException(
            status_code = status.HTTP_403_FORBIDDEN,
            detail      = (
                "Face verification is required for login. "
                "Use POST /api/v1/auth/login-with-face"
            ),
        )

    token = create_access_token(subject=user.id)
    AuditService(db).log("USER_LOGIN", actor_id=user.id)
    return TokenResponse(
        access_token = token,
        token_type   = "bearer",
        user_id      = user.id,
        username     = user.username,
    )


# ── Login with Face ───────────────────────────────────────────────────────────

@router.post("/login-with-face", response_model=TokenResponse)
async def login_with_face(
    request:    Request,
    username:   str        = Form(...),
    password:   str        = Form(...),
    face_image: UploadFile = File(..., description="Face image for verification"),
    db:         Session    = Depends(get_db),
):
    """
    Login with password + face verification.
    Both must pass — password first, then face.
    """
    ip = request.client.host if request.client else None

    # 1. Password check
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        AuditService(db).log(
            "USER_LOGIN_FAILED", "FAIL",
            detail     = {"reason": "wrong password", "username": username},
            ip_address = ip,
        )
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = "Incorrect username or password",
        )

    # 2. Face check
    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Face image must be JPEG or PNG")

    image_bytes = await face_image.read()
    face_svc    = FaceService(db)

    # Check enrollment
    if not face_svc.has_face_enrolled(user.id):
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail      = (
                "No face enrolled. Please enroll your face first "
                "via POST /api/v1/face/register after logging in with password."
            ),
        )

    try:
        is_match, distance = face_svc.verify_face(
            user_id     = user.id,
            image_bytes = image_bytes,
            ip_address  = ip,
        )
    except HTTPException:
        raise

    if not is_match:
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = (
                f"Face verification failed (distance={distance:.4f}). "
                "Login blocked."
            ),
        )

    # 3. Issue token
    token = create_access_token(subject=user.id)
    AuditService(db).log(
        "USER_LOGIN_FACE", "PASS",
        actor_id   = user.id,
        ip_address = ip,
        detail     = {"face_distance": round(distance, 4)},
    )
    return TokenResponse(
        access_token = token,
        token_type   = "bearer",
        user_id      = user.id,
        username     = user.username,
    )
