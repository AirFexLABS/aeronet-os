"""
Dynamic dispatch endpoint — sends notifications to arbitrary recipients.
Called by the API Gateway when dispatching alert contact test notifications.
Reuses existing Telegram/Twilio service credentials from environment.
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dispatch"])

# Service credentials from environment
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_API_BASE = "https://api.telegram.org"

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")

SEVERITY_EMOJI = {
    "INFO": "\u2139\ufe0f",
    "WARNING": "\u26a0\ufe0f",
    "ERROR": "\U0001f534",
    "CRITICAL": "\U0001f6a8",
}


class DispatchRequest(BaseModel):
    channel: str   # "telegram" | "sms" | "whatsapp" | "email"
    recipient: str
    message: str
    severity: str = "INFO"
    whatsapp_use_separate_sender: bool = False
    whatsapp_sender_number: Optional[str] = None


@router.post("/notify/dispatch")
async def dispatch(req: DispatchRequest):
    if req.channel == "telegram":
        return await _send_telegram(req)
    elif req.channel == "sms":
        return await _send_sms(req)
    elif req.channel == "whatsapp":
        return await _send_whatsapp(req)
    elif req.channel == "email":
        raise HTTPException(status_code=501, detail="Email dispatch not yet implemented. Add SMTP settings to enable.")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {req.channel}")


async def _send_telegram(req: DispatchRequest) -> dict:
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram not configured — TELEGRAM_BOT_TOKEN missing")

    emoji = SEVERITY_EMOJI.get(req.severity, "\U0001f4e2")
    text = f"{emoji} *{req.severity}*\n{req.message}"

    url = f"{TELEGRAM_API_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": req.recipient,
                "text": text,
                "parse_mode": "Markdown",
            })
        if resp.status_code == 200:
            return {"status": "sent", "channel": "telegram"}
        else:
            raise HTTPException(status_code=502, detail=f"Telegram API error {resp.status_code}: {resp.text}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Telegram HTTP error: {e}")


async def _send_sms(req: DispatchRequest) -> dict:
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER]):
        raise HTTPException(status_code=503, detail="Twilio not configured — missing env vars")

    body = f"[AeroNet {req.severity}] {req.message}"
    body = body[:157] + "..." if len(body) > 160 else body

    try:
        client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=body,
            from_=TWILIO_FROM_NUMBER,
            to=req.recipient,
        )
        logger.info(f"SMS dispatched: SID={msg.sid} to={req.recipient}")
        return {"status": "sent", "channel": "sms"}
    except TwilioRestException as e:
        raise HTTPException(status_code=502, detail=f"Twilio error: {e}")


async def _send_whatsapp(req: DispatchRequest) -> dict:
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN]):
        raise HTTPException(status_code=503, detail="Twilio not configured — missing env vars")

    if req.whatsapp_use_separate_sender and req.whatsapp_sender_number:
        from_num = f"whatsapp:{req.whatsapp_sender_number}"
    elif TWILIO_FROM_NUMBER:
        from_num = f"whatsapp:{TWILIO_FROM_NUMBER}"
    else:
        raise HTTPException(status_code=503, detail="No WhatsApp sender number configured")

    body = f"[AeroNet {req.severity}] {req.message}"

    try:
        client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=body,
            from_=from_num,
            to=f"whatsapp:{req.recipient}",
        )
        logger.info(f"WhatsApp dispatched: SID={msg.sid} to={req.recipient}")
        return {"status": "sent", "channel": "whatsapp"}
    except TwilioRestException as e:
        raise HTTPException(status_code=502, detail=f"Twilio WhatsApp error: {e}")
