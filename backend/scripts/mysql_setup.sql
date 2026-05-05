-- ============================================================
-- MySQL Setup Script — Transaction Signing System
-- Run as root: mysql -u root -p < scripts/mysql_setup.sql
-- ============================================================

-- 1. Create database with full Unicode support
CREATE DATABASE IF NOT EXISTS txsign_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- 2. Create application user (change password before production!)
CREATE USER IF NOT EXISTS 'txsign_user'@'localhost' IDENTIFIED BY 'txsign_pass';
CREATE USER IF NOT EXISTS 'txsign_user'@'%'         IDENTIFIED BY 'txsign_pass';

-- 3. Grant only the permissions the app needs (principle of least privilege)
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER
    ON txsign_db.*
    TO 'txsign_user'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER
    ON txsign_db.*
    TO 'txsign_user'@'%';

-- 4. Harden audit_logs — revoke DELETE and UPDATE so it stays append-only
--    (run AFTER the app has created the tables via SQLAlchemy)
-- REVOKE DELETE, UPDATE ON txsign_db.audit_logs FROM 'txsign_user'@'localhost';
-- REVOKE DELETE, UPDATE ON txsign_db.audit_logs FROM 'txsign_user'@'%';

FLUSH PRIVILEGES;

SELECT 'MySQL setup complete. Database: txsign_db, User: txsign_user' AS status;
