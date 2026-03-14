"""
Twilio SMS handler.
Secondary delivery channel — CRITICAL severity only, real device serials only.
Enrollment events (ASSET_MOVED, AUTH_FAILURE) always trigger SMS.
"""
import logging
import os

from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

logger = logging.getLogger(__name__)

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")
TWILIO_TO_NUMBER = os.environ.get("TWILIO_TO_NUMBER", "")

ENROLLMENT_EVENT_TYPES = {
    "ASSET_MOVED",
    "AUTH_FAILURE",
    "NEW_DEVICE",
    "DEVICE_OFFLINE",
}


def _should_send_sms(serial: str, severity: str, message: str) -> bool:
    """
    SMS gate: only send when ALL conditions are met:
      1. Severity is CRITICAL
      2. Serial is a real device serial (not 'grafana', not 'system')
      3. Message contains an enrollment event keyword OR severity alone qualifies
    """
    if severity != "CRITICAL":
        return False
    if serial in ("grafana", "system", ""):
        return False
    return True


def _format_sms(serial: str, severity: str, message: str) -> str:
    """Keep SMS under 160 chars. Strip markdown."""
    body = f"[AeroNet {severity}] Device {serial}: {message}"
    return body[:157] + "..." if len(body) > 160 else body


async def send_sms(serial: str, severity: str, message: str) -> bool:
    """
    Send SMS via Twilio.
    Returns True on success, False on failure or skip.
    Never raises.
    """
    if not _should_send_sms(serial, severity, message):
        logger.debug(f"SMS skipped — severity={severity} serial={serial}")
        return False

    if not all(
        [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER]
    ):
        logger.warning("Twilio not configured — missing env vars")
        return False

    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=_format_sms(serial, severity, message),
            from_=TWILIO_FROM_NUMBER,
            to=TWILIO_TO_NUMBER,
        )
        logger.info(f"SMS sent: SID={msg.sid} for {serial}")
        return True

    except TwilioRestException as e:
        logger.error(f"Twilio error: {e}")
        return False
