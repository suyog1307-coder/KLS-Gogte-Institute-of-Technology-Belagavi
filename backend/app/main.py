"""
FastAPI Application Entry Point
================================
Tamper-Proof Digital Transaction Signing & Verification System
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
import app.models.base as models_base
from app.models.base import Base
from app.routes import auth, audit, fraud, keys, transactions
from app.routes import face as face_router
from app.routes import liveness as liveness_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Use models_base.engine so tests can swap it out before startup
    Base.metadata.create_all(bind=models_base.engine)
    yield

app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Production-ready digital transaction signing and verification system "
        "using ECDSA P-256, SHA-256, replay protection, and append-only audit logs."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
prefix = settings.API_V1_PREFIX
app.include_router(auth.router, prefix=prefix)
app.include_router(keys.router, prefix=prefix)
app.include_router(transactions.router, prefix=prefix)
app.include_router(audit.router, prefix=prefix)
app.include_router(fraud.router, prefix=prefix)
app.include_router(face_router.router, prefix=prefix)
app.include_router(liveness_router.router, prefix=prefix)


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": settings.APP_NAME}


# ── Global Exception Handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
