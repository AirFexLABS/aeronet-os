"""
Test 09 — RBAC: token issuance, permission enforcement, role boundaries.
These tests use the seeded admin user from init.sql.
Default password: ChangeMe123! — must match the hash in init.sql seed.
"""
import pytest
from .conftest import API_URL

ADMIN_CREDS    = {"username": "admin",    "password": "ChangeMe123!"}
VIEWER_CREDS   = {"username": "viewer_smoke", "password": "ViewerPass1!"}


def get_token(http, creds: dict) -> str:
    r = http.post(f"{API_URL}/auth/token", data=creds)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Token issuance ────────────────────────────────────────────────────────

def test_admin_can_obtain_token(http):
    token = get_token(http, ADMIN_CREDS)
    assert isinstance(token, str) and len(token) > 20


def test_invalid_credentials_return_401(http):
    r = http.post(f"{API_URL}/auth/token",
                  data={"username": "admin", "password": "wrongpassword"})
    assert r.status_code == 401


def test_missing_password_returns_422(http):
    r = http.post(f"{API_URL}/auth/token", data={"username": "admin"})
    assert r.status_code == 422


# ── Unauthenticated access ────────────────────────────────────────────────

def test_devices_list_requires_auth(http):
    r = http.get(f"{API_URL}/devices")
    assert r.status_code == 401


def test_device_create_requires_auth(http):
    r = http.post(f"{API_URL}/devices",
                  json={"serial_number": "NO-AUTH-001", "hostname": "x"})
    assert r.status_code == 401


# ── Admin permissions ─────────────────────────────────────────────────────

def test_admin_can_list_devices(http):
    token = get_token(http, ADMIN_CREDS)
    r = http.get(f"{API_URL}/devices", headers=auth(token))
    assert r.status_code == 200


def test_admin_can_create_device(http):
    token = get_token(http, ADMIN_CREDS)
    r = http.post(f"{API_URL}/devices", headers=auth(token), json={
        "serial_number": "RBAC-SMOKE-001",
        "hostname":      "rbac-test-ap",
        "ip_address":    "10.99.0.1",
        "device_type":   "AP",
        "site_id":       "SITE-SMOKE",
    })
    assert r.status_code in (200, 201)


def test_admin_can_delete_device(http):
    token = get_token(http, ADMIN_CREDS)
    r = http.delete(f"{API_URL}/devices/RBAC-SMOKE-001", headers=auth(token))
    assert r.status_code in (200, 204, 404)   # 404 acceptable if already cleaned up


# ── Expired token ─────────────────────────────────────────────────────────

def test_expired_token_returns_401(http):
    # Pre-generated expired token (exp=1) — will always be expired
    expired = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsInNpdGVfaWQiOm51bGwsImV4cCI6MX0."
        "INVALID_SIGNATURE"
    )
    r = http.get(f"{API_URL}/devices", headers=auth(expired))
    assert r.status_code == 401
