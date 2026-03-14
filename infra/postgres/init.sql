-- PostgreSQL initialization: device inventory schema for AeroNet OS

-- =============================================================================
-- Table: devices
-- Primary device inventory, keyed by serial_number
-- =============================================================================
CREATE TABLE devices (
    serial_number VARCHAR(64) PRIMARY KEY,
    hostname      VARCHAR(255) NOT NULL,
    ip_address    INET NOT NULL,
    device_type   VARCHAR(64) NOT NULL,
    site_id       VARCHAR(64) NOT NULL,
    status        VARCHAR(32) NOT NULL DEFAULT 'unknown',
    last_seen     TIMESTAMPTZ
);

CREATE INDEX idx_devices_ip_address ON devices (ip_address);
CREATE INDEX idx_devices_site_id    ON devices (site_id);

-- =============================================================================
-- Table: connectivity_matrix
-- AP-to-switch port mapping from LLDP data
-- =============================================================================
CREATE TABLE connectivity_matrix (
    ap_serial       VARCHAR(64) NOT NULL REFERENCES devices(serial_number) ON DELETE CASCADE,
    switch_hostname VARCHAR(255) NOT NULL,
    switch_port     VARCHAR(64) NOT NULL,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ap_serial)
);

-- =============================================================================
-- Table: credentials
-- Per-device SSH/API credentials (passwords stored encrypted at app layer)
-- =============================================================================
CREATE TABLE credentials (
    device_serial      VARCHAR(64) NOT NULL REFERENCES devices(serial_number) ON DELETE CASCADE,
    username           VARCHAR(128) NOT NULL,
    encrypted_password TEXT NOT NULL,
    key_id             VARCHAR(128),
    PRIMARY KEY (device_serial, username)
);

-- =============================================================================
-- Table: audit_logs
-- Immutable event log for compliance and debugging
-- =============================================================================
CREATE TABLE audit_logs (
    id              SERIAL PRIMARY KEY,
    event_type      VARCHAR(64) NOT NULL,
    severity        VARCHAR(16) NOT NULL DEFAULT 'INFO',
    device_serial   VARCHAR(64),
    message         TEXT,
    source_service  VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_event_type   ON audit_logs (event_type);
CREATE INDEX idx_audit_logs_device_serial ON audit_logs (device_serial);
CREATE INDEX idx_audit_logs_created_at    ON audit_logs (created_at);

-- =============================================================================
-- Trigger: log IP address changes to audit_logs
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_audit_ip_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.ip_address IS DISTINCT FROM NEW.ip_address THEN
        INSERT INTO audit_logs (event_type, severity, device_serial, message, source_service)
        VALUES (
            'IP_CHANGE',
            'WARNING',
            NEW.serial_number,
            FORMAT('IP changed from %s to %s', OLD.ip_address, NEW.ip_address),
            'postgres_trigger'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_devices_ip_change
    BEFORE UPDATE ON devices
    FOR EACH ROW
    WHEN (OLD.ip_address IS DISTINCT FROM NEW.ip_address)
    EXECUTE FUNCTION fn_audit_ip_change();

-- =============================================================================
-- Table: users
-- RBAC user accounts — passwords stored as bcrypt hashes, never plaintext.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    username        VARCHAR(64) PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'viewer'
                        CHECK (role IN ('viewer','operator','engineer','admin')),
    hashed_password TEXT NOT NULL,
    site_id         VARCHAR(64),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for auth lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Trigger: auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_users_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_users_timestamp();

-- =============================================================================
-- Seed: default admin user
-- ⚠️  WARNING: The placeholder hash below MUST be replaced before first
-- production deployment. Generate a real bcrypt hash by running:
--
--   python -c "from passlib.context import CryptContext; \
--     print(CryptContext(schemes=['bcrypt']).hash('ChangeMe123!'))"
--
-- Then replace the value in the INSERT below.
-- Default password for dev/smoke tests: ChangeMe123!
-- =============================================================================
INSERT INTO users (username, email, role, hashed_password)
VALUES (
    'admin',
    'admin@aeronet.local',
    'admin',
    '$2b$12$PLACEHOLDER_REPLACE_BEFORE_PRODUCTION'
)
ON CONFLICT (username) DO NOTHING;
