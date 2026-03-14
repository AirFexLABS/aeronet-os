"""
Telegram alert handler.
Primary delivery channel for ALL alert severities.
Uses Bot API sendMessage with Markdown formatting.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
TELEGRAM_API_BASE = "https://api.telegram.org"

SEVERITY_EMOJI = {
    "INFO": "\u2139\ufe0f",
    "WARNING": "\u26a0\ufe0f",
    "ERROR": "\U0001f534",
    "CRITICAL": "\U0001f6a8",
}


def _format_message(serial: str, severity: str, message: str) -> str:
    """
    Format alert as Telegram Markdown message.
    Example output:
      🚨 *CRITICAL ALERT*
      Device: `AP-SN-001234`
      Nmap discovery: device found at new IP 10.0.1.55
    """
    emoji = SEVERITY_EMOJI.get(severity, "\U0001f4e2")
    header = f"{emoji} *{severity} ALERT*"
    device_line = f"Device: `{serial}`" if serial != "grafana" else "Source: Grafana"
    return f"{header}\n{device_line}\n{message}"


async def send_telegram(serial: str, severity: str, message: str) -> bool:
    """
    Send an alert to the configured Telegram chat.
    Returns True on success, False on failure.
    Never raises — all errors are logged and swallowed.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning(
            "Telegram not configured — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing"
        )
        return False

    text = _format_message(serial, severity, message)
    url = f"{TELEGRAM_API_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": text,
                    "parse_mode": "Markdown",
                },
            )
        if resp.status_code == 200:
            logger.info(f"Telegram sent: {severity} for {serial}")
            return True
        else:
            logger.error(
                f"Telegram API error {resp.status_code}: {resp.text}"
            )
            return False

    except httpx.HTTPError as e:
        logger.error(f"Telegram HTTP error: {e}")
        return False
