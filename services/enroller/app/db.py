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
        "SELECT serial_number, hostname, ip_address, device_type, site_id, status "
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
) -> None:
    """Insert or update a device record."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO devices (serial_number, hostname, ip_address, device_type, site_id, status, last_seen)
        VALUES ($1, $2, $3::inet, $4, $5, $6, NOW())
        ON CONFLICT (serial_number) DO UPDATE SET
            hostname   = EXCLUDED.hostname,
            ip_address = EXCLUDED.ip_address,
            status     = EXCLUDED.status,
            last_seen  = NOW()
        """,
        serial_number,
        hostname,
        ip_address,
        device_type,
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
