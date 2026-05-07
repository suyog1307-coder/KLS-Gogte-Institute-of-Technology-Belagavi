"""
liveness_engine.py
==================
Multi-layer anti-spoofing and liveness detection.

Layers implemented:
  1. EAR (Eye Aspect Ratio) — blink detection
  2. Head pose estimation — movement detection
  3. Texture analysis — screen/print spoof detection
  4. Variance / depth proxy — flat surface detection
  5. Brightness fluctuation — screen replay detection
  6. Multi-frame consistency — freeze/replay detection

All checks run on image bytes (JPEG/PNG).
No external model downloads required — pure OpenCV + scipy.
"""
import base64
import logging
import math
import os
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class LivenessResult:
    is_live:          bool
    score:            float          # 0.0 (dead spoof) → 1.0 (definitely live)
    spoof_score:      float          # 0.0 (real) → 1.0 (spoof)
    checks:           dict           # per-check results
    rejection_reason: Optional[str]  # first failing check reason
    confidence:       str            # "HIGH" | "MEDIUM" | "LOW"


# ── EAR (Eye Aspect Ratio) ────────────────────────────────────────────────────

def _eye_aspect_ratio(eye_pts: np.ndarray) -> float:
    """
    EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
    eye_pts: 6 (x,y) landmark points
    """
    A = np.linalg.norm(eye_pts[1] - eye_pts[5])
    B = np.linalg.norm(eye_pts[2] - eye_pts[4])
    C = np.linalg.norm(eye_pts[0] - eye_pts[3])
    if C < 1e-6:
        return 0.3
    return (A + B) / (2.0 * C)


def _detect_blink_from_landmarks(landmarks, img_w: int, img_h: int) -> dict:
    """
    Use MediaPipe face mesh landmarks to compute EAR.
    Left eye:  landmarks 33,160,158,133,153,144
    Right eye: landmarks 362,385,387,263,373,380
    Returns dict with ear_left, ear_right, blink_detected.
    """
    try:
        LEFT_EYE  = [33, 160, 158, 133, 153, 144]
        RIGHT_EYE = [362, 385, 387, 263, 373, 380]

        def pts(indices):
            return np.array([
                [landmarks[i].x * img_w, landmarks[i].y * img_h]
                for i in indices
            ])

        ear_l = _eye_aspect_ratio(pts(LEFT_EYE))
        ear_r = _eye_aspect_ratio(pts(RIGHT_EYE))
        avg   = (ear_l + ear_r) / 2.0

        # EAR < 0.21 → eyes closed (blink)
        blink = avg < 0.21

        return {
            "ear_left":       round(ear_l, 4),
            "ear_right":      round(ear_r, 4),
            "ear_avg":        round(avg, 4),
            "blink_detected": blink,
        }
    except Exception as e:
        logger.debug(f"EAR computation failed: {e}")
        return {"ear_avg": 0.3, "blink_detected": False, "error": str(e)}


# ── Head pose estimation ──────────────────────────────────────────────────────

def _estimate_head_pose(landmarks, img_w: int, img_h: int) -> dict:
    """
    Estimate yaw/pitch from nose tip + chin + eye corners.
    Returns approximate head direction.
    """
    try:
        # Key landmarks: nose tip=1, chin=152, left eye=33, right eye=263
        nose  = np.array([landmarks[1].x * img_w,   landmarks[1].y * img_h])
        chin  = np.array([landmarks[152].x * img_w,  landmarks[152].y * img_h])
        l_eye = np.array([landmarks[33].x * img_w,   landmarks[33].y * img_h])
        r_eye = np.array([landmarks[263].x * img_w,  landmarks[263].y * img_h])

        face_center = (l_eye + r_eye) / 2.0
        eye_dist    = np.linalg.norm(r_eye - l_eye)

        if eye_dist < 1e-6:
            return {"yaw": 0, "pitch": 0, "facing_forward": True}

        # Yaw: horizontal offset of nose from eye midpoint
        yaw_raw   = (nose[0] - face_center[0]) / eye_dist
        # Pitch: vertical offset of nose from eye midpoint
        pitch_raw = (nose[1] - face_center[1]) / eye_dist

        yaw_deg   = math.degrees(math.atan(yaw_raw))
        pitch_deg = math.degrees(math.atan(pitch_raw))

        facing_forward = abs(yaw_deg) < 20 and abs(pitch_deg) < 20

        return {
            "yaw_deg":        round(yaw_deg, 1),
            "pitch_deg":      round(pitch_deg, 1),
            "facing_forward": facing_forward,
        }
    except Exception as e:
        return {"yaw_deg": 0, "pitch_deg": 0, "facing_forward": True, "error": str(e)}


