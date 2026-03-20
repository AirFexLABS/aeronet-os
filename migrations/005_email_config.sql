-- Migration 005: SMTP email configuration (singleton row)
-- Apply: docker exec -i aeronet-postgres psql -U aeronet -d aeronet < migrations/005_email_config.sql

CREATE TABLE IF NOT EXISTS email_config (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
    smtp_host       TEXT NOT NULL DEFAULT '',
    smtp_port       INTEGER NOT NULL DEFAULT 587,
    smtp_username   TEXT NOT NULL DEFAULT '',       -- Fernet-encrypted
    smtp_password   TEXT NOT NULL DEFAULT '',       -- Fernet-encrypted
    from_address    TEXT NOT NULL DEFAULT '',
    from_name       TEXT NOT NULL DEFAULT 'AeroNet OS',
    use_tls         BOOLEAN NOT NULL DEFAULT TRUE,
    is_configured   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the singleton row
INSERT INTO email_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TRIGGER email_config_updated_at
    BEFORE UPDATE ON email_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
