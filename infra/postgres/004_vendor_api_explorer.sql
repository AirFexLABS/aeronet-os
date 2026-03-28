-- 004: Vendor API Explorer — config, endpoints, field mappings

CREATE TABLE IF NOT EXISTS vendor_configs (
    id            SERIAL PRIMARY KEY,
    vendor        VARCHAR(50) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    base_url      VARCHAR(500) NOT NULL,
    auth_type     VARCHAR(20) NOT NULL,
    credentials   TEXT NOT NULL,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_endpoints (
    id               SERIAL PRIMARY KEY,
    vendor_config_id INTEGER REFERENCES vendor_configs(id) ON DELETE CASCADE,
    name             VARCHAR(100) NOT NULL,
    path             VARCHAR(500) NOT NULL,
    method           VARCHAR(10) DEFAULT 'GET',
    description      TEXT,
    poll_enabled     BOOLEAN DEFAULT false,
    poll_interval_s  INTEGER DEFAULT 300,
    last_polled      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (vendor_config_id, name, path)
);

CREATE TABLE IF NOT EXISTS vendor_field_mappings (
    id                  SERIAL PRIMARY KEY,
    vendor_endpoint_id  INTEGER REFERENCES vendor_endpoints(id) ON DELETE CASCADE,
    json_path           VARCHAR(500) NOT NULL,
    display_name        VARCHAR(100) NOT NULL,
    cmdb_column         VARCHAR(100),
    grafana_label       VARCHAR(100),
    data_type           VARCHAR(20) DEFAULT 'string',
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_endpoints_config
    ON vendor_endpoints (vendor_config_id);
CREATE INDEX IF NOT EXISTS idx_vendor_field_mappings_endpoint
    ON vendor_field_mappings (vendor_endpoint_id);
