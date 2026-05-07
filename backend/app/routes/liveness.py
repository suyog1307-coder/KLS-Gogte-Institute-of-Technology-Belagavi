"""
Liveness & Anti-Spoofing Routes
================================
POST /api/v1/liveness/check          — single-frame liveness check
POST /api/v1/liveness/multi-frame    — multi-frame consistency check
POST /api/v1/liveness/verify-live    — full pipeline: liveness + face match
POST /api/v1/liveness/challenge      — get random challenge for session
"""
import base64
import logging
import random
import time
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import User
from app.services.audit_service import AuditService
from app.services.face_service import FaceService
from app.crypto.liveness_engine import check_liveness, check_multi_frame_consistency

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/liveness", tags=["Anti-Spoofing & Liveness"])

# ── Challenge pool ────────────────────────────────────────────────────────────
CHALLENGES = [
    {"id": "blink",      "instruction": "Please blink your eyes",        "require_blink": True,  "require_movement": False, "expected_yaw": 0},
    {"id": "blink2",     "instruction": "Blink twice slowly",            "require_blink": True,  "require_movement": False, "expected_yaw": 0},
    {"id": "turn_left",  "instruction": "Turn your head slightly left",  "require_blink": False, "require_movement": True,  "expected_yaw": -20},
    {"id": "turn_right", "instruction": "Turn your head slightly right", "require_blink": False, "require_movement": True,  "expected_yaw": 20},
    {"id": "look_up",    "instruction": "Look slightly upward",          "require_blink": False, "require_movement": True,  "expected_yaw": 0},
    {"id": "forward",    "instruction": "Look directly at the camera",   "require_blink": False, "require_movement": False, "expected_yaw": 0},
]

# ── Schemas ───────────────────────────────────────────────────────────────────

class ChallengeOut(BaseModel):
    challenge_id:  str
    instruction:   str
    expires_at:    float   # unix timestamp

class LivenessCheckOut(BaseModel):
    is_live:          bool
    score:            float
    spoof_score:      float
    confidence:       str
    rejection_reason: Optional[str]
    checks:           dict

class MultiFrameOut(BaseModel):
    consistent:       bool
    mean_frame_diff:  float
    is_frozen:        bool
    is_replay:        bool
    frames_analyzed:  int

class VerifyLiveOut(BaseModel):
    passed:           bool
    liveness_score:   float
    spoof_score:      float
    face_match:       bool
    face_distance:    Optional[float]
    message:          str
    checks:           dict


# ── Get random challenge ──────────────────────────────────────────────────────

@router.get("/challenge", response_model=ChallengeOut)
def get_challenge(current_user: User = Depends(get_current_user)):
    """Get a random liveness challenge for the current session."""
    ch = random.choice(CHALLENGES)
    return ChallengeOut(
        challenge_id = ch["id"],
        instruction  = ch["instruction"],
        expires_at   = time.time() + 30,   # 30-second window
    )


# ── Single-frame liveness check ───────────────────────────────────────────────

