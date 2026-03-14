"""
Test 13 — Frontend UI and API route validation.
Validates: all pages serve index.html (SPA routing), new API routes respond,
           dashboard stats shape, topology and alerts endpoints.
"""
import os
import pytest
import httpx

FRONTEND_URL = os.getenv("TEST_FRONTEND_URL", "http://localhost:5173")
API_URL = os.getenv("TEST_API_URL", "http://localhost:8000")


@pytest.fixture(scope="module")
def authed(http):
    """Returns auth header dict using superadmin credentials."""
    r = http.post(
        f"{API_URL}/auth/token",
        data={
            "username": os.getenv("CI_SUPERADMIN_USER", "superadmin"),
            "password": os.getenv("CI_SUPERADMIN_PASSWORD", ""),
        },
    )
    if r.status_code != 200:
        pytest.skip("Superadmin credentials not configured")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.parametrize(
    "path", ["/", "/devices", "/devices/any-serial", "/topology", "/alerts"]
)
def test_spa_routes_serve_index(http, path):
    r = http.get(f"{FRONTEND_URL}{path}")
    assert r.status_code == 200
    assert '<div id="root">' in r.text


def test_dashboard_stats_shape(http, authed):
    r = http.get(f"{API_URL}/dashboard/stats", headers=authed)
    assert r.status_code == 200
    data = r.json()
    for key in [
        "total_devices",
        "offline_devices",
        "asset_moved_24h",
        "auth_failures_24h",
    ]:
        assert key in data, f"Missing key: {key}"
        assert isinstance(data[key], int)


def test_topology_endpoint_returns_list(http, authed):
    r = http.get(f"{API_URL}/topology", headers=authed)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_alerts_endpoint_returns_list(http, authed):
    r = http.get(f"{API_URL}/alerts?limit=10", headers=authed)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        for key in [
            "id",
            "event_type",
            "severity",
            "device_serial",
            "message",
            "source_service",
            "created_at",
        ]:
            assert key in row, f"Missing field: {key}"


def test_devices_endpoint_returns_list(http, authed):
    r = http.get(f"{API_URL}/devices", headers=authed)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
