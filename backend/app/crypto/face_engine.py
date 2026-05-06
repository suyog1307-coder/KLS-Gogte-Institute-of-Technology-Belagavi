"""
face_engine.py
==============
FaceNet-based face verification using DeepFace.

Fixes applied:
  - Try multiple detector backends in order (ssd → opencv → skip detection)
  - Preprocess image: resize, enhance contrast before detection
  - FACE_ENFORCE_DETECTION config flag (default False for webcam captures)
  - Better error messages telling user exactly what to fix
"""
import json
import logging
import os
import tempfile
import time
from typing import Optional

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Detector backends to try in order (fastest/most reliable first) ──────────
# ssd   → fast, works on slightly angled faces
# opencv → strict, needs frontal face
# skip  → no detection, just extract embedding from full image (last resort)
_DETECTOR_BACKENDS = ["ssd", "opencv", "mtcnn", "skip"]

# ── Global model singleton ────────────────────────────────────────────────────
_deepface_loaded: bool = False
_model_load_time: float = 0.0


def _ensure_model_loaded() -> None:
    """Warm up DeepFace/FaceNet model once. Cached after first call."""
    global _deepface_loaded, _model_load_time
    if not _deepface_loaded:
        try:
            from deepface import DeepFace
            t0 = time.time()
            DeepFace.build_model(settings.FACE_MODEL)
            _model_load_time = time.time() - t0
            _deepface_loaded = True
            logger.info(f"DeepFace '{settings.FACE_MODEL}' loaded in {_model_load_time:.2f}s")
        except Exception as e:
            logger.error(f"Failed to load DeepFace model: {e}")
            raise


# ── Image preprocessing ───────────────────────────────────────────────────────

