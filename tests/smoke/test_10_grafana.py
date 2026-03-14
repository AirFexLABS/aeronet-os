"""
Test 10 — Grafana provisioning validation.
Validates: datasources reachable, all 3 dashboards provisioned, key panels present.
"""
import os
import pytest
import httpx

GRAFANA_URL  = os.getenv("TEST_GRAFANA_URL",       "http://localhost:3000")
GRAFANA_USER = os.getenv("GRAFANA_ADMIN_USER",      "admin")
GRAFANA_PASS = os.getenv("GRAFANA_ADMIN_PASSWORD",  "")

EXPECTED_DASHBOARD_UIDS = [
    "aeronet-device-inventory",
    "aeronet-alert-history",
    "aeronet-network-topology",
]

EXPECTED_DATASOURCE_NAMES = [
    "AeroNet PostgreSQL",
    "AeroNet Prometheus",
]


@pytest.fixture(scope="module")
def grafana():
    with httpx.Client(
        base_url=GRAFANA_URL,
        auth=(GRAFANA_USER, GRAFANA_PASS),
        timeout=10,
    ) as client:
        yield client


def test_grafana_is_healthy(grafana):
    r = grafana.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("database") == "ok"


def test_datasources_provisioned(grafana):
    r = grafana.get("/api/datasources")
    assert r.status_code == 200
    names = {ds["name"] for ds in r.json()}
    for expected in EXPECTED_DATASOURCE_NAMES:
        assert expected in names, f"Datasource not provisioned: {expected}"


def test_prometheus_datasource_healthy(grafana):
    r = grafana.get("/api/datasources/name/AeroNet Prometheus")
    uid = r.json()["uid"]
    probe = grafana.get(f"/api/datasources/uid/{uid}/health")
    assert probe.status_code == 200
    assert probe.json().get("status") == "OK"


def test_postgres_datasource_healthy(grafana):
    r = grafana.get("/api/datasources/name/AeroNet PostgreSQL")
    uid = r.json()["uid"]
    probe = grafana.get(f"/api/datasources/uid/{uid}/health")
    assert probe.status_code == 200


def test_all_dashboards_provisioned(grafana):
    for uid in EXPECTED_DASHBOARD_UIDS:
        r = grafana.get(f"/api/dashboards/uid/{uid}")
        assert r.status_code == 200, f"Dashboard not found: {uid}"


def test_device_inventory_panels(grafana):
    r = grafana.get("/api/dashboards/uid/aeronet-device-inventory")
    panels = {p["title"] for p in r.json()["dashboard"]["panels"]}
    assert {"Total Devices", "Offline Devices", "Device Inventory"}.issubset(panels)


def test_alert_history_panels(grafana):
    r = grafana.get("/api/dashboards/uid/aeronet-alert-history")
    panels = {p["title"] for p in r.json()["dashboard"]["panels"]}
    assert "Raw Audit Log" in panels


def test_network_topology_panels(grafana):
    r = grafana.get("/api/dashboards/uid/aeronet-network-topology")
    panels = {p["title"] for p in r.json()["dashboard"]["panels"]}
    assert "AP to Switch Mapping" in panels
