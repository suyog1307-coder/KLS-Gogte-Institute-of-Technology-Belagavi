"""
Test configuration — uses a shared in-memory SQLite database.

Key: StaticPool ensures all connections share the same in-memory DB instance,
so create_all and the test sessions see the same tables and data.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import all models so Base.metadata is fully populated
from app.models import models  # noqa: F401
from app.models.base import Base, get_db

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,  # ← all connections share the same in-memory DB
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# Create all tables once
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
    """Register + login a fresh test user, return auth headers."""
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
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
