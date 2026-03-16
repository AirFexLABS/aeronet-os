# Device inventory CRUD router
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..dependencies import get_current_user, require_permission, require_role
from ..models.device import DeviceCreate, DeviceUpdate, DeviceOut
from ..models.user import Role, TokenPayload
from .. import db

router = APIRouter()

ENROLLER_URL = os.getenv("ENROLLER_URL", "http://enroller:8002")


# ── GET /devices — list all devices (filtered by site_id for non-admin) ────
@router.get(
    "/devices",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def list_devices(
    current_user: Annotated[TokenPayload, Depends(get_current_user)],
):
    pool = await db.get_pool()
    if current_user.site_id is not None:
        rows = await pool.fetch(
            "SELECT serial_number, hostname, ip_address::text, device_type, "
            "site_id, status, last_seen::text FROM devices WHERE site_id = $1 "
            "ORDER BY serial_number",
            current_user.site_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT serial_number, hostname, ip_address::text, device_type, "
            "site_id, status, last_seen::text FROM devices ORDER BY serial_number"
        )
    return [dict(r) for r in rows]


# ── GET /devices/{serial} — single device detail ──────────────────────────
@router.get(
    "/devices/{serial}",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def get_device(
    serial: str,
    current_user: Annotated[TokenPayload, Depends(get_current_user)],
):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT serial_number, hostname, ip_address::text, device_type, "
        "site_id, status, last_seen::text FROM devices WHERE serial_number = $1",
        serial,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.site_id is not None and row["site_id"] != current_user.site_id:
        raise HTTPException(status_code=403, detail="Access denied for this site")
    return dict(row)


# ── POST /devices — create a new device ───────────────────────────────────
@router.post(
    "/devices",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("devices:write"))],
)
async def create_device(device: DeviceCreate):
    pool = await db.get_pool()
    try:
        await pool.execute(
            "INSERT INTO devices (serial_number, hostname, ip_address, device_type, "
            "site_id, status, last_seen) "
            "VALUES ($1, $2, $3::inet, $4, $5, $6, NOW())",
            device.serial_number,
            device.hostname,
            device.ip_address,
            device.device_type,
            device.site_id,
            device.status,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Device already exists or invalid data: {exc}")
    return {"serial_number": device.serial_number, "status": "created"}


# ── PUT /devices/{serial} — update device fields ──────────────────────────
@router.put(
    "/devices/{serial}",
    dependencies=[Depends(require_permission("devices:write"))],
)
async def update_device(serial: str, updates: DeviceUpdate):
    pool = await db.get_pool()
    fields = []
    values = []
    idx = 1
    for field, value in updates.model_dump(exclude_none=True).items():
        if field == "ip_address":
            fields.append(f"{field} = ${idx}::inet")
        else:
            fields.append(f"{field} = ${idx}")
        values.append(value)
        idx += 1
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")
    values.append(serial)
    query = f"UPDATE devices SET {', '.join(fields)}, last_seen = NOW() WHERE serial_number = ${idx}"
    result = await pool.execute(query, *values)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Device not found")
    return {"serial_number": serial, "status": "updated"}


# ── DELETE /devices/{serial} ──────────────────────────────────────────────
@router.delete(
    "/devices/{serial}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("devices:write"))],
)
async def delete_device(serial: str):
    pool = await db.get_pool()
    result = await pool.execute(
        "DELETE FROM devices WHERE serial_number = $1", serial
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Device not found")


# ── POST /discover — proxy network discovery to enroller ──────────────────
@router.post(
    "/discover",
    dependencies=[Depends(require_permission("scan:trigger"))],
)
async def proxy_discover(payload: dict):
    """Proxy network discovery scan to enroller service."""
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{ENROLLER_URL}/discover", json=payload)
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type="application/json",
    )


# ── GET /sites — proxy site list to enroller ──────────────────────────────
@router.get(
    "/sites",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def proxy_sites():
    """Proxy site list to enroller service."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{ENROLLER_URL}/sites")
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type="application/json",
    )


# ── POST /enroller/check — proxy to enroller service ──────────────────────
@router.post(
    "/enroller/check",
    dependencies=[Depends(require_permission("scan:trigger"))],
)
async def proxy_enroller_check(payload: dict):
    """
    Proxy route: forwards device discovery payload to the enroller service.
    Used by smoke tests and internal tooling.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{ENROLLER_URL}/check", json=payload)
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type="application/json",
    )


# ── GET /topology — connectivity_matrix joined with devices ─────────────
@router.get(
    "/topology",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def list_topology():
    pool = await db.get_pool()
    rows = await pool.fetch("""
        SELECT cm.ap_serial, d.hostname AS ap_hostname,
               d.ip_address::text AS ap_ip, d.site_id,
               cm.switch_hostname, cm.switch_port,
               cm.last_updated::text
        FROM connectivity_matrix cm
        JOIN devices d ON cm.ap_serial = d.serial_number
        ORDER BY d.site_id, cm.switch_hostname, cm.switch_port
    """)
    return [dict(r) for r in rows]


# ── GET /alerts — audit_logs newest first ───────────────────────────────
@router.get(
    "/alerts",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def list_alerts(limit: int = Query(default=200, le=1000)):
    pool = await db.get_pool()
    rows = await pool.fetch("""
        SELECT id, event_type, severity, device_serial,
               message, source_service, created_at::text
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT $1
    """, limit)
    return [dict(r) for r in rows]


# ── GET /dashboard/stats — four key metrics ─────────────────────────────
@router.get(
    "/dashboard/stats",
    dependencies=[Depends(require_permission("devices:read"))],
)
async def dashboard_stats():
    pool = await db.get_pool()
    total = await pool.fetchval(
        "SELECT COUNT(*) FROM devices WHERE status = 'active'"
    )
    offline = await pool.fetchval(
        "SELECT COUNT(*) FROM devices WHERE status = 'offline'"
    )
    moved = await pool.fetchval("""
        SELECT COUNT(*) FROM audit_logs
        WHERE event_type = 'ASSET_MOVED'
        AND created_at > NOW() - INTERVAL '24 hours'
    """)
    failures = await pool.fetchval("""
        SELECT COUNT(*) FROM audit_logs
        WHERE event_type = 'AUTH_FAILURE'
        AND created_at > NOW() - INTERVAL '24 hours'
    """)
    return {
        "total_devices": total,
        "offline_devices": offline,
        "asset_moved_24h": moved,
        "auth_failures_24h": failures,
    }
