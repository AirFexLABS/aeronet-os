"""
Shared pytest fixtures for the AeroNet OS smoke test suite.
All base URLs are read from environment variables with sane defaults
matching the docker-compose.yml port mappings.
"""
import os
import pytest
import httpx
import asyncpg
from tenacity import retry, stop_after_attempt, wait_fixed


# ── Base URLs ──────────────────────────────────────────────────────────────
API_URL      = os.getenv("TEST_API_URL",      "http://localhost:8000")
NOTIFIER_URL = os.getenv("TEST_NOTIFIER_URL", "http://localhost:8001")
ENROLLER_URL = os.getenv("TEST_ENROLLER_URL", "http://localhost:8002")
PORTAL_URL   = os.getenv("TEST_PORTAL_URL",   "http://localhost:8080")
FRONTEND_URL = os.getenv("TEST_FRONTEND_URL", "http://localhost:5173")
GRAFANA_URL  = os.getenv("TEST_GRAFANA_URL",  "http://localhost:3000")
GRAFANA_PASS = os.getenv("GRAFANA_ADMIN_PASSWORD", "")
DB_DSN       = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql://aeronet:changeme@localhost:5432/aeronet"
)


# ── HTTP client fixture ────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def http():
    """Synchronous HTTPX client for simple GET/POST assertions."""
    with httpx.Client(timeout=10) as client:
        yield client


# ── Async DB connection fixture ────────────────────────────────────────────
@pytest.fixture(scope="session")
async def db():
    """
    asyncpg connection to the live PostgreSQL instance.
    Retries up to 5 times with 3s wait — allows for slow container startup.
    """
    @retry(stop=stop_after_attempt(5), wait=wait_fixed(3))
    async def _connect():
        return await asyncpg.connect(DB_DSN)

    conn = await _connect()
    yield conn
    await conn.close()
