# Tamper-Proof Digital Transaction Signing & Verification System

A production-ready fintech security system where every financial transaction is
cryptographically signed, verified, and protected against tampering and replay attacks.

## Architecture

```
React Frontend (port 3000)
        │
        │ REST API (JWT auth)
        ▼
FastAPI Backend (port 8000)
  ├── /api/v1/auth        — register, login
  ├── /api/v1/keys        — ECDSA key generation
  ├── /api/v1/transactions — sign, verify, list
  ├── /api/v1/audit       — append-only logs
  └── /api/v1/fraud       — ML anomaly detection
        │
        ▼
SQLite (demo) / PostgreSQL (production)
  ├── users
  ├── keys        (encrypted private keys)
  ├── transactions
  ├── nonces      (replay protection)
  └── audit_logs  (append-only)
```

## Security Features

| Feature | Implementation |
|---------|---------------|
| Digital Signatures | ECDSA P-256 + SHA-256 |
| Key Storage | AES-256-GCM encrypted at rest |
| Replay Protection | Nonce tracking + 5-min timestamp window |
| Tamper Detection | SHA-256 canonical payload hash |
| Authentication | JWT (HS256) |
| Password Storage | bcrypt |
| Audit Trail | Append-only, never updated/deleted |

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # edit secrets

uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dashboard: http://localhost:3000

### Run Tests

```bash
cd backend
PYTHONPATH=. pytest tests/ -v
```

## End-to-End Flow

### 1. Register & Login
```http
POST /api/v1/auth/register
{ "username": "alice", "email": "alice@example.com", "password": "secure123" }

POST /api/v1/auth/login
username=alice&password=secure123
→ { "access_token": "eyJ..." }
```

### 2. Generate Key Pair
```http
POST /api/v1/keys/generate
Authorization: Bearer <token>

→ {
    "key_id": "abc-123",
    "public_key_pem": "-----BEGIN PUBLIC KEY-----...",
    "private_key_pem": "-----BEGIN PRIVATE KEY-----..."  ← SAVE THIS, shown once
  }
```

### 3. Sign a Transaction
```http
POST /api/v1/transactions/sign
{
  "transaction": {
    "receiver_id": "bob-456",
    "amount": 250.00,
    "currency": "USD",
    "nonce": "a1b2c3d4e5f6g7h8",
    "timestamp": "2024-01-15T10:30:00"
  },
  "private_key_pem": "-----BEGIN PRIVATE KEY-----...",
  "key_id": "abc-123"
}

→ { "id": "tx-789", "status": "pending", "payload_hash": "sha256...", "signature": "base64..." }
```

### 4. Verify the Transaction
```http
POST /api/v1/transactions/verify/tx-789

→ {
    "valid": true,
    "status": "verified",
    "hash_match": true,
    "signature_valid": true,
    "replay_safe": true,
    "message": "VALID: Transaction is authentic and untampered"
  }
```

### Tamper Detection (Fail Case)
Modify any field (amount, receiver) after signing → hash mismatch → `"status": "tampered"`

### Replay Attack (Fail Case)
Submit the same nonce twice → `409 Conflict` — "Nonce has already been used"

## Project Structure

```
transaction-signing-system/
├── backend/
│   ├── app/
│   │   ├── core/          # config, security, dependencies
│   │   ├── crypto/        # ECDSA engine, AES encryption, SHA-256
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── routes/        # FastAPI route handlers
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # business logic layer
│   │   └── main.py
│   ├── tests/
│   └── requirements.txt
└── frontend/
    └── src/
        ├── pages/         # Keys, Sign, Verify, Transactions, Audit
        ├── components/    # Layout, sidebar
        ├── context/       # Auth context
        └── services/      # API client
```
