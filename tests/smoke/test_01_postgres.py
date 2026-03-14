"""
Test 01 — PostgreSQL schema integrity.
Validates: tables exist, primary keys, foreign keys, indexes, IP_CHANGE trigger.
"""
import pytest

pytestmark = pytest.mark.asyncio

EXPECTED_TABLES = {"devices", "connectivity_matrix", "credentials", "audit_logs"}

EXPECTED_INDEXES = {"idx_devices_ip_address", "idx_devices_site_id"}


async def test_tables_exist(db):
    rows = await db.fetch(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
    )
    found = {r["tablename"] for r in rows}
    assert EXPECTED_TABLES.issubset(found), (
        f"Missing tables: {EXPECTED_TABLES - found}"
    )


async def test_devices_primary_key_is_serial_number(db):
    row = await db.fetchrow("""
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'devices'
          AND tc.constraint_type = 'PRIMARY KEY';
    """)
    assert row is not None, "devices table has no primary key"
    assert row["column_name"] == "serial_number"


async def test_connectivity_matrix_foreign_key(db):
    row = await db.fetchrow("""
        SELECT ccu.table_name AS foreign_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = rc.unique_constraint_name
        WHERE tc.table_name = 'connectivity_matrix'
          AND tc.constraint_type = 'FOREIGN KEY';
    """)
    assert row is not None, "connectivity_matrix has no foreign key"
    assert row["foreign_table"] == "devices"


async def test_indexes_exist(db):
    rows = await db.fetch(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'devices';"
    )
    found = {r["indexname"] for r in rows}
    assert EXPECTED_INDEXES.issubset(found), (
        f"Missing indexes: {EXPECTED_INDEXES - found}"
    )


async def test_ip_change_trigger_exists(db):
    row = await db.fetchrow("""
        SELECT trigger_name FROM information_schema.triggers
        WHERE event_object_table = 'devices'
          AND event_manipulation = 'UPDATE';
    """)
    assert row is not None, "No UPDATE trigger found on devices table"


async def test_ip_change_trigger_fires(db):
    """
    Insert a device, update its IP, and assert audit_logs receives
    an IP_CHANGE row automatically via the trigger.
    """
    test_serial = "SMOKE-TEST-001"

    # Clean up any previous run
    await db.execute(
        "DELETE FROM audit_logs WHERE device_serial = $1;", test_serial
    )
    await db.execute(
        "DELETE FROM devices WHERE serial_number = $1;", test_serial
    )

    # Insert
    await db.execute("""
        INSERT INTO devices (serial_number, hostname, ip_address, device_type, site_id)
        VALUES ($1, 'smoke-host', '10.0.0.1', 'AP', 'SITE-SMOKE');
    """, test_serial)

    # Trigger the IP change
    await db.execute("""
        UPDATE devices SET ip_address = '10.0.0.2'
        WHERE serial_number = $1;
    """, test_serial)

    # Assert trigger fired
    row = await db.fetchrow("""
        SELECT event_type FROM audit_logs
        WHERE device_serial = $1 AND event_type = 'IP_CHANGE';
    """, test_serial)
    assert row is not None, "IP_CHANGE trigger did not insert into audit_logs"

    # Clean up
    await db.execute(
        "DELETE FROM audit_logs WHERE device_serial = $1;", test_serial
    )
    await db.execute(
        "DELETE FROM devices WHERE serial_number = $1;", test_serial
    )
