# VLAN segment CRUD router
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..dependencies import get_current_user, require_role
from ..models.user import Role, TokenPayload
from .. import db

router = APIRouter(tags=["vlans"])


# ── Request / response models ────────────────────────────────────────────

class VlanCreate(BaseModel):
    vlan_id: int
    name: str
    cidr: str
    gateway: str | None = None
    interface: str
    scan_enabled: bool = True
    notes: str | None = None


class VlanUpdate(BaseModel):
    name: str | None = None
    cidr: str | None = None
    gateway: str | None = None
    interface: str | None = None
    scan_enabled: bool | None = None
    notes: str | None = None


class StatusPatch(BaseModel):
    status: str


# ── GET /vlans — list all VLANs ──────────────────────────────────────────

@router.get(
    "/vlans",
    dependencies=[Depends(require_role(Role.ENGINEER))],
)
async def list_vlans():
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vlan_id, name, cidr::text, gateway::text, interface, "
        "scan_enabled, status, notes, created_at::text, updated_at::text "
        "FROM vlans ORDER BY vlan_id"
    )
    return [dict(r) for r in rows]


# ── POST /vlans — create a new VLAN ──────────────────────────────────────

@router.post(
    "/vlans",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def create_vlan(body: VlanCreate):
    pool = await db.get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO vlans (vlan_id, name, cidr, gateway, interface, scan_enabled, notes) "
            "VALUES ($1, $2, $3::cidr, $4::inet, $5, $6, $7) "
            "RETURNING id, vlan_id, name, cidr::text, gateway::text, interface, "
            "scan_enabled, status, notes, created_at::text, updated_at::text",
            body.vlan_id, body.name, body.cidr, body.gateway,
            body.interface, body.scan_enabled, body.notes,
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"VLAN {body.vlan_id} already exists",
            )
        raise
    return dict(row)


# ── PUT /vlans/{id} — update a VLAN ──────────────────────────────────────

@router.put(
    "/vlans/{vlan_pk}",
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def update_vlan(vlan_pk: int, body: VlanUpdate):
    pool = await db.get_pool()

    # Build SET clause dynamically from non-None fields
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields to update",
        )

    set_parts = []
    values = []
    idx = 1
    for col, val in updates.items():
        cast = "::cidr" if col == "cidr" else ("::inet" if col == "gateway" else "")
        set_parts.append(f"{col} = ${idx}{cast}")
        values.append(val)
        idx += 1
    values.append(vlan_pk)

    row = await pool.fetchrow(
        f"UPDATE vlans SET {', '.join(set_parts)} "
        f"WHERE id = ${idx} "
        "RETURNING id, vlan_id, name, cidr::text, gateway::text, interface, "
        "scan_enabled, status, notes, created_at::text, updated_at::text",
        *values,
    )
    if not row:
        raise HTTPException(status_code=404, detail="VLAN not found")
    return dict(row)


# ── PATCH /vlans/{id}/status — change VLAN status ────────────────────────

@router.patch(
    "/vlans/{vlan_pk}/status",
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def patch_vlan_status(vlan_pk: int, body: StatusPatch):
    allowed = {"pending", "active", "error", "disabled"}
    if body.status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(allowed))}",
        )

    pool = await db.get_pool()
    row = await pool.fetchrow(
        "UPDATE vlans SET status = $1 WHERE id = $2 "
        "RETURNING id, vlan_id, name, cidr::text, gateway::text, interface, "
        "scan_enabled, status, notes, created_at::text, updated_at::text",
        body.status, vlan_pk,
    )
    if not row:
        raise HTTPException(status_code=404, detail="VLAN not found")
    return dict(row)
