from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Transaction Signing System"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Suppress TensorFlow verbose logs
    TF_CPP_MIN_LOG_LEVEL: str = "2"
    TF_ENABLE_ONEDNN_OPTS: str = "0"

    # Database — SQLite for demo, swap DATABASE_URL for production
    DATABASE_URL: str = "sqlite:///./txsign.db"

    # Security
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_32_BYTES_MIN"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Key encryption passphrase (AES-256-GCM encrypts private keys at rest)
    KEY_ENCRYPTION_SECRET: str = "CHANGE_ME_KEY_ENCRYPTION_SECRET_32B"

    # Replay attack window in seconds (5 minutes)
    REPLAY_WINDOW_SECONDS: int = 300

    # Key TTL — key expires this many seconds after generation (180 = 3 minutes)
    KEY_TTL_SECONDS: int = 180

    # ── Face Verification ─────────────────────────────────────────────────────
    FACE_MODEL: str = "Facenet"                 # DeepFace model
    FACE_DISTANCE_THRESHOLD: float = 0.6        # cosine distance threshold
    FACE_MAX_ATTEMPTS: int = 5                  # rate limit per 10 min window
    FACE_RATE_WINDOW_SECONDS: int = 600         # 10 minute rate limit window
    FACE_REQUIRED_FOR_SIGNING: bool = True      # enforce face check on sign
    FACE_REQUIRED_FOR_LOGIN: bool = False       # optional on login
    FACE_ENFORCE_DETECTION: bool = False        # False = try all backends incl. skip

    # CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
