"""
Test 05 — Notifier service alert endpoint contract.
"""
import pytest
from .conftest import NOTIFIER_URL


def test_notifier_health(http):
    r = http.get(f"{NOTIFIER_URL}/health")
    assert r.status_code == 200


def test_alert_endpoint_rejects_missing_severity(http):
    """
    POST /alert without severity must return 422.
    """
    r = http.post(
        f"{NOTIFIER_URL}/alert",
        json={"message": "test alert", "serial": "SMOKE-001"},
    )
    assert r.status_code == 422, (
        f"Expected 422 for missing severity, got {r.status_code}"
    )


def test_alert_endpoint_accepts_valid_payload(http):
    """
    POST /alert with a valid payload must return 200 or 202.
    NOTE: This will attempt to send a real Twilio/Telegram message
    if credentials are configured. In CI, use test credentials that
    route to a null sink.
    """
    r = http.post(
        f"{NOTIFIER_URL}/alert",
        json={
            "serial":   "SMOKE-001",
            "severity": "INFO",
            "message":  "Smoke test alert — safe to ignore",
        },
    )
    assert r.status_code in (200, 202), (
        f"Expected 200/202, got {r.status_code}: {r.text}"
    )