@router.post("/check", response_model=LivenessCheckOut)
async def liveness_check(
    request:      Request,
    face_image:   UploadFile = File(...),
    challenge_id: str        = Form(default="forward"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Run multi-layer liveness check on a single frame.
    Returns detailed per-check results.
    """
    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Image must be JPEG or PNG")

    image_bytes = await face_image.read()

    # Find challenge params
    ch = next((c for c in CHALLENGES if c["id"] == challenge_id), CHALLENGES[0])

    result = check_liveness(
        image_bytes      = image_bytes,
        require_blink    = ch["require_blink"],
        require_movement = ch["require_movement"],
        expected_yaw     = ch["expected_yaw"],
    )

    # Log suspicious attempts
    if not result.is_live:
        AuditService(db).log(
            "LIVENESS_FAILED", "FAIL",
            actor_id   = current_user.id,
            ip_address = request.client.host if request.client else None,
            detail     = {
                "score":      result.score,
                "spoof_score": result.spoof_score,
                "reason":     result.rejection_reason,
                "challenge":  challenge_id,
            },
        )

    return LivenessCheckOut(
        is_live          = result.is_live,
        score            = result.score,
        spoof_score      = result.spoof_score,
        confidence       = result.confidence,
        rejection_reason = result.rejection_reason,
        checks           = result.checks,
    )


# ── Multi-frame consistency ───────────────────────────────────────────────────

@router.post("/multi-frame", response_model=MultiFrameOut)
async def multi_frame_check(
    request:      Request,
    frames:       str     = Form(..., description="JSON array of base64 JPEG frames"),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Analyze multiple frames for freeze/replay detection.
    Send 3-5 frames captured 500ms apart.
    """
    import json
    try:
        frames_list = json.loads(frames)
        if not isinstance(frames_list, list):
            raise ValueError("frames must be a JSON array")
    except Exception:
        raise HTTPException(status_code=422, detail="frames must be a JSON array of base64 strings")

    if len(frames_list) < 2:
        raise HTTPException(status_code=422, detail="At least 2 frames required")
    if len(frames_list) > 10:
        frames_list = frames_list[:10]

    result = check_multi_frame_consistency(frames_list)

    if result.get("is_frozen") or result.get("is_replay"):
        AuditService(db).log(
            "REPLAY_DETECTED", "FAIL",
            actor_id   = current_user.id,
            ip_address = request.client.host if request.client else None,
            detail     = result,
        )

    return MultiFrameOut(
        consistent      = result["consistent"],
        mean_frame_diff = result.get("mean_frame_diff", 0),
        is_frozen       = result.get("is_frozen", False),
        is_replay       = result.get("is_replay", False),
        frames_analyzed = result.get("frames_analyzed", 0),
    )


# ── Full pipeline: liveness + face match ─────────────────────────────────────

@router.post("/verify-live", response_model=VerifyLiveOut)
async def verify_face_live(
    request:      Request,
    face_image:   UploadFile = File(...),
    challenge_id: str        = Form(default="blink"),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Full verification pipeline:
      1. Liveness check (all layers)
      2. Anti-spoofing check
      3. FaceNet embedding comparison

    ALL must pass for verification to succeed.
    """
    ip = request.client.host if request.client else None

    if face_image.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(status_code=422, detail="Image must be JPEG or PNG")

    image_bytes = await face_image.read()

    # Find challenge
    ch = next((c for c in CHALLENGES if c["id"] == challenge_id), CHALLENGES[0])

    # ── Step 1: Liveness ──────────────────────────────────────────────────────
    liveness = check_liveness(
        image_bytes      = image_bytes,
        require_blink    = ch["require_blink"],
        require_movement = ch["require_movement"],
        expected_yaw     = ch["expected_yaw"],
    )

    if not liveness.is_live:
        AuditService(db).log(
            "VERIFY_LIVE_FAILED", "FAIL",
            actor_id   = current_user.id,
            ip_address = ip,
            detail     = {
                "stage":      "liveness",
                "score":      liveness.score,
                "spoof_score": liveness.spoof_score,
                "reason":     liveness.rejection_reason,
            },
        )
        return VerifyLiveOut(
            passed         = False,
            liveness_score = liveness.score,
            spoof_score    = liveness.spoof_score,
            face_match     = False,
            face_distance  = None,
            message        = f"Liveness check failed: {liveness.rejection_reason}",
            checks         = liveness.checks,
        )

    # ── Step 2: Face match ────────────────────────────────────────────────────
    face_svc = FaceService(db)

    if not face_svc.has_face_enrolled(current_user.id):
        raise HTTPException(
            status_code = 404,
            detail      = "No face enrolled. Please enroll first via /face/register",
        )

    try:
        is_match, distance = face_svc.verify_face(
            user_id     = current_user.id,
            image_bytes = image_bytes,
            ip_address  = ip,
        )
    except HTTPException:
        raise

    all_passed = liveness.is_live and is_match

    AuditService(db).log(
        "VERIFY_LIVE_PASSED" if all_passed else "VERIFY_LIVE_FAILED",
        "PASS" if all_passed else "FAIL",
        actor_id   = current_user.id,
        ip_address = ip,
        detail     = {
            "liveness_score": liveness.score,
            "spoof_score":    liveness.spoof_score,
            "face_match":     is_match,
            "face_distance":  round(distance, 4),
        },
    )

    if all_passed:
        msg = f"Verification passed (liveness={liveness.score:.2f}, distance={distance:.4f})"
    elif not is_match:
        msg = f"Face does not match (distance={distance:.4f})"
    else:
        msg = "Liveness check failed"

    return VerifyLiveOut(
        passed         = all_passed,
        liveness_score = liveness.score,
        spoof_score    = liveness.spoof_score,
        face_match     = is_match,
        face_distance  = round(distance, 4),
        message        = msg,
        checks         = liveness.checks,
    )
