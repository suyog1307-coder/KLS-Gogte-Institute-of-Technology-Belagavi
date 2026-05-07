from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.models.base import get_db
from app.models.models import KeyPair, User
from app.schemas.schemas import KeyPairOut
from app.services.audit_service import AuditService
from app.services.key_service import KeyService

router = APIRouter(prefix="/keys", tags=["Key Management"])


@router.post("/generate", response_model=KeyPairOut, status_code=201)
def generate_keys(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a new ECDSA P-256 key pair.
    Private key returned ONCE — never stored in plaintext.
    Keys stay active until manually revoked.
    """
    svc = KeyService(db)
    key_pair, private_pem = svc.generate_and_store(current_user)

    AuditService(db).log(
        "KEY_GENERATED",
        actor_id   = current_user.id,
        detail     = {"key_id": key_pair.id, "algorithm": key_pair.algorithm},
        ip_address = request.client.host if request.client else None,
    )

    return KeyPairOut(
        key_id          = key_pair.id,
        public_key_pem  = key_pair.public_key_pem,
        algorithm       = key_pair.algorithm,
        created_at      = key_pair.created_at,
        expires_at      = None,
        seconds_remaining = None,
        private_key_pem = private_pem,
    )


@router.get("/my-keys", response_model=list[KeyPairOut])
def list_my_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all key pairs (public keys only)."""
    keys = (
        db.query(KeyPair)
        .filter(KeyPair.user_id == current_user.id)
        .order_by(KeyPair.created_at.desc())
        .all()
    )
    return [
        KeyPairOut(
            key_id          = k.id,
            public_key_pem  = k.public_key_pem,
            algorithm       = k.algorithm,
            created_at      = k.created_at,
            expires_at      = None,
            seconds_remaining = None,
            private_key_pem = None,
        )
        for k in keys
    ]


@router.delete("/{key_id}", status_code=204)
def revoke_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke (deactivate) a key pair."""
    svc = KeyService(db)
    if not svc.revoke_key(key_id, current_user.id):
        raise HTTPException(status_code=404, detail="Key not found")
    AuditService(db).log(
        "KEY_REVOKED",
        actor_id = current_user.id,
        detail   = {"key_id": key_id},
    )
