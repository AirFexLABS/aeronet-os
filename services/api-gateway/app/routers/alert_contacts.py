"""
Alert contacts router — CRUD for notification contacts and channels.
All PII is Fernet-encrypted at rest. Responses mask PII by default.
All endpoints require admin role.
"""
import logging
import os
from datetime import datetime
from enum import Enum
from typing import Annotated, Optional
from uuid import UUID

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..dependencies import get_current_user, require_role
from ..models.user import Role, TokenPayload
from .. import db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["alert-contacts"])

# ── Encryption ────────────────────────────────────────────────────────────

_alert_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _alert_fernet
    if _alert_fernet is None:
        key = os.environ.get("ALERT_CONTACTS_ENCRYPTION_KEY")
        if not key:
            raise EnvironmentError("ALERT_CONTACTS_ENCRYPTION_KEY not set")
        _alert_fernet = Fernet(key.encode())
    return _alert_fernet


def encrypt_pii(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_pii(value: str) -> str:
    return _get_fernet().decrypt(value.encode()).decode()


# ── PII Masking ───────────────────────────────────────────────────────────

def mask_value(value: str, channel_type: str) -> str:
    if channel_type == "email":
        parts = value.split("@")
        if len(parts) == 2:
            local = parts[0]
            return f"{local[:2]}***@{parts[1]}" if len(local) > 2 else f"***@{parts[1]}"
        return "***"
    elif channel_type in ("sms", "whatsapp"):
        return f"+******{value[-4:]}" if len(value) > 4 else "******"
    elif channel_type == "telegram":
        return f"{value[:4]}***" if len(value) > 4 else "***"
    return "***"


# ── Models ────────────────────────────────────────────────────────────────

class ChannelType(str, Enum):
    email = "email"
    sms = "sms"
    whatsapp = "whatsapp"
    telegram = "telegram"


class MinSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class ChannelCreate(BaseModel):
    channel_type: ChannelType
    recipient_value: str
    min_severity: MinSeverity = MinSeverity.WARNING
    whatsapp_use_separate_sender: bool = False
    whatsapp_sender_number: Optional[str] = None


class ContactCreate(BaseModel):
    display_name: str
    is_active: bool = True
    channels: list[ChannelCreate]


class ContactUpdate(BaseModel):
    display_name: Optional[str] = None
    is_active: Optional[bool] = None


class ChannelUpdate(BaseModel):
    min_severity: Optional[MinSeverity] = None
    is_active: Optional[bool] = None
    recipient_value: Optional[str] = None


class ChannelResponse(BaseModel):
    id: str
    channel_type: ChannelType
    recipient_value: str
    min_severity: MinSeverity
    whatsapp_use_separate_sender: bool
    is_active: bool


class ContactResponse(BaseModel):
    id: str
    display_name: str
    is_active: bool
    channels: list[ChannelResponse]
    created_at: datetime
    updated_at: datetime


# ── Helpers ───────────────────────────────────────────────────────────────

NOTIFIER_URL = os.environ.get("NOTIFIER_URL", "http://notifier:8001")


def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")


async def _audit_log(action: str, performed_by: str, entity_id: str, detail: str = ""):
    try:
        pool = await db.get_pool()
        await pool.execute(
            "INSERT INTO audit_logs (event_type, severity, device_serial, message, source_service) "
            "VALUES ($1, $2, $3, $4, $5)",
            action, "INFO", entity_id, detail, "api-gateway",
        )
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")


async def _fetch_contact(pool, contact_id: str) -> dict:
    """Fetch a contact with its channels, PII masked."""
    contact = await pool.fetchrow(
        "SELECT id, display_name, is_active, created_at, updated_at "
        "FROM alert_contacts WHERE id = $1::uuid", contact_id,
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    channels = await pool.fetch(
        "SELECT id, channel_type, recipient_value, min_severity, "
        "whatsapp_use_separate_sender, is_active "
        "FROM alert_contact_channels WHERE contact_id = $1::uuid "
        "ORDER BY created_at", contact_id,
    )

    channel_list = []
    for ch in channels:
        try:
            decrypted = decrypt_pii(ch["recipient_value"])
            masked = mask_value(decrypted, ch["channel_type"])
        except Exception:
            masked = "***"
        channel_list.append(ChannelResponse(
            id=str(ch["id"]),
            channel_type=ch["channel_type"],
            recipient_value=masked,
            min_severity=ch["min_severity"],
            whatsapp_use_separate_sender=ch["whatsapp_use_separate_sender"],
            is_active=ch["is_active"],
        ).model_dump(mode="json"))

    return ContactResponse(
        id=str(contact["id"]),
        display_name=contact["display_name"],
        is_active=contact["is_active"],
        channels=channel_list,
        created_at=contact["created_at"],
        updated_at=contact["updated_at"],
    ).model_dump(mode="json")


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/alert-contacts")
async def list_contacts(
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    rows = await pool.fetch(
        "SELECT id FROM alert_contacts ORDER BY created_at DESC"
    )
    return [await _fetch_contact(pool, str(r["id"])) for r in rows]


@router.post("/alert-contacts", status_code=status.HTTP_201_CREATED)
async def create_contact(
    body: ContactCreate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    if not body.channels:
        raise HTTPException(status_code=422, detail="At least one channel is required")

    pool = await db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO alert_contacts (display_name, is_active) "
                "VALUES ($1, $2) RETURNING id",
                body.display_name, body.is_active,
            )
            contact_id = str(row["id"])

            for ch in body.channels:
                encrypted_recipient = encrypt_pii(ch.recipient_value)
                encrypted_sender = encrypt_pii(ch.whatsapp_sender_number) if ch.whatsapp_sender_number else None
                await conn.execute(
                    "INSERT INTO alert_contact_channels "
                    "(contact_id, channel_type, recipient_value, min_severity, "
                    "whatsapp_use_separate_sender, whatsapp_sender_number, is_active) "
                    "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)",
                    contact_id, ch.channel_type.value, encrypted_recipient,
                    ch.min_severity.value, ch.whatsapp_use_separate_sender,
                    encrypted_sender, True,
                )

    await _audit_log("CONTACT_CREATED", current_user.sub, contact_id, body.display_name)
    return await _fetch_contact(pool, contact_id)


@router.get("/alert-contacts/{contact_id}")
async def get_contact(
    contact_id: str,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    return await _fetch_contact(pool, contact_id)


@router.put("/alert-contacts/{contact_id}")
async def update_contact(
    contact_id: str,
    body: ContactUpdate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    existing = await pool.fetchrow(
        "SELECT id FROM alert_contacts WHERE id = $1::uuid", contact_id,
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    fields = []
    values = []
    idx = 1
    updates = body.model_dump(exclude_none=True)
    for field, value in updates.items():
        fields.append(f"{field} = ${idx}")
        values.append(value)
        idx += 1

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")

    values.append(contact_id)
    await pool.execute(
        f"UPDATE alert_contacts SET {', '.join(fields)} WHERE id = ${idx}::uuid",
        *values,
    )
    await _audit_log("CONTACT_UPDATED", current_user.sub, contact_id)
    return await _fetch_contact(pool, contact_id)


@router.delete("/alert-contacts/{contact_id}")
async def delete_contact(
    contact_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    result = await pool.execute(
        "DELETE FROM alert_contacts WHERE id = $1::uuid", contact_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Contact not found")
    await _audit_log("CONTACT_DELETED", current_user.sub, contact_id)
    return {"status": "deleted", "id": contact_id}


@router.post("/alert-contacts/{contact_id}/channels", status_code=status.HTTP_201_CREATED)
async def add_channel(
    contact_id: str,
    body: ChannelCreate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    existing = await pool.fetchrow(
        "SELECT id FROM alert_contacts WHERE id = $1::uuid", contact_id,
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    encrypted_recipient = encrypt_pii(body.recipient_value)
    encrypted_sender = encrypt_pii(body.whatsapp_sender_number) if body.whatsapp_sender_number else None
    try:
        await pool.execute(
            "INSERT INTO alert_contact_channels "
            "(contact_id, channel_type, recipient_value, min_severity, "
            "whatsapp_use_separate_sender, whatsapp_sender_number, is_active) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)",
            contact_id, body.channel_type.value, encrypted_recipient,
            body.min_severity.value, body.whatsapp_use_separate_sender,
            encrypted_sender, True,
        )
    except Exception as e:
        if "alert_contact_channels_contact_id_channel_type_key" in str(e):
            raise HTTPException(status_code=409, detail="Channel type already exists for this contact")
        raise
    await _audit_log("CONTACT_CHANNEL_ADDED", current_user.sub, contact_id, body.channel_type.value)
    return await _fetch_contact(pool, contact_id)


@router.put("/alert-contacts/{contact_id}/channels/{channel_id}")
async def update_channel(
    contact_id: str,
    channel_id: str,
    body: ChannelUpdate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    existing = await pool.fetchrow(
        "SELECT id FROM alert_contact_channels WHERE id = $1::uuid AND contact_id = $2::uuid",
        channel_id, contact_id,
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Channel not found")

    fields = []
    values = []
    idx = 1
    updates = body.model_dump(exclude_none=True)

    if "recipient_value" in updates:
        fields.append(f"recipient_value = ${idx}")
        values.append(encrypt_pii(updates.pop("recipient_value")))
        idx += 1

    for field, value in updates.items():
        if field == "min_severity":
            value = value.value if hasattr(value, "value") else value
        fields.append(f"{field} = ${idx}")
        values.append(value)
        idx += 1

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update")

    values.append(channel_id)
    await pool.execute(
        f"UPDATE alert_contact_channels SET {', '.join(fields)} WHERE id = ${idx}::uuid",
        *values,
    )
    await _audit_log("CONTACT_CHANNEL_UPDATED", current_user.sub, contact_id, channel_id)
    return await _fetch_contact(pool, contact_id)


@router.delete("/alert-contacts/{contact_id}/channels/{channel_id}")
async def delete_channel(
    contact_id: str,
    channel_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    result = await pool.execute(
        "DELETE FROM alert_contact_channels WHERE id = $1::uuid AND contact_id = $2::uuid",
        channel_id, contact_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Channel not found")
    await _audit_log("CONTACT_CHANNEL_DELETED", current_user.sub, contact_id, channel_id)
    return {"status": "deleted", "channel_id": channel_id}


@router.get("/alert-contacts/{contact_id}/reveal/{channel_id}")
async def reveal_channel(
    contact_id: str,
    channel_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT recipient_value, channel_type FROM alert_contact_channels "
        "WHERE id = $1::uuid AND contact_id = $2::uuid",
        channel_id, contact_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Channel not found")

    decrypted = decrypt_pii(row["recipient_value"])
    await _audit_log("CONTACT_CHANNEL_REVEALED", current_user.sub, contact_id, channel_id)
    return {"channel_id": channel_id, "channel_type": row["channel_type"], "recipient_value": decrypted}


@router.post("/alert-contacts/{contact_id}/test")
async def test_contact(
    contact_id: str,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    contact = await pool.fetchrow(
        "SELECT id, display_name FROM alert_contacts WHERE id = $1::uuid", contact_id,
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    channels = await pool.fetch(
        "SELECT id, channel_type, recipient_value, whatsapp_use_separate_sender, "
        "whatsapp_sender_number FROM alert_contact_channels "
        "WHERE contact_id = $1::uuid AND is_active = TRUE", contact_id,
    )

    # Load SMTP config for email channel dispatch
    email_smtp = {}
    email_row = await pool.fetchrow("SELECT * FROM email_config WHERE id = 1 AND is_configured = TRUE")
    if email_row:
        try:
            email_smtp = {
                "smtp_host": email_row["smtp_host"],
                "smtp_port": email_row["smtp_port"],
                "smtp_username": decrypt_pii(email_row["smtp_username"]) if email_row["smtp_username"] else "",
                "smtp_password": decrypt_pii(email_row["smtp_password"]) if email_row["smtp_password"] else "",
                "from_address": email_row["from_address"],
                "from_name": email_row["from_name"],
                "use_tls": email_row["use_tls"],
            }
        except Exception:
            pass

    results = []
    for ch in channels:
        try:
            recipient = decrypt_pii(ch["recipient_value"])
            sender = decrypt_pii(ch["whatsapp_sender_number"]) if ch["whatsapp_sender_number"] else None

            payload = {
                "channel": ch["channel_type"],
                "recipient": recipient,
                "message": f"AeroNet OS -- Test notification for contact: {contact['display_name']}",
                "severity": "INFO",
                "whatsapp_use_separate_sender": ch["whatsapp_use_separate_sender"],
                "whatsapp_sender_number": sender,
            }
            # Inject SMTP config for email channel
            if ch["channel_type"] == "email":
                payload.update(email_smtp)

            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"{NOTIFIER_URL}/notify/dispatch", json=payload)
                if resp.status_code < 300:
                    results.append({"channel_id": str(ch["id"]), "channel_type": ch["channel_type"], "success": True, "error": None})
                else:
                    error_detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
                    results.append({"channel_id": str(ch["id"]), "channel_type": ch["channel_type"], "success": False, "error": str(error_detail)})
        except Exception as e:
            results.append({"channel_id": str(ch["id"]), "channel_type": ch["channel_type"], "success": False, "error": str(e)})

    await _audit_log("CONTACT_TEST_SENT", current_user.sub, contact_id, str(results))
    return {"results": results}


# ── Email Config Endpoints ────────────────────────────────────────────────

class EmailConfigUpdate(BaseModel):
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str
    smtp_password: str          # plaintext in request, encrypted at rest
    from_address: str
    from_name: str = "AeroNet OS"
    use_tls: bool = True


class EmailConfigResponse(BaseModel):
    smtp_host: str
    smtp_port: int
    smtp_username: str          # masked
    smtp_password: str          # always "********"
    from_address: str
    from_name: str
    use_tls: bool
    is_configured: bool
    updated_at: datetime


@router.get("/email-config")
async def get_email_config(
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    row = await pool.fetchrow("SELECT * FROM email_config WHERE id = 1")
    if row is None:
        return EmailConfigResponse(
            smtp_host="", smtp_port=587, smtp_username="", smtp_password="",
            from_address="", from_name="AeroNet OS", use_tls=True,
            is_configured=False, updated_at=datetime.now(),
        ).model_dump(mode="json")

    # Decrypt username for masked display
    username = ""
    if row["smtp_username"]:
        try:
            username = decrypt_pii(row["smtp_username"])
        except Exception:
            username = "***"

    return EmailConfigResponse(
        smtp_host=row["smtp_host"],
        smtp_port=row["smtp_port"],
        smtp_username=username,
        smtp_password="********" if row["is_configured"] else "",
        from_address=row["from_address"],
        from_name=row["from_name"],
        use_tls=row["use_tls"],
        is_configured=row["is_configured"],
        updated_at=row["updated_at"],
    ).model_dump(mode="json")


@router.put("/email-config")
async def update_email_config(
    body: EmailConfigUpdate,
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
):
    pool = await db.get_pool()
    encrypted_username = encrypt_pii(body.smtp_username) if body.smtp_username else ""
    encrypted_password = encrypt_pii(body.smtp_password) if body.smtp_password else ""

    await pool.execute(
        "UPDATE email_config SET "
        "smtp_host = $1, smtp_port = $2, smtp_username = $3, smtp_password = $4, "
        "from_address = $5, from_name = $6, use_tls = $7, is_configured = TRUE "
        "WHERE id = 1",
        body.smtp_host, body.smtp_port, encrypted_username, encrypted_password,
        body.from_address, body.from_name, body.use_tls,
    )
    await _audit_log("EMAIL_CONFIG_UPDATED", current_user.sub, "email-config")
    return {"status": "updated"}


@router.post("/email-config/test")
async def test_email_config(
    request: Request,
    current_user: Annotated[TokenPayload, Depends(require_role(Role.ADMIN))],
    recipient: str = "",
):
    """Send a test email using the stored SMTP config. Pass ?recipient=email@example.com"""
    pool = await db.get_pool()
    row = await pool.fetchrow("SELECT * FROM email_config WHERE id = 1")
    if row is None or not row["is_configured"]:
        raise HTTPException(status_code=400, detail="Email not configured yet")

    if not recipient:
        raise HTTPException(status_code=422, detail="recipient query parameter is required")

    try:
        smtp_username = decrypt_pii(row["smtp_username"]) if row["smtp_username"] else ""
        smtp_password = decrypt_pii(row["smtp_password"]) if row["smtp_password"] else ""
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt SMTP credentials")

    payload = {
        "channel": "email",
        "recipient": recipient,
        "message": "AeroNet OS -- Test email notification",
        "severity": "INFO",
        "smtp_host": row["smtp_host"],
        "smtp_port": row["smtp_port"],
        "smtp_username": smtp_username,
        "smtp_password": smtp_password,
        "from_address": row["from_address"],
        "from_name": row["from_name"],
        "use_tls": row["use_tls"],
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{NOTIFIER_URL}/notify/dispatch", json=payload)
            if resp.status_code < 300:
                await _audit_log("EMAIL_TEST_SENT", current_user.sub, "email-config", recipient)
                return {"status": "sent", "recipient": recipient}
            else:
                error = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
                return {"status": "failed", "error": str(error)}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
