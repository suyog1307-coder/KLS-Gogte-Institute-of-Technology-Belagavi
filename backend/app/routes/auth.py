"""
Authentication Routes
=====================
POST /api/v1/auth/register          — register with username/password
POST /api/v1/auth/login             — login with password
POST /api/v1/auth/login-with-face   — login with password + face
POST /api/v1/auth/google            — Google OAuth login/register
GET  /api/v1/auth/me                — get current user profile
"""
import logging
import re
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    Request, UploadFile, status,
)
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.schemas.schemas import TokenResponse, UserOut, UserRegister
from app.services.audit_service import AuditService
from app.services.face_service import FaceService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class GoogleAuthRequest(BaseModel):
    credential: str   # Google ID token from frontend


class UserProfileOut(BaseModel):
    id:              str
    username:        str
    email:           str
    auth_provider:   str
    profile_image:   Optional[str] = None
    face_registered: bool
    created_at:      str

    class Config:
        from_attributes = True


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
        auth_provider   = "local",
        face_registered = False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    AuditService(db).log("USER_REGISTERED", actor_id=user.id,
                         detail={"username": user.username, "provider": "local"})
    return user


# ── Standard Login ────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db:   Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not user.hashed_password:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token = create_access_token(subject=user.id)
    AuditService(db).log("USER_LOGIN", actor_id=user.id)
    return TokenResponse(
        access_token    = token,
        token_type      = "bearer",
        user_id         = user.id,
        username        = user.username,
        face_registered = user.face_registered,
    )


# ── Google OAuth Login / Register ─────────────────────────────────────────────

@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """
    Verify Google ID token, create user if first time, return JWT.
    After first login, face_registered=False triggers face enrollment on frontend.
    """
    # Verify Google token
    google_user = await _verify_google_token(payload.credential)
    if not google_user:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    google_id     = google_user["sub"]
    email         = google_user.get("email", "")
    name          = google_user.get("name", "")
    picture       = google_user.get("picture", "")
    email_verified = google_user.get("email_verified", False)

    if not email_verified:
        raise HTTPException(status_code=400, detail="Google email not verified")

    # Find or create user
    user = db.query(User).filter(User.google_id == google_id).first()

    if not user:
        # Check if email already registered with local account
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            # Link Google to existing account
            existing.google_id     = google_id
            existing.profile_image = picture
            existing.auth_provider = "google"
            db.commit()
            user = existing
        else:
            # Create new Google user
            username = _generate_username(name, email, db)
            user = User(
                username        = username,
                email           = email,
                hashed_password = None,          # no password for Google users
                google_id       = google_id,
                profile_image   = picture,
                auth_provider   = "google",
                face_registered = False,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            AuditService(db).log(
                "USER_REGISTERED", actor_id=user.id,
                detail={"username": user.username, "provider": "google", "email": email}
            )

    token = create_access_token(subject=user.id)
    AuditService(db).log("USER_LOGIN_GOOGLE", actor_id=user.id,
                         detail={"email": email})

    return TokenResponse(
        access_token    = token,
        token_type      = "bearer",
        user_id         = user.id,
        username        = user.username,
        face_registered = user.face_registered,
    )


# ── Get current user profile ──────────────────────────────────────────────────

@router.get("/me", response_model=UserProfileOut)
def get_me(current_user: User = Depends(get_current_user)):
    return UserProfileOut(
        id              = current_user.id,
        username        = current_user.username,
        email           = current_user.email,
        auth_provider   = current_user.auth_provider or "local",
        profile_image   = current_user.profile_image,
        face_registered = current_user.face_registered,
        created_at      = current_user.created_at.isoformat(),
    )


# ── Login with Face ───────────────────────────────────────────────────────────

@router.post("/login-with-face", response_model=TokenResponse)
async def login_with_face(
    request:    Request,
    username:   str        = Form(...),
    password:   str        = Form(...),
    face_image: UploadFile = File(...),
    db:         Session    = Depends(get_db),
):
    ip = request.client.host if request.client else None
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Face image must be JPEG or PNG")

    image_bytes = await face_image.read()
    face_svc    = FaceService(db)

    if not face_svc.has_face_enrolled(user.id):
        raise HTTPException(status_code=404,
                            detail="No face enrolled. Enroll first via /face/register")

    is_match, distance = face_svc.verify_face(user.id, image_bytes, ip)
    if not is_match:
        raise HTTPException(status_code=401,
                            detail=f"Face verification failed (distance={distance:.4f})")

    token = create_access_token(subject=user.id)
    AuditService(db).log("USER_LOGIN_FACE", "PASS", actor_id=user.id, ip_address=ip,
                         detail={"face_distance": round(distance, 4)})
    return TokenResponse(
        access_token    = token,
        token_type      = "bearer",
        user_id         = user.id,
        username        = user.username,
        face_registered = user.face_registered,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _verify_google_token(credential: str) -> Optional[dict]:
    """Verify Google ID token and return payload."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={credential}",
                timeout=10,
            )
        if r.status_code != 200:
            return None
        data = r.json()
        # Verify audience matches our client ID (if configured)
        if settings.GOOGLE_CLIENT_ID and data.get("aud") != settings.GOOGLE_CLIENT_ID:
            logger.warning(f"Google token audience mismatch: {data.get('aud')}")
            # Allow in dev if no client ID configured
            if settings.GOOGLE_CLIENT_ID:
                return None
        return data
    except Exception as e:
        logger.error(f"Google token verification error: {e}")
        return None


def _generate_username(name: str, email: str, db: Session) -> str:
    """Generate a unique username from Google name/email."""
    base = re.sub(r"[^a-zA-Z0-9_]", "_", name.split()[0].lower() if name else email.split("@")[0])
    base = base[:20] or "user"
    username = base
    counter  = 1
    while db.query(User).filter(User.username == username).first():
        username = f"{base}_{counter}"
        counter += 1
    return username
