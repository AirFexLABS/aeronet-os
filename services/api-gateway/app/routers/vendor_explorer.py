# Vendor API Explorer — config, endpoints, field mappings, execute
import json
import re
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel

from ..dependencies import require_role
from ..models.user import Role
from .. import db, vault

router = APIRouter(tags=["vendor-explorer"])


# ── Request / response models ────────────────────────────────────────────

class VendorConfigCreate(BaseModel):
    vendor: str
    display_name: str
    base_url: str
    auth_type: str
    credentials: dict


class EndpointCreate(BaseModel):
    name: str
    path: str
    method: str = "GET"
    description: str | None = None


class PollUpdate(BaseModel):
    poll_enabled: bool
    poll_interval_s: int = 300


class ExecuteBody(BaseModel):
    path_params: dict[str, str] | None = None


class FieldMappingCreate(BaseModel):
    json_path: str
    display_name: str
    cmdb_column: str | None = None
    grafana_label: str | None = None
    data_type: str = "string"


# ── Helpers ───────────────────────────────────────────────────────────────

def _flatten_json(obj: Any, prefix: str = "$") -> list[dict]:
    """Recursively flatten a JSON object into dot-notation paths with sample values."""
    fields: list[dict] = []

    if isinstance(obj, dict):
        for key, val in obj.items():
            path = f"{prefix}.{key}"
            if isinstance(val, dict):
                fields.extend(_flatten_json(val, path))
            elif isinstance(val, list):
                if val:
                    fields.extend(_flatten_json(val[0], f"{path}[0]"))
                else:
                    fields.append({"path": f"{path}[0]", "value": None, "type": "array"})
            else:
                fields.append({
                    "path": path,
                    "value": val,
                    "type": _detect_type(val),
                })
    elif isinstance(obj, list):
        if obj:
            fields.extend(_flatten_json(obj[0], f"{prefix}[0]"))
        else:
            fields.append({"path": f"{prefix}[0]", "value": None, "type": "array"})
    else:
        fields.append({"path": prefix, "value": obj, "type": _detect_type(obj)})

    return fields


def _detect_type(val: Any) -> str:
    if isinstance(val, bool):
        return "boolean"
    if isinstance(val, (int, float)):
        return "number"
    return "string"


def _build_auth_headers(auth_type: str, creds: dict) -> dict[str, str]:
    """Build HTTP auth headers from decrypted credentials."""
    if auth_type == "token":
        token = creds.get("token", "")
        # MIST uses "Token xxx" format
        if creds.get("org_id"):
            return {"Authorization": f"Token {token}"}
        return {"Authorization": f"Bearer {token}"}
    if auth_type == "basic":
        import base64
        pair = f"{creds.get('username', '')}:{creds.get('password', '')}"
        encoded = base64.b64encode(pair.encode()).decode()
        return {"Authorization": f"Basic {encoded}"}
    return {}


def _substitute_path_params(path: str, creds: dict) -> str:
    """Replace {org_id}, {site_id}, etc. in endpoint path from credentials."""
    for key, val in creds.items():
        path = path.replace(f"{{{key}}}", str(val))
    return path


# ── GET /vendor-configs ───────────────────────────────────────────────────

@router.get(
    "/vendor-configs",
    dependencies=[Depends(require_role(Role.OPERATOR))],
)
async def list_vendor_configs():
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vendor, display_name, base_url, auth_type, is_active, "
        "created_at::text, updated_at::text FROM vendor_configs ORDER BY id"
    )
    return [dict(r) for r in rows]


# ── POST /vendor-configs ─────────────────────────────────────────────────

@router.post(
    "/vendor-configs",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def create_vendor_config(body: VendorConfigCreate):
    encrypted = vault.encrypt(json.dumps(body.credentials))
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "INSERT INTO vendor_configs (vendor, display_name, base_url, auth_type, credentials) "
        "VALUES ($1, $2, $3, $4, $5) "
        "RETURNING id, vendor, display_name, base_url, auth_type, is_active, "
        "created_at::text, updated_at::text",
        body.vendor, body.display_name, body.base_url, body.auth_type, encrypted,
    )
    return dict(row)


# ── DELETE /vendor-configs/{id} ──────────────────────────────────────────

@router.delete(
    "/vendor-configs/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def delete_vendor_config(config_id: int):
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM vendor_configs WHERE id = $1", config_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Vendor config not found")


# ── GET /vendor-configs/{id}/test — test connectivity ────────────────────

@router.get(
    "/vendor-configs/{config_id}/test",
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def test_vendor_config(config_id: int):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT base_url, auth_type, credentials FROM vendor_configs WHERE id = $1",
        config_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Vendor config not found")

    creds = json.loads(vault.decrypt(row["credentials"]))
    headers = _build_auth_headers(row["auth_type"], creds)
    base_url = row["base_url"].rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(base_url, headers=headers)
        return {
            "status": resp.status_code,
            "ok": 200 <= resp.status_code < 400,
            "latency_ms": int(resp.elapsed.total_seconds() * 1000),
        }
    except httpx.HTTPError as exc:
        return {"status": 0, "ok": False, "error": str(exc), "latency_ms": None}


# ── GET /vendor-configs/{id}/endpoints ───────────────────────────────────

@router.get(
    "/vendor-configs/{config_id}/endpoints",
    dependencies=[Depends(require_role(Role.OPERATOR))],
)
async def list_vendor_endpoints(config_id: int):
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vendor_config_id, name, path, method, description, "
        "poll_enabled, poll_interval_s, last_polled::text, created_at::text "
        "FROM vendor_endpoints WHERE vendor_config_id = $1 ORDER BY id",
        config_id,
    )
    return [dict(r) for r in rows]


