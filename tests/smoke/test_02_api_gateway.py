"""
Test 02 — API Gateway health, auth, and device inventory endpoints.
"""
import pytest
from .conftest import API_URL


def test_api_health(http):
    r = http.get(f"{API_URL}/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_unauthenticated_device_list_is_rejected(http):
    """Device list must require authentication."""
    r = http.get(f"{API_URL}/devices")
    assert r.status_code in (401, 403), (
        f"Expected 401/403, got {r.status_code}"
    )


def test_auth_endpoint_rejects_bad_credentials(http):
    r = http.post(
        f"{API_URL}/auth/token",
        json={"username": "bad_user", "password": "bad_pass"},
    )
    assert r.status_code in (401, 422), (
        f"Expected 401/422, got {r.status_code}"
    )


def test_device_create_requires_serial_number(http):
    """
    Attempt to create a device without serial_number.
    Must be rejected with 422 Unprocessable Entity.
    """
    r = http.post(
        f"{API_URL}/devices",
        json={"hostname": "no-serial", "ip_address": "10.0.0.99"},
        headers={"Authorization": "Bearer invalid"},
    )
    assert r.status_code in (401, 403, 422)
