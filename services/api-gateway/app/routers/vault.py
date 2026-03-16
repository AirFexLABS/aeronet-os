"""
Vault router — encrypted credential management.
Sensitive values are NEVER returned in API responses.
All access is logged to vault_audit.
"""
import json
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..dependencies import get_current_user, require_role
from ..models.user import Role, TokenPayload
from ..models.vault import (
    CredentialType,
    VaultAuditEntry,
    VaultCreate,
    VaultEntry,
    VaultUpdate,
)
from .. import db, vault

router = APIRouter(tags=["vault"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")


async def _audit_log(
    vault_id: str | None,
    action: str,
    performed_by: str,
    ip_address: str,
    source_service: str | None = None,
):
    pool = await db.get_pool()
    await pool.execute(
        "INSERT INTO vault_audit (vault_id, action, performed_by, source_service, ip_address) "
        "VALUES ($1::uuid, $2, $3, $4, $5)",
        vault_id, action, performed_by, source_service, ip_address,
    )


def _row_to_entry(row) -> dict:
    """Convert a DB row to a VaultEntry-compatible dict. Never includes encrypted_value."""
    now = datetime.now(timezone.utc)
    expires_at = row["expires_at"]
    is_expired = expires_at is not None and expires_at < now
    return VaultEntry(
        id=str(row["id"]),
        name=row["name"],
        credential_type=row["credential_type"],
        scope=row["scope"],
        username=row["username"],
        metadata=json.loads(row["metadata"]) if isinstance(row["metadata"], str) else (row["metadata"] or {}),
        tags=list(row["tags"] or []),
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_used_at=row["last_used_at"],
        expires_at=expires_at,
        is_active=row["is_active"],
        is_expired=is_expired,
    ).model_dump(mode="json")


# ── GET /vault — list all vault entries (metadata only) ───────────────────────

@router.get("/vault")
async def list_vault(
    current_user: Annotated[TokenPayload, Depends(require_role(Role.OPERATOR))],
    type: Optional[CredentialType] = None,
    scope: Optional[str] = None,
    tag: Optional[str] = None,
    active: Optional[bool] = None,
):
    pool = await db.get_pool()
    conditions = []
    params = []
    idx = 1

    if type is not None:
        conditions.append(f"credential_type = ${idx}::credential_type")
        params.append(type.value)
        idx += 1
    if scope is not None:
        conditions.append(f"scope = ${idx}")
        params.append(scope)
        idx += 1
    if tag is not None:
        conditions.append(f"${idx} = ANY(tags)")
        params.append(tag)
        idx += 1
    if active is not None:
        conditions.append(f"is_active = ${idx}")
        params.append(active)
        idx += 1

    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    rows = await pool.fetch(
        f"SELECT id, name, credential_type, scope, username, metadata, tags, "
        f"created_by, created_at, updated_at, last_used_at, expires_at, is_active "
        f"FROM vault{where} ORDER BY created_at DESC",
        *params,
    )
    return [_row_to_entry(r) for r in rows]


# ── GET /vault/{id} — single entry metadata ──────────────────────────────────

@router.get("/vault/{entry_id}")
async def get_vault_entry(
    entry_id: str,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.OPERATOR))],
):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, credential_type, scope, username, metadata, tags, "
        "created_by, created_at, updated_at, last_used_at, expires_at, is_active "
        "FROM vault WHERE id = $1::uuid",
        entry_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Vault entry not found")
    return _row_to_entry(row)


# ── POST /vault — create new credential ──────────────────────────────────────

@router.post("/vault", status_code=status.HTTP_201_CREATED)
async def create_vault_entry(
    body: VaultCreate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.OPERATOR))],
):
    encrypted = vault.encrypt(body.secret_value)
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "INSERT INTO vault (name, credential_type, scope, username, encrypted_value, "
        "metadata, tags, created_by, expires_at) "
        "VALUES ($1, $2::credential_type, $3, $4, $5, $6::jsonb, $7, $8, $9) "
        "RETURNING id, name, credential_type, scope, username, metadata, tags, "
        "created_by, created_at, updated_at, last_used_at, expires_at, is_active",
        body.name,
        body.credential_type.value,
        body.scope,
        body.username,
        encrypted,
        json.dumps(body.metadata),
        body.tags,
        current_user.sub,
        body.expires_at,
    )
    await _audit_log(str(row["id"]), "created", current_user.sub, _client_ip(request))
    return _row_to_entry(row)


# ── PUT /vault/{id} — update entry ───────────────────────────────────────────