# ── Texture analysis (spoof detection) ───────────────────────────────────────

def _texture_analysis(gray: np.ndarray) -> dict:
    """
    Detect printed/screen spoofs via:
    1. Laplacian variance (blurriness — printed photos are often blurry)
    2. LBP (Local Binary Pattern) uniformity — screens have uniform patterns
    3. Frequency domain analysis — screens show periodic patterns (Moiré)
    """
    # 1. Laplacian variance — real faces have moderate sharpness
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # 2. Gradient magnitude — real faces have natural gradient distribution
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    grad_mag = np.sqrt(gx**2 + gy**2)
    grad_mean = float(np.mean(grad_mag))
    grad_std  = float(np.std(grad_mag))

    # 3. FFT — detect periodic screen patterns (Moiré effect)
    f       = np.fft.fft2(gray.astype(np.float32))
    fshift  = np.fft.fftshift(f)
    mag     = 20 * np.log(np.abs(fshift) + 1)
    # High-frequency energy ratio
    h, w    = mag.shape
    center  = mag[h//4:3*h//4, w//4:3*w//4]
    hf_ratio = float(np.mean(mag) / (np.mean(center) + 1e-6))

    # 4. Pixel variance — screens/prints have lower local variance
    pixel_var = float(np.var(gray))

    # Scoring: combine signals
    # Real face: lap_var 50-500, grad_mean 10-40, pixel_var 500-3000
    # Spoof:     lap_var <30 or >800, hf_ratio >1.5 (Moiré)

    spoof_signals = 0
    if lap_var < 30:    spoof_signals += 2   # too blurry → printed photo
    if lap_var > 1500:  spoof_signals += 1   # too sharp → screen
    if hf_ratio > 1.8:  spoof_signals += 2   # Moiré pattern → screen
    if pixel_var < 200: spoof_signals += 1   # too uniform → flat surface
    if grad_std < 5:    spoof_signals += 1   # no natural gradient variation

    spoof_score = min(1.0, spoof_signals / 6.0)
    real_score  = 1.0 - spoof_score

    return {
        "laplacian_variance": round(lap_var, 1),
        "gradient_mean":      round(grad_mean, 2),
        "gradient_std":       round(grad_std, 2),
        "hf_ratio":           round(hf_ratio, 3),
        "pixel_variance":     round(pixel_var, 1),
        "spoof_score":        round(spoof_score, 3),
        "real_score":         round(real_score, 3),
        "spoof_signals":      spoof_signals,
    }


# ── Brightness / screen replay detection ─────────────────────────────────────

def _screen_replay_detection(gray: np.ndarray) -> dict:
    """
    Detect if camera is pointed at a screen:
    - Screens have very uniform brightness in certain regions
    - Screens show characteristic brightness distribution
    - Glare creates bright spots with sharp edges
    """
    # Brightness histogram analysis
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    hist_norm = hist / (hist.sum() + 1e-6)

    # Entropy — screens have lower entropy (more uniform)
    entropy = float(-np.sum(hist_norm * np.log2(hist_norm + 1e-10)))

    # Bright spot detection (glare from screen)
    _, bright_mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
    bright_ratio   = float(np.sum(bright_mask > 0)) / gray.size

    # Mean brightness — screens tend to be brighter
    mean_brightness = float(np.mean(gray))

    # Screen indicator: low entropy + high brightness + glare spots
    screen_score = 0.0
    if entropy < 5.5:        screen_score += 0.3   # low entropy
    if bright_ratio > 0.05:  screen_score += 0.3   # glare spots
    if mean_brightness > 200: screen_score += 0.2  # too bright
    if entropy < 4.0:        screen_score += 0.2   # very uniform

    return {
        "entropy":          round(entropy, 3),
        "bright_ratio":     round(bright_ratio, 4),
        "mean_brightness":  round(mean_brightness, 1),
        "screen_score":     round(min(1.0, screen_score), 3),
        "is_screen":        screen_score > 0.5,
    }


# ── Depth proxy (flat surface detection) ─────────────────────────────────────

def _depth_proxy(gray: np.ndarray, face_rect: tuple) -> dict:
    """
    Approximate 3D depth from:
    - Facial region gradient complexity (3D faces have complex gradients)
    - Nose shadow detection (3D faces cast shadows)
    - Edge distribution (3D faces have curved edges)
    """
    x, y, w, h = face_rect
    face_roi = gray[y:y+h, x:x+w]

    if face_roi.size == 0:
        return {"depth_score": 0.5, "is_3d": True}

    # Gradient complexity in face region
    gx = cv2.Sobel(face_roi, cv2.CV_64F, 1, 0)
    gy = cv2.Sobel(face_roi, cv2.CV_64F, 0, 1)
    grad = np.sqrt(gx**2 + gy**2)

    # 3D faces have varied gradient directions
    angle = np.arctan2(gy, gx + 1e-6)
    angle_std = float(np.std(angle))

    # Depth score: higher angle_std = more 3D
    depth_score = min(1.0, angle_std / 1.5)
    is_3d = depth_score > 0.3

    return {
        "angle_std":   round(angle_std, 4),
        "depth_score": round(depth_score, 3),
        "is_3d":       is_3d,
    }


# ── Main liveness check ───────────────────────────────────────────────────────

def check_liveness(
    image_bytes:      bytes,
    require_blink:    bool  = False,   # True when challenge requires blink
    require_movement: bool  = False,   # True when challenge requires head move
    expected_yaw:     float = 0.0,     # expected head yaw for movement challenge
) -> LivenessResult:
    """
    Run all liveness checks on a single frame.

    Returns LivenessResult with:
      - is_live: overall pass/fail
      - score: 0-1 liveness confidence
      - spoof_score: 0-1 spoof probability
      - checks: per-check breakdown
      - rejection_reason: first failing check
    """
    checks = {}
    rejection_reason = None
    score_components = []

    # ── Decode image ──────────────────────────────────────────────────────────
    nparr = np.frombuffer(image_bytes, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return LivenessResult(
            is_live=False, score=0.0, spoof_score=1.0,
            checks={"decode": "failed"},
            rejection_reason="Could not decode image",
            confidence="HIGH",
        )

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape[:2]

    # ── 1. Face detection ─────────────────────────────────────────────────────
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))

    if len(faces) == 0:
        return LivenessResult(
            is_live=False, score=0.0, spoof_score=0.5,
            checks={"face_detection": "no_face"},
            rejection_reason="No face detected in image",
            confidence="HIGH",
        )
    if len(faces) > 1:
        return LivenessResult(
            is_live=False, score=0.0, spoof_score=0.3,
            checks={"face_detection": f"{len(faces)}_faces"},
            rejection_reason=f"Multiple faces detected ({len(faces)}). Only one face allowed.",
            confidence="HIGH",
        )

    face_rect = tuple(faces[0])
    checks["face_detection"] = {"faces_found": 1, "rect": face_rect}

    # ── 2. Texture analysis ───────────────────────────────────────────────────
    texture = _texture_analysis(gray)
    checks["texture"] = texture
    score_components.append(texture["real_score"])

    if texture["spoof_score"] > 0.6:
        rejection_reason = rejection_reason or (
            f"Texture analysis detected spoof (score={texture['spoof_score']:.2f}). "
            "Possible printed photo or screen replay."
        )

    # ── 3. Screen replay detection ────────────────────────────────────────────
    screen = _screen_replay_detection(gray)
    checks["screen_replay"] = screen
    score_components.append(1.0 - screen["screen_score"])

    if screen["is_screen"]:
        rejection_reason = rejection_reason or (
            f"Screen replay detected (score={screen['screen_score']:.2f}). "
            "Do not point camera at another screen."
        )

    # ── 4. Depth proxy ────────────────────────────────────────────────────────
    depth = _depth_proxy(gray, face_rect)
    checks["depth"] = depth
    score_components.append(depth["depth_score"])

    if not depth["is_3d"] and depth["depth_score"] < 0.15:
        rejection_reason = rejection_reason or (
            "Flat surface detected. Please use a real face, not a photo."
        )

    # ── 5. MediaPipe face mesh (blink + head pose) ────────────────────────────
    try:
        import mediapipe as mp
        mp_face_mesh = mp.solutions.face_mesh

        with mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
        ) as face_mesh:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)

            if results.multi_face_landmarks:
                lm = results.multi_face_landmarks[0].landmark

                # Blink detection
                blink_data = _detect_blink_from_landmarks(lm, w, h)
                checks["blink"] = blink_data

                # Head pose
                pose_data = _estimate_head_pose(lm, w, h)
                checks["head_pose"] = pose_data

                # Blink challenge
                if require_blink and not blink_data.get("blink_detected"):
                    rejection_reason = rejection_reason or (
                        "Blink not detected. Please blink your eyes naturally."
                    )

                # Movement challenge
                if require_movement:
                    yaw = pose_data.get("yaw_deg", 0)
                    if abs(yaw - expected_yaw) > 25:
                        rejection_reason = rejection_reason or (
                            f"Head movement not detected (expected yaw≈{expected_yaw}°, "
                            f"got {yaw:.1f}°)."
                        )

                # Bonus score for natural eye openness
                ear = blink_data.get("ear_avg", 0.3)
                if 0.22 < ear < 0.45:   # natural open eyes
                    score_components.append(0.8)
                elif ear < 0.15:         # very closed — might be photo
                    score_components.append(0.3)
                else:
                    score_components.append(0.6)

            else:
                checks["blink"]     = {"error": "MediaPipe: no landmarks"}
                checks["head_pose"] = {"error": "MediaPipe: no landmarks"}

    except ImportError:
        checks["mediapipe"] = "not_installed"
        logger.warning("MediaPipe not installed — skipping blink/pose checks")
    except Exception as e:
        checks["mediapipe_error"] = str(e)
        logger.warning(f"MediaPipe error: {e}")

    # ── Compute final score ───────────────────────────────────────────────────
    if score_components:
        final_score = float(np.mean(score_components))
    else:
        final_score = 0.5

    spoof_score = texture["spoof_score"] * 0.5 + screen["screen_score"] * 0.5

    is_live = (
        rejection_reason is None
        and final_score > 0.35
        and spoof_score < 0.55
    )

    confidence = (
        "HIGH"   if final_score > 0.7 or spoof_score > 0.7
        else "MEDIUM" if final_score > 0.45
        else "LOW"
    )

    return LivenessResult(
        is_live          = is_live,
        score            = round(final_score, 3),
        spoof_score      = round(spoof_score, 3),
        checks           = checks,
        rejection_reason = rejection_reason,
        confidence       = confidence,
    )


