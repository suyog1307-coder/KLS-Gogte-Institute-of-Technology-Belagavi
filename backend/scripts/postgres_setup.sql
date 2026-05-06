-- ================================================================
--  Transaction Signing System — Complete PostgreSQL Schema
--  Run as superuser:
--    psql -U postgres -f scripts/postgres_setup.sql
-- ================================================================

-- ── 1. Database & User ────────────────────────────────────────────────────────

CREATE DATABASE txsign_db
    ENCODING   'UTF8'
    LC_COLLATE 'en_US.UTF-8'
    LC_CTYPE   'en_US.UTF-8'
    TEMPLATE   template0;

CREATE USER txsign_user WITH PASSWORD 'txsign_pass';

GRANT ALL PRIVILEGES ON DATABASE txsign_db TO txsign_user;

-- Connect to the new database for the rest of the script
\c txsign_db

GRANT ALL ON SCHEMA public TO txsign_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES    TO txsign_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO txsign_user;

-- ── 2. Tables ─────────────────────────────────────────────────────────────────

-- users
CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(36)  PRIMARY KEY,
    username        VARCHAR(64)  UNIQUE NOT NULL,
    email           VARCHAR(128) UNIQUE NOT NULL,
    hashed_password VARCHAR(256) NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_users_username ON users(username);

-- keys (encrypted private key — NEVER stored in plaintext)
CREATE TABLE IF NOT EXISTS keys (
    id                    VARCHAR(36) PRIMARY KEY,
    user_id               VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key_pem        TEXT        NOT NULL,
    encrypted_private_key TEXT        NOT NULL,
    algorithm             VARCHAR(16) NOT NULL DEFAULT 'ECDSA-P256',
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
    revoked_at            TIMESTAMP            DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS ix_keys_user_active ON keys(user_id, is_active);

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
    id            VARCHAR(36)  PRIMARY KEY,
    sender_id     VARCHAR(36)  NOT NULL REFERENCES users(id),
    receiver_id   VARCHAR(128) NOT NULL,
    amount        DOUBLE PRECISION NOT NULL,
    currency      VARCHAR(8)   NOT NULL DEFAULT 'USD',
    nonce         VARCHAR(64)  UNIQUE NOT NULL,
    timestamp     TIMESTAMP    NOT NULL,
    payload_hash  VARCHAR(64)  NOT NULL,
    signature     TEXT         NOT NULL,
    key_id        VARCHAR(36)  NOT NULL REFERENCES keys(id),
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
    metadata_json TEXT                  DEFAULT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_tx_sender_ts ON transactions(sender_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_tx_status    ON transactions(status);
CREATE INDEX IF NOT EXISTS ix_tx_nonce     ON transactions(nonce);

-- nonces (replay-attack prevention — every used nonce stored permanently)
CREATE TABLE IF NOT EXISTS nonces (
    id         VARCHAR(36) PRIMARY KEY,
    nonce      VARCHAR(64) UNIQUE NOT NULL,
    user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP   NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_nonces_nonce ON nonces(nonce);

-- audit_logs (APPEND-ONLY — UPDATE/DELETE revoked below)
CREATE TABLE IF NOT EXISTS audit_logs (
    id             VARCHAR(36) PRIMARY KEY,
    event_type     VARCHAR(64) NOT NULL,
    actor_id       VARCHAR(36)          DEFAULT NULL,
    transaction_id VARCHAR(36)          DEFAULT NULL,
    detail         TEXT                 DEFAULT NULL,
    ip_address     VARCHAR(45)          DEFAULT NULL,
    success        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_audit_actor_ts ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_tx       ON audit_logs(transaction_id);
CREATE INDEX IF NOT EXISTS ix_audit_event    ON audit_logs(event_type);

-- ── 3. Harden audit_logs (append-only enforcement) ───────────────────────────
-- App user physically cannot UPDATE or DELETE audit records
REVOKE UPDATE, DELETE ON audit_logs FROM txsign_user;

-- ── 4. Useful Views ───────────────────────────────────────────────────────────

-- Transaction summary with sender username
CREATE OR REPLACE VIEW v_transaction_summary AS
SELECT
    t.id                        AS transaction_id,
    u.username                  AS sender,
    t.receiver_id,
    t.amount,
    t.currency,
    t.status,
    t.payload_hash,
    t.timestamp                 AS tx_timestamp,
    t.created_at
FROM transactions t
JOIN users u ON u.id = t.sender_id;

-- Recent audit events (last 7 days)
CREATE OR REPLACE VIEW v_recent_audit AS
SELECT
    al.id,
    al.event_type,
    u.username                  AS actor,
    al.transaction_id,
    al.success,
    al.ip_address,
    al.created_at
FROM audit_logs al
LEFT JOIN users u ON u.id = al.actor_id
WHERE al.created_at >= NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;

-- ── 5. Verification ───────────────────────────────────────────────────────────
SELECT 'PostgreSQL setup complete!' AS status;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
