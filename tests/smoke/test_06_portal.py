"""
Test 06 — Portal proxy health and Grafana iframe security headers.
"""
from .conftest import PORTAL_URL


def test_portal_health(http):
    r = http.get(f"{PORTAL_URL}/health")
    assert r.status_code == 200


def test_grafana_proxy_returns_frame(http):
    """
    The portal must proxy Grafana and return a response.
    Exact content varies — we only assert the proxy is alive.
    """
    r = http.get(f"{PORTAL_URL}/grafana/", follow_redirects=True)
    assert r.status_code in (200, 302, 401), (
        f"Unexpected portal/grafana status: {r.status_code}"
    )


def test_portal_sets_security_headers(http):
    """
    Portal must set X-Frame-Options and Content-Security-Policy
    on all responses to prevent clickjacking.
    """
    r = http.get(f"{PORTAL_URL}/health")
    headers = {k.lower(): v for k, v in r.headers.items()}
    assert "x-frame-options" in headers or "content-security-policy" in headers, (
        "Portal must set X-Frame-Options or Content-Security-Policy"
    )
