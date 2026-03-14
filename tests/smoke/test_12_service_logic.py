"""
Test 12 — Service logic validation.
Validates: scanner import, provisioner platform map, alert routing,
           SMS gate logic, Telegram config presence.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.getcwd(), "services/enroller"))
sys.path.insert(0, os.path.join(os.getcwd(), "services/notifier"))


def test_nmap_scanner_imports():
    from app.scanner import NmapScanner
    assert NmapScanner is not None


def test_scrapli_platform_map_covers_all_vendors():
    from app.provisioner import PLATFORM_MAP
    required = {"IOS", "IOS-XE", "NX-OS", "JunOS"}
    assert required.issubset(set(PLATFORM_MAP.keys())), (
        f"Missing platforms: {required - set(PLATFORM_MAP.keys())}"
    )


def test_scrapli_platforms_map_to_valid_scrapli_strings():
    from app.provisioner import PLATFORM_MAP
    valid_scrapli = {"cisco_iosxe", "cisco_nxos", "juniper_junos"}
    for k, v in PLATFORM_MAP.items():
        assert v in valid_scrapli, f"{k} maps to unknown Scrapli platform: {v}"


def test_sms_gate_blocks_non_critical():
    from app.twilio_handler import _should_send_sms
    assert _should_send_sms("AP-001", "CRITICAL", "test") is True
    assert _should_send_sms("AP-001", "WARNING", "test") is False
    assert _should_send_sms("AP-001", "INFO", "test") is False
    assert _should_send_sms("AP-001", "ERROR", "test") is False


def test_sms_gate_blocks_non_device_serials():
    from app.twilio_handler import _should_send_sms
    assert _should_send_sms("grafana", "CRITICAL", "test") is False
    assert _should_send_sms("system", "CRITICAL", "test") is False
    assert _should_send_sms("", "CRITICAL", "test") is False


def test_sms_format_truncates_long_messages():
    from app.twilio_handler import _format_sms
    long_msg = "x" * 200
    result = _format_sms("AP-001", "CRITICAL", long_msg)
    assert len(result) <= 160


def test_telegram_format_includes_emoji():
    from app.telegram_handler import _format_message, SEVERITY_EMOJI
    for severity in ["INFO", "WARNING", "ERROR", "CRITICAL"]:
        msg = _format_message("AP-001", severity, "test message")
        assert SEVERITY_EMOJI[severity] in msg
        assert "AP-001" in msg


def test_telegram_format_grafana_source():
    from app.telegram_handler import _format_message
    msg = _format_message("grafana", "CRITICAL", "disk full")
    assert "Grafana" in msg


def test_alert_payload_requires_valid_severity():
    """AlertPayload must reject invalid severity values."""
    from app.main import AlertPayload
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AlertPayload(serial="AP-001", severity="PANIC", message="test")