# ── POST /vendor-configs/{id}/endpoints ──────────────────────────────────

@router.post(
    "/vendor-configs/{config_id}/endpoints",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def create_vendor_endpoint(config_id: int, body: EndpointCreate):
    pool = await db.get_pool()
    exists = await pool.fetchval("SELECT 1 FROM vendor_configs WHERE id = $1", config_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Vendor config not found")
    row = await pool.fetchrow(
        "INSERT INTO vendor_endpoints (vendor_config_id, name, path, method, description) "
        "VALUES ($1, $2, $3, $4, $5) "
        "RETURNING id, vendor_config_id, name, path, method, description, "
        "poll_enabled, poll_interval_s, last_polled::text, created_at::text",
        config_id, body.name, body.path, body.method, body.description,
    )
    return dict(row)


# ── DELETE /vendor-endpoints/{id} ────────────────────────────────────────

@router.delete(
    "/vendor-endpoints/{endpoint_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def delete_vendor_endpoint(endpoint_id: int):
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM vendor_endpoints WHERE id = $1", endpoint_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Endpoint not found")


# ── POST /vendor-endpoints/{id}/execute — call vendor API ────────────────

@router.post(
    "/vendor-endpoints/{endpoint_id}/execute",
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def execute_vendor_endpoint(
    endpoint_id: int,
    body: ExecuteBody | None = Body(default=None),
):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT ve.path, ve.method, vc.base_url, vc.auth_type, vc.credentials "
        "FROM vendor_endpoints ve "
        "JOIN vendor_configs vc ON ve.vendor_config_id = vc.id "
        "WHERE ve.id = $1",
        endpoint_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    creds = json.loads(vault.decrypt(row["credentials"]))
    headers = _build_auth_headers(row["auth_type"], creds)
    base_url = row["base_url"].rstrip("/")

    # Merge: credentials provide defaults, body.path_params override
    merged_params = dict(creds)
    if body and body.path_params:
        merged_params.update(body.path_params)
    path = _substitute_path_params(row["path"], merged_params)
    url = f"{base_url}{path}"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if row["method"].upper() == "POST":
                resp = await client.post(url, headers=headers)
            else:
                resp = await client.get(url, headers=headers)

        if resp.status_code >= 400:
            return {
                "resolved_url": url,
                "error": f"HTTP {resp.status_code}",
                "body": resp.text[:2000],
                "raw": None,
                "fields": [],
            }

        raw = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Vendor API error: {exc}")
    except Exception:
        return {
            "resolved_url": url,
            "error": "Invalid JSON response",
            "raw": None,
            "fields": [],
        }

    # Update last_polled
    await pool.execute(
        "UPDATE vendor_endpoints SET last_polled = NOW() WHERE id = $1", endpoint_id
    )

    fields = _flatten_json(raw)
    return {"resolved_url": url, "raw": raw, "fields": fields}


# ── PUT /vendor-endpoints/{id}/poll — toggle polling ─────────────────────

@router.put(
    "/vendor-endpoints/{endpoint_id}/poll",
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def update_endpoint_poll(endpoint_id: int, body: PollUpdate):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "UPDATE vendor_endpoints SET poll_enabled = $1, poll_interval_s = $2 "
        "WHERE id = $3 "
        "RETURNING id, vendor_config_id, name, path, method, description, "
        "poll_enabled, poll_interval_s, last_polled::text, created_at::text",
        body.poll_enabled, body.poll_interval_s, endpoint_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    return dict(row)


# ── GET /vendor-endpoints/{id}/fields — list saved mappings ──────────────

@router.get(
    "/vendor-endpoints/{endpoint_id}/fields",
    dependencies=[Depends(require_role(Role.OPERATOR))],
)
async def list_field_mappings(endpoint_id: int):
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id, vendor_endpoint_id, json_path, display_name, cmdb_column, "
        "grafana_label, data_type, is_active, created_at::text "
        "FROM vendor_field_mappings WHERE vendor_endpoint_id = $1 ORDER BY id",
        endpoint_id,
    )
    return [dict(r) for r in rows]


# ── POST /vendor-endpoints/{id}/fields — save field mapping ──────────────

@router.post(
    "/vendor-endpoints/{endpoint_id}/fields",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def create_field_mapping(endpoint_id: int, body: FieldMappingCreate):
    pool = await db.get_pool()
    exists = await pool.fetchval("SELECT 1 FROM vendor_endpoints WHERE id = $1", endpoint_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    row = await pool.fetchrow(
        "INSERT INTO vendor_field_mappings "
        "(vendor_endpoint_id, json_path, display_name, cmdb_column, grafana_label, data_type) "
        "VALUES ($1, $2, $3, $4, $5, $6) "
        "RETURNING id, vendor_endpoint_id, json_path, display_name, cmdb_column, "
        "grafana_label, data_type, is_active, created_at::text",
        endpoint_id, body.json_path, body.display_name,
        body.cmdb_column, body.grafana_label, body.data_type,
    )
    return dict(row)


# ── DELETE /vendor-field-mappings/{id} ───────────────────────────────────

@router.delete(
    "/vendor-field-mappings/{mapping_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role(Role.ADMIN))],
)
async def delete_field_mapping(mapping_id: int):
    pool = await db.get_pool()
    result = await pool.execute("DELETE FROM vendor_field_mappings WHERE id = $1", mapping_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Field mapping not found")
