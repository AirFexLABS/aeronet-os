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