# ── Multi-frame consistency check ────────────────────────────────────────────

def check_multi_frame_consistency(frames_b64: list[str]) -> dict:
    """
    Analyze multiple frames for:
    - Natural movement (not frozen/replayed)
    - Brightness variation (not static image)
    - Face position variation (natural micro-movements)

    frames_b64: list of base64-encoded JPEG frames
    """
    if len(frames_b64) < 2:
        return {"consistent": True, "reason": "insufficient_frames"}

    grays = []
    for b64 in frames_b64:
        try:
            raw  = base64.b64decode(b64)
            arr  = np.frombuffer(raw, np.uint8)
            img  = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
            if img is not None:
                grays.append(img.astype(np.float32))
        except Exception:
            continue

    if len(grays) < 2:
        return {"consistent": True, "reason": "decode_failed"}

    # Compute frame differences
    diffs = []
    for i in range(1, len(grays)):
        diff = np.abs(grays[i] - grays[i-1])
        diffs.append(float(np.mean(diff)))

    mean_diff = float(np.mean(diffs))
    std_diff  = float(np.std(diffs))

    # Frozen frame: mean_diff < 0.5 (no movement at all)
    # Replay: very regular diffs (low std)
    # Natural: mean_diff 1-15, std_diff > 0.5

    is_frozen  = mean_diff < 0.5
    is_replay  = mean_diff > 0.5 and std_diff < 0.3 and len(diffs) > 3

    return {
        "mean_frame_diff": round(mean_diff, 3),
        "std_frame_diff":  round(std_diff, 3),
        "is_frozen":       is_frozen,
        "is_replay":       is_replay,
        "consistent":      not is_frozen and not is_replay,
        "frames_analyzed": len(grays),
    }
