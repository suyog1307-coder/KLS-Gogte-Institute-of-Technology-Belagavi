from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Transaction Signing System"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # ── MySQL connection ──────────────────────────────────────────────────────
    # Format: mysql+pymysql://user:password@host:port/dbname?charset=utf8mb4
    MYSQL_USER: str = "txsign_user"
    MYSQL_PASSWORD: str = "txsign_pass"
    MYSQL_HOST: str = "localhost"
    MYSQL_PORT: int = 3306
    MYSQL_DB: str = "txsign_db"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DB}"
            f"?charset=utf8mb4"
        )

    # Security
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_32_BYTES_MIN"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Key encryption passphrase (AES-256-GCM encrypts private keys at rest)
    KEY_ENCRYPTION_SECRET: str = "CHANGE_ME_KEY_ENCRYPTION_SECRET_32B"

    # Replay attack window in seconds (5 minutes)
    REPLAY_WINDOW_SECONDS: int = 300

    # CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
