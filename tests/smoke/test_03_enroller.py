"""
Test 03 — Enroller service reachability and AssetTracker contract.
"""
import pytest
from .conftest import API_URL


def test_enroller_health(http):
    """
    The enroller exposes a /health endpoint.
    """
    r = http.get(f"{API_URL}/enroller/health")
    assert r.status_code == 200


def test_asset_moved_alert_fires_on_ip_change(http, db):
    """
    Contract test: if a device is registered at IP A,
    and the enroller discovers it at IP B,
    an ASSET_MOVED row must appear in audit_logs.
    This test calls the enroller's internal check endpoint directly.
    """
    # Tested end-to-end in test_08_stack.py
    pytest.skip("Covered by end-to-end test in test_08_stack.py")
