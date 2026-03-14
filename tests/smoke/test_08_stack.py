"""
Test 08 — End-to-end stack test.

Flow:
  1. Insert a device into the DB via the API Gateway.
  2. Simulate the enroller discovering the same device at a NEW IP.
  3. Assert:
     a. An ASSET_MOVED row appears in audit_logs (DB trigger fired).
     b. The notifier /alert endpoint was called (checked via audit_logs source_service).
     c. The device's IP is updated in the devices table.
"""
import pytest
import asyncio
from .conftest import API_URL, DB_DSN

pytestmark = pytest.mark.asyncio

TEST_SERIAL  = "E2E-SMOKE-001"
ORIGINAL_IP  = "192.168.1.100"
NEW_IP       = "192.168.1.200"


@pytest.fixture(autouse=True)
async def cleanup(db):
    """Remove test device before and after each test in this module."""
    await db.execute(
        "DELETE FROM audit_logs WHERE device_serial = $1;", TEST_SERIAL
    )
    await db.execute(
        "DELETE FROM devices WHERE serial_number = $1;", TEST_SERIAL
    )
    yield
    await db.execute(
        "DELETE FROM audit_logs WHERE device_serial = $1;", TEST_SERIAL
    )
    await db.execute(
        "DELETE FROM devices WHERE serial_number = $1;", TEST_SERIAL
    )


async def test_asset_moved_end_to_end(db, http):
    # Step 1 — Insert device at original IP
    await db.execute("""
        INSERT INTO devices (serial_number, hostname, ip_address, device_type, site_id)
        VALUES ($1, 'e2e-ap-01', $2, 'AP', 'SITE-SMOKE');
    """, TEST_SERIAL, ORIGINAL_IP)

    # Step 2 — Simulate enroller discovering device at new IP.
    # The enroller's check_and_update logic must:
    #   a. Detect the IP mismatch.
    #   b. POST to notifier BEFORE updating the DB.
    #   c. Log ASSET_MOVED to audit_logs.
    #   d. Update devices.ip_address.
    #
    # In the smoke test, we call the enroller's internal trigger endpoint.
    r = http.post(f"{API_URL}/enroller/check", json={
        "serial_number": TEST_SERIAL,
        "ip":            NEW_IP,
        "hostname":      "e2e-ap-01",
    })
    assert r.status_code in (200, 202), (
        f"Enroller check endpoint failed: {r.status_code} {r.text}"
    )

    # Allow async processing to complete
    await asyncio.sleep(2)

    # Step 3a — Assert ASSET_MOVED in audit_logs
    row = await db.fetchrow("""
        SELECT event_type, severity FROM audit_logs
        WHERE device_serial = $1 AND event_type = 'ASSET_MOVED';
    """, TEST_SERIAL)
    assert row is not None,               "ASSET_MOVED not found in audit_logs"
    assert row["severity"] == "CRITICAL", "ASSET_MOVED severity must be CRITICAL"

    # Step 3b — Assert notifier was recorded as the source
    notifier_row = await db.fetchrow("""
        SELECT source_service FROM audit_logs
        WHERE device_serial = $1 AND source_service = 'notifier';
    """, TEST_SERIAL)
    assert notifier_row is not None, "Notifier was not recorded in audit_logs"

    # Step 3c — Assert IP was updated in devices table
    device = await db.fetchrow(
        "SELECT ip_address FROM devices WHERE serial_number = $1;", TEST_SERIAL
    )
    assert str(device["ip_address"]) == NEW_IP, (
        f"Device IP not updated. Expected {NEW_IP}, got {device['ip_address']}"
    )
