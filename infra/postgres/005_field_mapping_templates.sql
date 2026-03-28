-- 005: Field Mapping Templates
-- Reusable sets of field mappings that can be applied to any vendor endpoint.
-- Idempotent: safe to re-run.

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_mapping_templates (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    vendor          TEXT NOT NULL,                -- e.g. 'juniper_mist'
    scope           TEXT NOT NULL DEFAULT 'vendor', -- 'vendor' | 'site_group'
    site_group_id   TEXT,                         -- optional site-group filter
    created_by      TEXT NOT NULL DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_field_mappings (
    id              SERIAL PRIMARY KEY,
    template_id     INTEGER NOT NULL REFERENCES field_mapping_templates(id) ON DELETE CASCADE,
    json_path       TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    cmdb_column     TEXT,
    grafana_label   TEXT,
    data_type       TEXT NOT NULL DEFAULT 'string',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Seed: MIST AP + Switch CMDB Template ────────────────────────────────

DO $$
DECLARE
    tpl_id INTEGER;
BEGIN
    -- Only insert if template doesn't already exist
    SELECT id INTO tpl_id FROM field_mapping_templates
     WHERE name = 'MIST AP + Switch CMDB Template' LIMIT 1;

    IF tpl_id IS NULL THEN
        INSERT INTO field_mapping_templates (name, description, vendor, scope, created_by)
        VALUES (
            'MIST AP + Switch CMDB Template',
            'Maps MIST AP stats (including LLDP switch data) to CMDB columns and Grafana labels',
            'juniper_mist',
            'vendor',
            'system'
        )
        RETURNING id INTO tpl_id;

        INSERT INTO template_field_mappings
            (template_id, json_path, display_name, cmdb_column, grafana_label, data_type)
        VALUES
            (tpl_id, '$[0].name',               'AP Name',              'hostname',        'ap_name',          'string'),
            (tpl_id, '$[0].mac',                'AP MAC',               'mac_address',     'ap_mac',           'string'),
            (tpl_id, '$[0].serial',             'AP Serial',            'serial_number',   'ap_serial',        'string'),
            (tpl_id, '$[0].model',              'AP Model',             'model',           'ap_model',         'string'),
            (tpl_id, '$[0].ip',                 'AP IP',                'ip_address',      'ap_ip',            'string'),
            (tpl_id, '$[0].status',             'AP Status',            'status',          'ap_status',        'string'),
            (tpl_id, '$[0].uptime',             'Uptime (s)',           NULL,              'ap_uptime',        'number'),
            (tpl_id, '$[0].num_clients',        'Client Count',         NULL,              'ap_clients',       'number'),
            (tpl_id, '$[0].cpu_util',           'CPU %',                NULL,              'ap_cpu',           'number'),
            (tpl_id, '$[0].mem_total_kb',       'Memory Total KB',      NULL,              'ap_mem_total',     'number'),
            (tpl_id, '$[0].mem_used_kb',        'Memory Used KB',       NULL,              'ap_mem_used',      'number'),
            (tpl_id, '$[0].lldp_stat.system_name',         'Switch Hostname',   'switch_hostname',  'sw_hostname',  'string'),
            (tpl_id, '$[0].lldp_stat.port_id',             'Switch Port',       'switch_port',      'sw_port',      'string'),
            (tpl_id, '$[0].lldp_stat.port_desc',           'Switch Port Desc',  NULL,               'sw_port_desc', 'string'),
            (tpl_id, '$[0].lldp_stat.system_desc',         'Switch Model/OS',   NULL,               'sw_model',     'string'),
            (tpl_id, '$[0].lldp_stat.mgmt_addr',           'Switch Mgmt IP',    'switch_ip',        'sw_mgmt_ip',   'string'),
            (tpl_id, '$[0].lldp_stat.chassis_id',          'Switch Chassis ID', NULL,               'sw_chassis',   'string'),
            (tpl_id, '$[0].radio_stat[0].band',            'Radio Band',        NULL,               'radio_band',   'string'),
            (tpl_id, '$[0].radio_stat[0].channel',         'Radio Channel',     NULL,               'radio_channel','number'),
            (tpl_id, '$[0].radio_stat[0].power',           'Tx Power',          NULL,               'radio_power',  'number'),
            (tpl_id, '$[0].radio_stat[0].num_clients',     'Radio Clients',     NULL,               'radio_clients','number'),
            (tpl_id, '$[0].radio_stat[0].noise_floor',     'Noise Floor',       NULL,               'noise_floor',  'number'),
            (tpl_id, '$[0].port_stat.eth0.speed',          'Eth0 Speed',        NULL,               'eth0_speed',   'number'),
            (tpl_id, '$[0].port_stat.eth0.up',             'Eth0 Link Up',      NULL,               'eth0_up',      'boolean'),
            (tpl_id, '$[0].ext_ip',             'External IP',          NULL,              'ext_ip',           'string'),
            (tpl_id, '$[0].version',            'Firmware Version',     'firmware_version','fw_version',       'string');
    END IF;
END $$;
