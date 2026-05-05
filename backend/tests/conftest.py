"""
Test configuration — uses in-memory SQLite (no MySQL required for tests).
We patch the engine BEFORE any app module imports it, so tests never
touch MySQL.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

# ── 1. Build the test engine FIRST, before importing anything from app ────────
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# ── 2. Patch app.models.base BEFORE the app imports it ───────────────────────
import app.models.base as _models_base  # noqa: E402
_models_base.engine = test_engine
_models_base.SessionLocal = TestingSessionLocal

# ── 3. Now import models + Base (safe — engine is already patched) ────────────
from app.models import models  # noqa: F401, E402
from app.models.base import Base, get_db  # noqa: E402

# ── 4. Create all tables on the in-memory engine ──────────────────────────────
Base.metadata.create_all(bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client():
    from app.main import app
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(client):
    import uuid
    uname = f"hdr_{uuid.uuid4().hex[:8]}"
    r1 = client.post("/api/v1/auth/register", json={
        "username": uname,
        "email": f"{uname}@example.com",
        "password": "securepass123",
    })
    assert r1.status_code == 201, f"Register failed: {r1.text}"
    resp = client.post("/api/v1/auth/login", data={
        "username": uname,
        "password": "securepass123",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}
