"""Shared asyncpg connection pool factory."""
import os
import asyncpg

_pool: asyncpg.Pool | None = None

DATABASE_URL = os.environ["DATABASE_URL"]


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def upsert_connectivity(
    ap_serial: str,
    switch_hostname: str,
    switch_port: str,
) -> None:
    """Insert or update a connectivity_matrix row."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO connectivity_matrix (ap_serial, switch_hostname, switch_port, last_updated)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (ap_serial) DO UPDATE SET
            switch_hostname = EXCLUDED.switch_hostname,
            switch_port     = EXCLUDED.switch_port,
            last_updated    = NOW()
        """,
        ap_serial,
        switch_hostname,
        switch_port,
    )


async def upsert_device(
    serial_number: str,
    hostname: str,
    ip_address: str,
    mac_address: str | None = None,
    device_type: str = "unknown",
    vendor: str = "unknown",
    model: str | None = None,
    firmware_version: str | None = None,
    zone_id: str | None = None,
    site_id: str = "default",
) -> None:
    """Insert or update a device record from MIST collector data."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO devices (serial_number, hostname, ip_address, mac_address,
                             device_type, vendor, model, firmware_version,
                             zone_id, site_id, status, last_seen)
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
        ON CONFLICT (serial_number) DO UPDATE SET
            hostname         = EXCLUDED.hostname,
            ip_address       = EXCLUDED.ip_address,
            mac_address      = COALESCE(EXCLUDED.mac_address, devices.mac_address),
            device_type      = CASE WHEN EXCLUDED.device_type = 'unknown'
                                    THEN devices.device_type
                                    ELSE EXCLUDED.device_type END,
            vendor           = CASE WHEN EXCLUDED.vendor = 'unknown'
                                    THEN devices.vendor
                                    ELSE EXCLUDED.vendor END,
            model            = COALESCE(EXCLUDED.model, devices.model),
            firmware_version = COALESCE(EXCLUDED.firmware_version, devices.firmware_version),
            zone_id          = COALESCE(EXCLUDED.zone_id, devices.zone_id),
            status           = 'active',
            last_seen        = NOW()
        """,
        serial_number,
        hostname,
        ip_address,
        mac_address,
        device_type,
        vendor,
        model,
        firmware_version,
        zone_id,
        site_id,
    )


async def insert_audit_log(
    event_type: str,
    severity: str,
    device_serial: str | None = None,
    message: str = "",
    source_service: str = "collector",
) -> None:
    """Write a row to the audit_logs table."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO audit_logs (event_type, severity, device_serial, message, source_service)
        VALUES ($1, $2, $3, $4, $5)
        """,
        event_type,
        severity,
        device_serial,
        message,
        source_service,
    )
