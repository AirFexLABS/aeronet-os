-- Migration 004: Alert contacts and per-contact notification channels
-- Apply: docker exec -i aeronet-postgres psql -U aeronet -d aeronet < migrations/004_alert_contacts.sql

CREATE TABLE IF NOT EXISTS alert_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_contact_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID NOT NULL REFERENCES alert_contacts(id) ON DELETE CASCADE,
    channel_type    TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'telegram')),
    recipient_value TEXT NOT NULL,   -- Fernet-encrypted PII
    whatsapp_use_separate_sender BOOLEAN DEFAULT FALSE,
    whatsapp_sender_number       TEXT,  -- Fernet-encrypted, nullable
    min_severity    TEXT NOT NULL DEFAULT 'WARNING' CHECK (min_severity IN ('INFO', 'WARNING', 'CRITICAL')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, channel_type)
);

-- Auto-update updated_at (reuse function if exists from init.sql)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_contacts_updated_at
    BEFORE UPDATE ON alert_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER alert_contact_channels_updated_at
    BEFORE UPDATE ON alert_contact_channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
