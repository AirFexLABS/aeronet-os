-- 004b: Predefined vendor endpoint definitions (no credentials)
-- These are inserted only if vendor_configs rows exist for each vendor.
-- Operators create the vendor_config first, then these seeds are available
-- as templates they can add via the UI.
--
-- This file is idempotent: run it any time to ensure seed data exists.

-- ── Helper: insert endpoint only if it doesn't already exist ────────────
-- We use a DO block per vendor to check for a config row.

-- ── Juniper MIST endpoints (template, attached to config id=1 if exists) ─
DO $$
DECLARE
    cfg_id INTEGER;
BEGIN
    SELECT id INTO cfg_id FROM vendor_configs WHERE vendor = 'juniper_mist' LIMIT 1;
    IF cfg_id IS NOT NULL THEN
        INSERT INTO vendor_endpoints (vendor_config_id, name, method, path, description)
        VALUES
            (cfg_id, 'List Sites',       'GET', '/api/v1/orgs/{org_id}/sites', 'List all sites in the organization'),
            (cfg_id, 'List APs',         'GET', '/api/v1/sites/{site_id}/devices?type=ap', 'List access points at a site'),
            (cfg_id, 'AP Stats',         'GET', '/api/v1/sites/{site_id}/stats/devices?type=ap', 'AP statistics including uptime and clients'),
            (cfg_id, 'Switch Ports',     'GET', '/api/v1/sites/{site_id}/stats/ports', 'Switch port statistics'),
            (cfg_id, 'AP Location',      'GET', '/api/v1/sites/{site_id}/stats/maps', 'AP location map data'),
            (cfg_id, 'Org Inventory',    'GET', '/api/v1/orgs/{org_id}/inventory', 'Full hardware inventory for the org'),
            (cfg_id, 'Site WLANs',       'GET', '/api/v1/sites/{site_id}/wlans', 'WLAN configurations at a site'),
            (cfg_id, 'Client Sessions',  'GET', '/api/v1/sites/{site_id}/stats/clients', 'Connected client session stats'),
            (cfg_id, 'AP Stats with Switch Info', 'GET', '/api/v1/sites/{site_id}/stats/devices?type=ap', 'Live AP operational stats including connected switch LLDP data, client counts, radio stats, uptime, CPU, memory, port stats')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ── Fortinet FortiManager endpoints ──────────────────────────────────────
DO $$
DECLARE
    cfg_id INTEGER;
BEGIN
    SELECT id INTO cfg_id FROM vendor_configs WHERE vendor = 'fortinet' LIMIT 1;
    IF cfg_id IS NOT NULL THEN
        INSERT INTO vendor_endpoints (vendor_config_id, name, method, path, description)
        VALUES
            (cfg_id, 'List Devices',  'GET', '/dvmdb/adom/root/device', 'List managed devices'),
            (cfg_id, 'Device Status', 'GET', '/sys/status', 'System status overview')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ── Cisco Catalyst Center endpoints ──────────────────────────────────────
DO $$
DECLARE
    cfg_id INTEGER;
BEGIN
    SELECT id INTO cfg_id FROM vendor_configs WHERE vendor = 'cisco' LIMIT 1;
    IF cfg_id IS NOT NULL THEN
        INSERT INTO vendor_endpoints (vendor_config_id, name, method, path, description)
        VALUES
            (cfg_id, 'List Devices',  'GET', '/dna/intent/api/v1/network-device', 'List all network devices'),
            (cfg_id, 'Device Health', 'GET', '/dna/intent/api/v1/device-health', 'Device health summary')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ── Ruckus SmartZone endpoints ───────────────────────────────────────────
DO $$
DECLARE
    cfg_id INTEGER;
BEGIN
    SELECT id INTO cfg_id FROM vendor_configs WHERE vendor = 'ruckus' LIMIT 1;
    IF cfg_id IS NOT NULL THEN
        INSERT INTO vendor_endpoints (vendor_config_id, name, method, path, description)
        VALUES
            (cfg_id, 'List APs',              'GET', '/v11_1/aps', 'List all access points'),
            (cfg_id, 'AP Operational Status',  'GET', '/v11_1/aps/{apMac}/operational', 'Single AP operational status')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
