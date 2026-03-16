"""
Test 15 — Network Discovery endpoint and UI.
"""
import os
import pytest

API_URL = os.getenv("TEST_API_URL", "http://localhost:8000")
FRONTEND_URL = os.getenv("TEST_FRONTEND_URL", "http://localhost:5173")


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


def test_discover_endpoint_exists(http, authed):
    """POST /discover must accept a CIDR payload."""
    r = http.post(
        f"{API_URL}/discover",
        headers=authed,
        json={"cidr": "127.0.0.1/32", "timeout": 5},
    )
    assert r.status_code in (200, 202, 504), (
        f"Unexpected status: {r.status_code}"
    )


def test_sites_endpoint_returns_list(http, authed):
    r = http.get(f"{API_URL}/sites", headers=authed)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_discovery_page_loads(http):
    r = http.get(f"{FRONTEND_URL}/discovery")
    assert r.status_code == 200
    assert '<div id="root">' in r.text
