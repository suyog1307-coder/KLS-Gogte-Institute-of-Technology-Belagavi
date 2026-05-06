-- ================================================================
-- Migration: Add face verification tables
-- Run: psql -U postgres -d txsign_db -f scripts/add_face_tables.sql
-- ================================================================

\c txsign_db

-- face_embeddings: stores FaceNet 128-d embeddings (NOT raw images)
CREATE TABLE IF NOT EXISTS face_embeddings (
    id         VARCHAR(36) PRIMARY KEY,
    user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    embedding  TEXT        NOT NULL,   -- JSON array of 128 floats
    model_name VARCHAR(32) NOT NULL DEFAULT 'Facenet',
    created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_face_user_id ON face_embeddings(user_id);

-- face_verification_attempts: rate limiting + audit trail
CREATE TABLE IF NOT EXISTS face_verification_attempts (
    id         VARCHAR(36)      PRIMARY KEY,
    user_id    VARCHAR(36)      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    success    BOOLEAN          NOT NULL,
    distance   DOUBLE PRECISION,
    ip_address VARCHAR(45),
    created_at TIMESTAMP        NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_face_attempt_user_ts
    ON face_verification_attempts(user_id, created_at);

-- Grant to app user
GRANT SELECT, INSERT, UPDATE, DELETE
    ON face_embeddings, face_verification_attempts
    TO txsign_user;

SELECT 'Face tables created successfully!' AS status;
