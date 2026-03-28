-- 006: Add unique constraint to vendor_endpoints (idempotent)
-- Prevents duplicate (vendor_config_id, name, path) combinations.

ALTER TABLE vendor_endpoints
    DROP CONSTRAINT IF EXISTS vendor_endpoints_vendor_config_id_name_path_key;

ALTER TABLE vendor_endpoints
    ADD CONSTRAINT vendor_endpoints_vendor_config_id_name_path_key
    UNIQUE (vendor_config_id, name, path);
