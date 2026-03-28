-- 003: FACT CMDB Phase 1 — extend devices table, add change tracking and SLA
--
-- Columns vendor, device_type, status already exist on the devices table.
-- This migration adds: model, firmware_version, zone_id, sla_tier, location_lat, location_lng.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS model VARCHAR(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sla_tier VARCHAR(20) DEFAULT 'standard';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location_lat NUMERIC(10,7);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location_lng NUMERIC(10,7);

-- ── Device change log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_changes (
    id            SERIAL PRIMARY KEY,
    serial_number VARCHAR(100) REFERENCES devices(serial_number) ON DELETE CASCADE,
    changed_at    TIMESTAMPTZ DEFAULT NOW(),
    change_type   VARCHAR(50),
    old_value     TEXT,
    new_value     TEXT,
    detected_by   VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_device_changes_serial
    ON device_changes (serial_number, changed_at DESC);

-- ── Device SLA tracking ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_sla (
    serial_number         VARCHAR(100) PRIMARY KEY
                          REFERENCES devices(serial_number) ON DELETE CASCADE,
    uptime_target         NUMERIC(5,2) DEFAULT 99.9,
    measured_uptime       NUMERIC(5,2),
    measurement_period_days INTEGER DEFAULT 30,
    breach_count          INTEGER DEFAULT 0,
    last_calculated       TIMESTAMPTZ
);

-- ── Trigger: auto-log field changes on device update ─────────────────────

CREATE OR REPLACE FUNCTION log_device_changes() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.ip_address IS DISTINCT FROM NEW.ip_address THEN
        INSERT INTO device_changes(serial_number, change_type, old_value, new_value, detected_by)
        VALUES (NEW.serial_number, 'ip', OLD.ip_address::text, NEW.ip_address::text, 'trigger');
    END IF;
    IF OLD.firmware_version IS DISTINCT FROM NEW.firmware_version THEN
        INSERT INTO device_changes(serial_number, change_type, old_value, new_value, detected_by)
        VALUES (NEW.serial_number, 'firmware', OLD.firmware_version, NEW.firmware_version, 'trigger');
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO device_changes(serial_number, change_type, old_value, new_value, detected_by)
        VALUES (NEW.serial_number, 'status', OLD.status, NEW.status, 'trigger');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_changes ON devices;
CREATE TRIGGER trg_device_changes
    AFTER UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION log_device_changes();