@router.put("/vault/{entry_id}")
async def update_vault_entry(
    entry_id: str,
    body: VaultUpdate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.OPERATOR))],
):
    pool = await db.get_pool()

    # Verify entry exists
    existing = await pool.fetchrow("SELECT id FROM vault WHERE id = $1::uuid", entry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Vault entry not found")

    fields = []
    values = []
    idx = 1

    updates = body.model_dump(exclude_none=True)
    if "secret_value" in updates:
        encrypted = vault.encrypt(updates.pop("secret_value"))
        fields.append(f"encrypted_value = ${idx}")
        values.append(encrypted)
        idx += 1

    for field, value in updates.items():
        if field == "metadata":
            fields.append(f"metadata = ${idx}::jsonb")
            values.append(json.dumps(value))
        elif field == "tags":
            fields.append(f"tags = ${idx}")
            values.append(value)
        else:
            fields.append(f"{field} = ${idx}")
            values.append(value)
        idx += 1

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")

    values.append(entry_id)
    query = (
        f"UPDATE vault SET {', '.join(fields)} WHERE id = ${idx}::uuid "
        f"RETURNING id, name, credential_type, scope, username, metadata, tags, "
        f"created_by, created_at, updated_at, last_used_at, expires_at, is_active"
    )
    row = await pool.fetchrow(query, *values)
    await _audit_log(entry_id, "updated", current_user.sub, _client_ip(request))
    return _row_to_entry(row)


# ── DELETE /vault/{id} — soft delete ──────────────────────────────────────────

@router.delete("/vault/{entry_id}")
async def delete_vault_entry(
    entry_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    result = await pool.execute(
        "UPDATE vault SET is_active = FALSE WHERE id = $1::uuid AND is_active = TRUE",
        entry_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Vault entry not found or already inactive")
    await _audit_log(entry_id, "deleted", current_user.sub, _client_ip(request))
    return {"status": "deleted", "id": entry_id}


# ── POST /vault/{id}/rotate — rotate credential value ────────────────────────

@router.post("/vault/{entry_id}/rotate")
async def rotate_vault_entry(
    entry_id: str,
    body: dict,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    new_secret = body.get("new_secret_value")
    if not new_secret or not new_secret.strip():
        raise HTTPException(status_code=422, detail="new_secret_value is required")

    pool = await db.get_pool()
    existing = await pool.fetchrow("SELECT id FROM vault WHERE id = $1::uuid", entry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Vault entry not found")

    encrypted = vault.encrypt(new_secret)
    row = await pool.fetchrow(
        "UPDATE vault SET encrypted_value = $1 WHERE id = $2::uuid "
        "RETURNING id, name, credential_type, scope, username, metadata, tags, "
        "created_by, created_at, updated_at, last_used_at, expires_at, is_active",
        encrypted, entry_id,
    )
    await _audit_log(entry_id, "rotated", current_user.sub, _client_ip(request))
    return _row_to_entry(row)


# ── POST /vault/{id}/use — decrypt and return value (internal) ────────────────

@router.post("/vault/{entry_id}/use")
async def use_vault_entry(
    entry_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT encrypted_value, username FROM vault WHERE id = $1::uuid AND is_active = TRUE",
        entry_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Vault entry not found or inactive")

    plaintext = vault.decrypt(row["encrypted_value"])

    # Update last_used_at
    await pool.execute(
        "UPDATE vault SET last_used_at = NOW() WHERE id = $1::uuid", entry_id
    )

    source_service = request.headers.get("x-source-service")
    await _audit_log(entry_id, "read", current_user.sub, _client_ip(request), source_service)

    return {"value": plaintext, "username": row["username"]}


# ── GET /vault/{id}/audit — audit trail for a credential ─────────────────────

@router.get("/vault/{entry_id}/audit")
async def get_vault_audit(
    entry_id: str,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vault_id::text, action, performed_by, source_service, "
        "ip_address, created_at FROM vault_audit "
        "WHERE vault_id = $1::uuid ORDER BY created_at DESC",
        entry_id,
    )
    return [
        VaultAuditEntry(
            id=r["id"],
            vault_id=r["vault_id"],
            action=r["action"],
            performed_by=r["performed_by"],
            source_service=r["source_service"],
            ip_address=r["ip_address"],
            created_at=r["created_at"],
        ).model_dump(mode="json")
        for r in rows
    ]


# ── GET /vault/audit/recent — last 100 audit events ──────────────────────────

@router.get("/vault/audit/recent")
async def get_recent_audit(
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
    limit: int = Query(default=100, le=500),
):
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vault_id::text, action, performed_by, source_service, "
        "ip_address, created_at FROM vault_audit "
        "ORDER BY created_at DESC LIMIT $1",
        limit,
    )
    return [
        VaultAuditEntry(
            id=r["id"],
            vault_id=r["vault_id"],
            action=r["action"],
            performed_by=r["performed_by"],
            source_service=r["source_service"],
            ip_address=r["ip_address"],
            created_at=r["created_at"],
        ).model_dump(mode="json")
        for r in rows
    ]
