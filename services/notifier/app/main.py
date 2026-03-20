"""
Notifier service — alert dispatcher.
Delivery order: Telegram (all severities) -> SMS (CRITICAL + real serial only).
Both channels are attempted independently — one failing does not block the other.
"""
import logging
import os

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.models import AlertPayload, GrafanaWebhookPayload
from app.telegram_handler import send_telegram
from app.twilio_handler import send_sms
from app.dispatch import router as dispatch_router
from app.db import get_pool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AeroNet Notifier")
Instrumentator().instrument(app).expose(app)
app.include_router(dispatch_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "notifier"}


@app.post("/alert", status_code=202)
async def send_alert(payload: AlertPayload):
    if os.getenv("SMOKE_TEST") == "true":
        return {"status": "suppressed", "reason": "SMOKE_TEST mode active"}

    results = {}

    # 1. Telegram — always attempt first, all severities
    results["telegram"] = await send_telegram(
        payload.serial, payload.severity, payload.message
    )

    # 2. SMS — CRITICAL + real device serial only
    results["sms"] = await send_sms(
        payload.serial, payload.severity, payload.message
    )

    # 3. Log to audit_logs regardless of delivery outcome
    await _log_to_audit(payload, results)

    delivered = [ch for ch, ok in results.items() if ok]
    return {
        "status": "dispatched",
        "delivered": delivered,
        "skipped": [ch for ch, ok in results.items() if not ok],
    }


@app.post("/alert/grafana", status_code=202)
async def grafana_webhook(payload: GrafanaWebhookPayload):
    if os.getenv("SMOKE_TEST") == "true":
        return {"status": "suppressed"}

    severity = "CRITICAL" if payload.state == "alerting" else "INFO"
    alert = AlertPayload(
        serial="grafana",
        severity=severity,
        message=f"[Grafana] {payload.title}: {payload.message}",
    )
    return await send_alert(alert)


async def _log_to_audit(payload: AlertPayload, results: dict):
    """Write alert dispatch record to audit_logs."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO audit_logs
                  (event_type, severity, device_serial, message, source_service)
                VALUES
                  ($1, $2, $3, $4, $5)
                """,
                "ALERT_DISPATCHED",
                payload.severity,
                payload.serial,
                f"{payload.message} | channels: {results}",
                "notifier",
            )
    except Exception as e:
        logger.error(f"Failed to write alert to audit_logs: {e}")
