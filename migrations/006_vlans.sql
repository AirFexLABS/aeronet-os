CREATE TABLE vlans (
    id            SERIAL PRIMARY KEY,
    vlan_id       INTEGER UNIQUE NOT NULL,
    name          VARCHAR(64) NOT NULL,
    cidr          CIDR NOT NULL,
    gateway       INET,
    interface     VARCHAR(32) NOT NULL,
    scan_enabled  BOOLEAN DEFAULT true,
    status        VARCHAR(16) DEFAULT 'pending'
                  CHECK (status IN ('pending','active','error','disabled')),
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER vlans_updated_at
    BEFORE UPDATE ON vlans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit log on VLAN changes
CREATE OR REPLACE FUNCTION log_vlan_change() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (event_type, severity, message, source_service)
    VALUES (
        TG_OP || '_VLAN',
        'INFO',
        'VLAN ' || COALESCE(NEW.vlan_id::text, OLD.vlan_id::text) ||
        ' (' || COALESCE(NEW.name, OLD.name) || ') ' || TG_OP,
        'api-gateway'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vlans_audit
    AFTER INSERT OR UPDATE OR DELETE ON vlans
    FOR EACH ROW EXECUTE FUNCTION log_vlan_change();

-- Seed VLAN 4 as active (sandbox segment, standard for all new deployments)
INSERT INTO vlans (vlan_id, name, cidr, gateway, interface, scan_enabled, status, notes)
VALUES (
    4,
    'sandbox',
    '192.168.1.0/24',
    '192.168.1.1',
    'INSIDE.4',
    true,
    'active',
    'Standard sandbox VLAN used during initial setup and testing. Connected to a dummy switch. Present in all AeroNet deployments.'
);
