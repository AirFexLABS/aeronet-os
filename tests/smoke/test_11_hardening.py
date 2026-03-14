"""
Test 11 — Production hardening validation.
Validates: TLS redirect, security headers, healthchecks, secret hygiene, gitignore.
"""
import os
import pathlib
import subprocess

import httpx
import pytest

NGINX_HTTP  = os.getenv("TEST_NGINX_HTTP",  "http://localhost:80")
NGINX_HTTPS = os.getenv("TEST_NGINX_HTTPS", "https://localhost:443")
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# TLS & redirect
# ---------------------------------------------------------------------------
class TestTLS:
    def test_http_redirects_to_https(self):
        """Port 80 must 301 → HTTPS."""
        r = httpx.get(f"{NGINX_HTTP}/", follow_redirects=False, verify=False)
        assert r.status_code == 301
        assert r.headers["location"].startswith("https://")

    def test_https_is_reachable(self):
        """Port 443 must answer with 200 or valid upstream response."""
        r = httpx.get(f"{NGINX_HTTPS}/", verify=False)
        assert r.status_code in (200, 404)


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------
class TestSecurityHeaders:
    @pytest.fixture(scope="class")
    def headers(self):
        r = httpx.get(f"{NGINX_HTTPS}/", verify=False)
        return r.headers

    def test_x_frame_options(self, headers):
        assert headers.get("x-frame-options") == "SAMEORIGIN"

    def test_x_content_type_options(self, headers):
        assert headers.get("x-content-type-options") == "nosniff"

    def test_strict_transport_security(self, headers):
        hsts = headers.get("strict-transport-security", "")
        assert "max-age=" in hsts

    def test_no_server_token(self, headers):
        """Server header should not leak nginx version."""
        server = headers.get("server", "")
        assert "nginx/" not in server.lower()


# ---------------------------------------------------------------------------
# Healthchecks (via nginx proxy)
# ---------------------------------------------------------------------------
class TestHealthchecks:
    HEALTH_ENDPOINTS = [
        f"{NGINX_HTTPS.replace('localhost', 'api.aeronet.local')}/health",
    ]

    @pytest.mark.parametrize("url", HEALTH_ENDPOINTS)
    def test_health_returns_ok(self, url):
        """Each /health endpoint should return 200."""
        try:
            r = httpx.get(url, verify=False, timeout=5)
            assert r.status_code == 200
        except httpx.ConnectError:
            pytest.skip(f"Cannot reach {url} — DNS may not resolve in CI")


# ---------------------------------------------------------------------------
# Secret hygiene
# ---------------------------------------------------------------------------
class TestSecretHygiene:
    def test_env_secret_example_has_no_real_values(self):
        """Example env file must only contain empty placeholders."""
        example = PROJECT_ROOT / ".env.secret.example"
        if not example.exists():
            pytest.skip(".env.secret.example not found")
        for line in example.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, _, value = line.partition("=")
            assert value == "", f"{key} in .env.secret.example has a value"

    def test_env_secret_not_committed(self):
        """`.env.secret` must be in .gitignore."""
        gitignore = PROJECT_ROOT / ".gitignore"
        patterns = gitignore.read_text()
        assert ".env" in patterns or ".env.*" in patterns

    def test_certs_not_committed(self):
        """TLS cert directory must be in .gitignore."""
        gitignore = PROJECT_ROOT / ".gitignore"
        patterns = gitignore.read_text()
        assert "infra/nginx/certs/" in patterns or "*.crt" in patterns


# ---------------------------------------------------------------------------
# .gitignore completeness
# ---------------------------------------------------------------------------
class TestGitignore:
    @pytest.fixture(scope="class")
    def patterns(self):
        return (PROJECT_ROOT / ".gitignore").read_text()

    def test_python_caches_ignored(self, patterns):
        assert "__pycache__/" in patterns

    def test_node_modules_ignored(self, patterns):
        assert "node_modules/" in patterns

    def test_venv_ignored(self, patterns):
        assert ".venv/" in patterns

    def test_pem_files_ignored(self, patterns):
        assert "*.pem" in patterns

    def test_key_files_ignored(self, patterns):
        assert "*.key" in patterns