def _preprocess_image(image_bytes: bytes) -> bytes:
    """
    Preprocess image before face detection:
      - Resize to 640x480 max (keeps aspect ratio)
      - Apply CLAHE contrast enhancement (helps in low light)
      - Re-encode as JPEG
    Returns preprocessed bytes, or original bytes on any error.
    """
    try:
        import cv2
        nparr = np.frombuffer(image_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes

        # Resize if too large
        h, w = img.shape[:2]
        max_dim = 640
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            img   = cv2.resize(img, (int(w * scale), int(h * scale)),
                               interpolation=cv2.INTER_AREA)

        # CLAHE contrast enhancement on L channel (helps low-light webcam)
        lab   = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l     = clahe.apply(l)
        lab   = cv2.merge((l, a, b))
        img   = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return buf.tobytes()

    except Exception as e:
        logger.warning(f"Image preprocessing skipped: {e}")
        return image_bytes


# ── Liveness check ────────────────────────────────────────────────────────────

def _basic_liveness_check(image_bytes: bytes) -> tuple[bool, str]:
    """
    Reject obviously bad images:
      - Too small (< 50x50)
      - Near-zero variance (blank / solid color)
    """
    try:
        import cv2
        nparr = np.frombuffer(image_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return False, "Could not decode image. Please use JPEG or PNG."

        h, w = img.shape[:2]
        if h < 50 or w < 50:
            return False, f"Image too small ({w}x{h}). Minimum 50×50 required."

        gray     = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        variance = float(np.var(gray))
        if variance < 50.0:
            return False, (
                f"Image appears blank or solid color (variance={variance:.1f}). "
                "Please use a real face photo."
            )
        return True, "OK"

    except ImportError:
        return True, "OK"
    except Exception as e:
        logger.warning(f"Liveness check error: {e}")
        return True, "OK"


# ── Core embedding extraction ─────────────────────────────────────────────────

def _try_extract(tmp_path: str, enforce: bool) -> list[float]:
    """
    Try each detector backend in order.
    Returns embedding on first success.
    Raises ValueError if all backends fail.
    """
    from deepface import DeepFace

    last_error = ""
    backends   = _DETECTOR_BACKENDS if not enforce else ["ssd", "opencv", "mtcnn"]

    for backend in backends:
        try:
            logger.debug(f"Trying detector backend: {backend}")
            results = DeepFace.represent(
                img_path          = tmp_path,
                model_name        = settings.FACE_MODEL,
                enforce_detection = (backend != "skip"),
                detector_backend  = backend,
            )

            if not results:
                last_error = f"No embedding returned by {backend}"
                continue

            if len(results) > 1:
                raise ValueError(
                    f"Multiple faces detected ({len(results)}). "
                    "Please ensure only one face is visible."
                )

            embedding = results[0]["embedding"]
            logger.info(f"Face detected with backend '{backend}', dim={len(embedding)}")
            return embedding

        except ValueError:
            raise   # multiple faces — don't retry
        except Exception as e:
            last_error = str(e)
            logger.debug(f"Backend '{backend}' failed: {e}")
            continue

    raise ValueError(
        "No face could be detected in the image. "
        "Please ensure:\n"
        "• Your face is clearly visible and well-lit\n"
        "• You are looking directly at the camera\n"
        "• Only one face is in the frame\n"
        "• The image is not blurry\n"
        f"(Last error: {last_error})"
    )


# ── Public API ────────────────────────────────────────────────────────────────

def extract_embedding(image_bytes: bytes) -> list[float]:
    """
    Extract FaceNet embedding from image bytes.

    Pipeline:
      1. Liveness check (reject blank/tiny images)
      2. Preprocess (resize + CLAHE contrast)
      3. Try multiple detector backends (ssd → opencv → mtcnn → skip)
      4. Return 128-d embedding

    Raises:
        ValueError  — no face / multiple faces / liveness fail
        RuntimeError — unexpected internal error
    """
    # 1. Liveness
    is_live, reason = _basic_liveness_check(image_bytes)
    if not is_live:
        raise ValueError(reason)

    # 2. Preprocess
    processed_bytes = _preprocess_image(image_bytes)

    tmp_path: Optional[str] = None
    try:
        _ensure_model_loaded()

        with tempfile.NamedTemporaryFile(
            suffix=".jpg", delete=False, prefix="face_tmp_"
        ) as tmp:
            tmp.write(processed_bytes)
            tmp_path = tmp.name

        enforce = getattr(settings, "FACE_ENFORCE_DETECTION", False)
        return _try_extract(tmp_path, enforce=enforce)

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Unexpected face engine error: {e}")
        raise RuntimeError(f"Face processing failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ── Cosine distance ───────────────────────────────────────────────────────────

def cosine_distance(a: list[float], b: list[float]) -> float:
    """
    Cosine distance = 1 - cosine_similarity.
    Range: 0.0 (identical) → 2.0 (opposite).
    Same-person threshold typically < 0.6.
    """
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)

    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)

    if norm_a == 0 or norm_b == 0:
        return 2.0

    sim = float(np.clip(np.dot(va, vb) / (norm_a * norm_b), -1.0, 1.0))
    return 1.0 - sim


# ── Verification ──────────────────────────────────────────────────────────────

def verify_face_embedding(
    stored_embedding: list[float],
    input_embedding:  list[float],
    threshold:        Optional[float] = None,
) -> tuple[bool, float]:
    """
    Compare stored vs input embedding.
    Returns (is_match, distance).
    """
    if threshold is None:
        threshold = settings.FACE_DISTANCE_THRESHOLD

    distance = cosine_distance(stored_embedding, input_embedding)
    is_match = distance < threshold

    logger.debug(f"Face compare: dist={distance:.4f} threshold={threshold} match={is_match}")
    return is_match, distance


# ── Serialization ─────────────────────────────────────────────────────────────

def embedding_to_json(embedding: list[float]) -> str:
    return json.dumps(embedding, separators=(",", ":"))


def json_to_embedding(json_str: str) -> list[float]:
    return json.loads(json_str)
