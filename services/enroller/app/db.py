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


async def get_device_by_serial(serial_number: str) -> asyncpg.Record | None:
    """Fetch a single device row by serial_number."""
    pool = await get_pool()
    return await pool.fetchrow(
        "SELECT serial_number, hostname, ip_address, mac_address, device_type, "
        "vendor, os_guess, site_id, status "
        "FROM devices WHERE serial_number = $1",
        serial_number,
    )


async def upsert_device(
    serial_number: str,
    hostname: str,
    ip_address: str,
    device_type: str = "unknown",
    site_id: str = "default",
    status: str = "active",
    mac_address: str | None = None,
    vendor: str = "unknown",
    os_guess: str = "unknown",
    confidence: int = 0,
) -> None:
    """Insert or update a device record."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO devices (serial_number, hostname, ip_address, mac_address,
                             device_type, vendor, os_guess, confidence,
                             site_id, status, last_seen)
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (serial_number) DO UPDATE SET
            hostname    = EXCLUDED.hostname,
            ip_address  = EXCLUDED.ip_address,
            mac_address = COALESCE(EXCLUDED.mac_address, devices.mac_address),
            device_type = CASE WHEN EXCLUDED.device_type = 'unknown'
                               THEN devices.device_type
                               ELSE EXCLUDED.device_type END,
            vendor      = CASE WHEN EXCLUDED.vendor = 'unknown'
                               THEN devices.vendor
                               ELSE EXCLUDED.vendor END,
            os_guess    = CASE WHEN EXCLUDED.os_guess = 'unknown'
                               THEN devices.os_guess
                               ELSE EXCLUDED.os_guess END,
            confidence  = GREATEST(EXCLUDED.confidence, devices.confidence),
            status      = EXCLUDED.status,
            last_seen   = NOW()
        """,
        serial_number,
        hostname,
        ip_address,
        mac_address,
        device_type,
        vendor,
        os_guess,
        confidence,
        site_id,
        status,
    )


async def insert_audit_log(
    event_type: str,
    severity: str,
    device_serial: str,
    message: str,
    source_service: str = "enroller",
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
