-- ================================================================
--  Transaction Signing System — Complete MySQL Schema
--  Run as root:  mysql -u root -p < scripts/mysql_full.sql
-- ================================================================

-- ----------------------------------------------------------------
-- SECTION 1: Database & User
-- ----------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS txsign_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- Application user (change password in production)
CREATE USER IF NOT EXISTS 'txsign_user'@'localhost' IDENTIFIED BY 'txsign_pass';
CREATE USER IF NOT EXISTS 'txsign_user'@'%'         IDENTIFIED BY 'txsign_pass';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES
    ON txsign_db.* TO 'txsign_user'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES
    ON txsign_db.* TO 'txsign_user'@'%';

FLUSH PRIVILEGES;

USE txsign_db;

-- ----------------------------------------------------------------
-- SECTION 2: Tables
-- ----------------------------------------------------------------

-- ── users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id               VARCHAR(36)  NOT NULL,
    username         VARCHAR(64)  NOT NULL,
    email            VARCHAR(128) NOT NULL,
    hashed_password  VARCHAR(256) NOT NULL,
    is_active        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email    (email),
    KEY        ix_users_username (username)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='Registered users of the signing system';


-- ── keys ─────────────────────────────────────────────────────────
-- Stores ECDSA key pairs.
-- public_key_pem  : stored in plaintext (safe to expose)
-- encrypted_private_key : AES-256-GCM encrypted blob (never plaintext)
CREATE TABLE IF NOT EXISTS `keys` (
    id                    VARCHAR(36)  NOT NULL,
    user_id               VARCHAR(36)  NOT NULL,
    public_key_pem        MEDIUMTEXT   NOT NULL,
    encrypted_private_key MEDIUMTEXT   NOT NULL,
    algorithm             VARCHAR(16)  NOT NULL DEFAULT 'ECDSA-P256',
    is_active             TINYINT(1)   NOT NULL DEFAULT 1,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at            DATETIME              DEFAULT NULL,

    PRIMARY KEY (id),
    KEY ix_keys_user_id     (user_id),
    KEY ix_keys_user_active (user_id, is_active),

    CONSTRAINT fk_keys_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='ECDSA key pairs — private key is AES-256-GCM encrypted at rest';


-- ── transactions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id            VARCHAR(36)                                          NOT NULL,
    sender_id     VARCHAR(36)                                          NOT NULL,
    receiver_id   VARCHAR(128)                                         NOT NULL,
    amount        DOUBLE                                               NOT NULL,
    currency      VARCHAR(8)                                           NOT NULL DEFAULT 'USD',
    nonce         VARCHAR(64)                                          NOT NULL,
    `timestamp`   DATETIME                                             NOT NULL,
    payload_hash  VARCHAR(64)                                          NOT NULL  COMMENT 'SHA-256 hex of canonical payload',
    signature     MEDIUMTEXT                                           NOT NULL  COMMENT 'Base64 DER ECDSA signature',
    key_id        VARCHAR(36)                                          NOT NULL,
    status        ENUM('pending','verified','rejected','tampered')     NOT NULL DEFAULT 'pending',
    metadata_json MEDIUMTEXT                                           DEFAULT NULL,
    created_at    DATETIME                                             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tx_nonce      (nonce),
    KEY        ix_tx_sender_id  (sender_id),
    KEY        ix_tx_sender_ts  (sender_id, `timestamp`),
    KEY        ix_tx_status     (status),

    CONSTRAINT fk_tx_sender
        FOREIGN KEY (sender_id) REFERENCES users (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_tx_key
        FOREIGN KEY (key_id) REFERENCES `keys` (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='Signed financial transactions';


-- ── nonces ───────────────────────────────────────────────────────
-- Replay-attack prevention: every nonce is stored on first use.
-- A duplicate nonce = replay attack → reject immediately.
CREATE TABLE IF NOT EXISTS nonces (
    id         VARCHAR(36) NOT NULL,
    nonce      VARCHAR(64) NOT NULL,
    user_id    VARCHAR(36) NOT NULL,
    used_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME    NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_nonce    (nonce),
    KEY        ix_nonce    (nonce),
    KEY        ix_nonce_user (user_id),

    CONSTRAINT fk_nonce_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='Consumed nonces for replay-attack prevention';


-- ── audit_logs ───────────────────────────────────────────────────
-- APPEND-ONLY table. The application user has INSERT revoked for
-- UPDATE/DELETE after setup (see Section 3 below).
CREATE TABLE IF NOT EXISTS audit_logs (
    id             VARCHAR(36)  NOT NULL,
    event_type     VARCHAR(64)  NOT NULL  COMMENT 'e.g. TX_SIGNED, KEY_GENERATED',
    actor_id       VARCHAR(36)            DEFAULT NULL,
    transaction_id VARCHAR(36)            DEFAULT NULL,
    detail         MEDIUMTEXT             DEFAULT NULL  COMMENT 'JSON detail blob',
    ip_address     VARCHAR(45)            DEFAULT NULL,
    success        TINYINT(1)   NOT NULL  DEFAULT 1,
    created_at     DATETIME     NOT NULL  DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY ix_audit_created_at  (created_at),
    KEY ix_audit_actor_ts    (actor_id, created_at),
    KEY ix_audit_tx          (transaction_id),
    KEY ix_audit_event_type  (event_type)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='Immutable append-only audit trail';


-- ----------------------------------------------------------------
-- SECTION 3: Harden audit_logs (append-only enforcement)
-- Run this AFTER the app user has been granted CREATE above and
-- the tables exist. Revoke UPDATE + DELETE on audit_logs only.
-- ----------------------------------------------------------------

REVOKE UPDATE, DELETE ON txsign_db.audit_logs FROM 'txsign_user'@'localhost';
REVOKE UPDATE, DELETE ON txsign_db.audit_logs FROM 'txsign_user'@'%';
FLUSH PRIVILEGES;


-- ----------------------------------------------------------------
-- SECTION 4: Useful Views
-- ----------------------------------------------------------------

-- Transaction summary with sender username
CREATE OR REPLACE VIEW v_transaction_summary AS
SELECT
    t.id                                    AS transaction_id,
    u.username                              AS sender,
    t.receiver_id,
    t.amount,
    t.currency,
    t.status,
    t.payload_hash,
    LEFT(t.signature, 20)                   AS signature_preview,
    t.`timestamp`                           AS tx_timestamp,
    t.created_at
FROM transactions t
JOIN users u ON u.id = t.sender_id;


-- Recent audit events (last 7 days)
CREATE OR REPLACE VIEW v_recent_audit AS
SELECT
    al.id,
    al.event_type,
    u.username                              AS actor,
    al.transaction_id,
    al.success,
    al.ip_address,
    al.created_at
FROM audit_logs al
LEFT JOIN users u ON u.id = al.actor_id
WHERE al.created_at >= NOW() - INTERVAL 7 DAY
ORDER BY al.created_at DESC;


-- ----------------------------------------------------------------
-- SECTION 5: Sample Data (for testing / demo)
-- ----------------------------------------------------------------

-- Demo user (password = 'demo1234' bcrypt hash)
INSERT IGNORE INTO users (id, username, email, hashed_password, is_active, created_at)
VALUES (
    'usr-demo-0001-0000-0000-000000000001',
    'alice',
    'alice@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iK9i',
    1,
    NOW()
);

INSERT IGNORE INTO users (id, username, email, hashed_password, is_active, created_at)
VALUES (
    'usr-demo-0002-0000-0000-000000000002',
    'bob',
    'bob@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iK9i',
    1,
    NOW()
);


-- ----------------------------------------------------------------
-- SECTION 6: Verification Queries
-- ----------------------------------------------------------------

-- Show all tables
SHOW TABLES;

-- Row counts
SELECT 'users'       AS tbl, COUNT(*) AS rows FROM users
UNION ALL
SELECT 'keys',        COUNT(*) FROM `keys`
UNION ALL
SELECT 'transactions',COUNT(*) FROM transactions
UNION ALL
SELECT 'nonces',      COUNT(*) FROM nonces
UNION ALL
SELECT 'audit_logs',  COUNT(*) FROM audit_logs;

SELECT 'Schema setup complete!' AS status;
