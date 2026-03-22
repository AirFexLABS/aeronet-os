# AeroNet OS — Claude Code Briefing: Alerts Setup Feature

> **Purpose:** This document provides complete, unambiguous instructions for Claude Code to implement the **Alerts Setup** feature in AeroNet OS. Read it fully before writing any code.

---

## 1. Feature Overview

Add a new **Alerts Setup** page to the AeroNet OS frontend that allows an `admin`-role user to manage alert contacts — the people who receive notifications when the system generates audit events. Each contact can have multiple channels (Email, SMS, WhatsApp, Telegram), each with its own independently configured severity threshold.

This feature touches:
- **PostgreSQL** — two new tables
- **API Gateway** (FastAPI) — new router with CRUD + test-fire endpoints
- **Notifier** (FastAPI) — new dispatch endpoint that accepts contacts dynamically
- **Frontend** (React + TypeScript + Tailwind) — new page at `/alerts-setup`

---

## 2. Architecture Decision: API Gateway as Intermediary

**Recommendation adopted:** The API Gateway intermediates between contacts storage and the Notifier. This is the cleanest approach for this system because:

- The Notifier remains stateless and channel-agnostic — it already handles Telegram and Twilio; it just needs to accept dynamic recipient details instead of reading from env vars.
- Contact PII never leaves the API Gateway to the Notifier in bulk — only the specific contact details for a given alert event are passed at dispatch time.
- Audit trail (ISO 27001 compliance) stays centralised in the API Gateway.
- The `.env.secret` Telegram/Twilio credentials (bot token, account SID, auth token, from-numbers) remain as **service credentials** (how to send), while the new DB contacts table stores **recipient details** (who to send to).

**Flow at alert time:**
```
audit_log INSERT → API Gateway polls/triggers → reads active contacts from DB
→ decrypts PII → calls POST /notify/dispatch on Notifier with {channel, recipient, severity, message}
→ Notifier sends via Telegram / Twilio SMS / Twilio WhatsApp
```

---

## 3. GDPR & Encryption

- All PII fields (email address, phone numbers, Telegram chat IDs) **must be Fernet-encrypted at rest** in PostgreSQL.
- Use a **new, separate** Fernet key: `ALERT_CONTACTS_ENCRYPTION_KEY` — add to `.env.secret`. Do **not** reuse `CREDENTIALS_ENCRYPTION_KEY`.
- The API Gateway decrypts PII only when dispatching a notification or when the admin explicitly views a contact (masked display — see Section 7).
- No PII is ever logged in `audit_logs` in plaintext — log contact `id` (UUID) only.
- Contact records must be deletable (right to erasure). Deletion is hard-delete, not soft-delete.
- No PII is returned to the frontend in bulk list responses — phone/email/Telegram fields are masked (see Section 7).

---

## 4. Database Schema

### 4.1 New environment variable

Add to `.env.secret`:
```
ALERT_CONTACTS_ENCRYPTION_KEY=   # New Fernet key — generate with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add to the API Gateway container's `environment` block in `docker-compose.yml`.

### 4.2 Migration SQL

Create file: `migrations/004_alert_contacts.sql`

```sql
-- Alert contacts table
CREATE TABLE alert_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    TEXT NOT NULL,                    -- plaintext, non-PII label e.g. "NOC Engineer 1"
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-contact channels table (one row per channel per contact)
CREATE TABLE alert_contact_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID NOT NULL REFERENCES alert_contacts(id) ON DELETE CASCADE,
    channel_type    TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'telegram')),
    -- PII fields — stored Fernet-encrypted, base64 encoded
    recipient_value TEXT NOT NULL,   -- encrypted email / phone number / telegram chat ID
    -- WhatsApp-specific: whether to use the same Twilio number or a separate sender
    whatsapp_use_separate_sender BOOLEAN DEFAULT FALSE,
    whatsapp_sender_number       TEXT,  -- encrypted, nullable — only used if above is TRUE
    -- Severity threshold for this specific channel
    -- Values: 'INFO' | 'WARNING' | 'CRITICAL'
    -- Semantics: notify on this level AND above (INFO = all; WARNING = WARNING+CRITICAL; CRITICAL = CRITICAL only)
    min_severity    TEXT NOT NULL DEFAULT 'WARNING' CHECK (min_severity IN ('INFO', 'WARNING', 'CRITICAL')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, channel_type)   -- one row per channel type per contact
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_contacts_updated_at
    BEFORE UPDATE ON alert_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER alert_contact_channels_updated_at
    BEFORE UPDATE ON alert_contact_channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit log entries for contact management
-- Reuse existing audit_logs table with new action types:
-- CONTACT_CREATED, CONTACT_UPDATED, CONTACT_DELETED, CONTACT_TEST_SENT
```

Apply with:
```bash
docker exec -i aeronet-postgres psql -U aeronet -d aeronet < migrations/004_alert_contacts.sql
```

---

## 5. API Gateway — New Router

Create: `routers/alert_contacts.py`

All endpoints require **`admin` role** (enforce via existing RBAC dependency, same pattern as vault endpoints).

### 5.1 Pydantic Models

```python
# Severity ordering for threshold comparison
SEVERITY_ORDER = {'INFO': 0, 'WARNING': 1, 'CRITICAL': 2}

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
    recipient_value: str          # plaintext — will be encrypted before storage
    min_severity: MinSeverity = MinSeverity.WARNING
    whatsapp_use_separate_sender: bool = False
    whatsapp_sender_number: Optional[str] = None   # plaintext — encrypted before storage

class ContactCreate(BaseModel):
    display_name: str
    is_active: bool = True
    channels: List[ChannelCreate]   # at least one required — validate in endpoint

class ChannelResponse(BaseModel):
    id: UUID
    channel_type: ChannelType
    recipient_value: str          # MASKED on list/get — see masking rules below
    min_severity: MinSeverity
    whatsapp_use_separate_sender: bool
    is_active: bool

class ContactResponse(BaseModel):
    id: UUID
    display_name: str
    is_active: bool
    channels: List[ChannelResponse]
    created_at: datetime
    updated_at: datetime
```

**Masking rules for `recipient_value` in responses:**
- Email: show first 2 chars + `***@` + domain → `jo***@example.com`
- Phone / WhatsApp: show last 4 digits → `+******1234`
- Telegram chat ID: show first 4 chars → `1234***`

Provide a separate `GET /alert-contacts/{id}/reveal/{channel_id}` endpoint (ADMIN only) that returns the **full decrypted** value for a single channel — used when admin clicks "Show" in the UI. Log this action to `audit_logs` with action `CONTACT_CHANNEL_REVEALED`.

### 5.2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/alert-contacts` | List all contacts (PII masked) |
| `POST` | `/alert-contacts` | Create contact + channels |
| `GET` | `/alert-contacts/{id}` | Get single contact (PII masked) |
| `PUT` | `/alert-contacts/{id}` | Update contact name / active status |
| `DELETE` | `/alert-contacts/{id}` | Hard-delete contact + cascade channels |
| `POST` | `/alert-contacts/{id}/channels` | Add a channel to existing contact |
| `PUT` | `/alert-contacts/{id}/channels/{channel_id}` | Update channel (threshold, active status) |
| `DELETE` | `/alert-contacts/{id}/channels/{channel_id}` | Remove a channel |
| `GET` | `/alert-contacts/{id}/reveal/{channel_id}` | Return full decrypted recipient value |
| `POST` | `/alert-contacts/{id}/test` | Send test notification to all active channels of this contact |

### 5.3 Encryption Helper

Use the existing pattern from the vault router. Import `ALERT_CONTACTS_ENCRYPTION_KEY` from env and instantiate a separate `Fernet` object — do **not** share the vault's Fernet instance.

```python
from cryptography.fernet import Fernet
import os

_alert_fernet = Fernet(os.environ["ALERT_CONTACTS_ENCRYPTION_KEY"].encode())

def encrypt_pii(value: str) -> str:
    return _alert_fernet.encrypt(value.encode()).decode()

def decrypt_pii(value: str) -> str:
    return _alert_fernet.decrypt(value.encode()).decode()
```

### 5.4 Audit Logging

Write to `audit_logs` for every mutation and test-send. Use existing `audit_logs` insert pattern. Log the contact UUID as `device_serial` (or add a nullable `entity_id` column if one doesn't exist — check existing schema). Action types:

- `CONTACT_CREATED`
- `CONTACT_UPDATED`
- `CONTACT_DELETED`
- `CONTACT_CHANNEL_ADDED`
- `CONTACT_CHANNEL_UPDATED`
- `CONTACT_CHANNEL_DELETED`
- `CONTACT_CHANNEL_REVEALED`
- `CONTACT_TEST_SENT`

### 5.5 Test Notification Endpoint Logic

`POST /alert-contacts/{id}/test`:
1. Fetch contact + decrypt all channels.
2. For each active channel, call `POST http://notifier:8001/notify/dispatch` with:
```json
{
  "channel": "telegram|sms|whatsapp|email",
  "recipient": "<decrypted_value>",
  "message": "AeroNet OS — Test notification for contact: <display_name>",
  "severity": "INFO",
  "whatsapp_use_separate_sender": false,
  "whatsapp_sender_number": null
}
```
3. Collect results per channel and return a summary:
```json
{
  "results": [
    { "channel_id": "...", "channel_type": "telegram", "success": true, "error": null },
    { "channel_id": "...", "channel_type": "sms", "success": false, "error": "Twilio error 21211" }
  ]
}
```
4. Log to `audit_logs` regardless of success/failure.

### 5.6 Register Router

In `main.py`, add:
```python
from routers.alert_contacts import router as alert_contacts_router
app.include_router(alert_contacts_router, prefix="/alert-contacts", tags=["alert-contacts"])
```

---

## 6. Notifier Service — New Dispatch Endpoint

The Notifier currently reads Telegram/Twilio config from env vars and sends to a single hardcoded recipient. Add a new endpoint that accepts dynamic recipient details.

Create or extend: `routers/dispatch.py` in the notifier service.

### 6.1 New Endpoint

`POST /notify/dispatch`

```python
class DispatchRequest(BaseModel):
    channel: str   # "telegram" | "sms" | "whatsapp" | "email"
    recipient: str  # chat_id / phone number / email address
    message: str
    severity: str   # "INFO" | "WARNING" | "CRITICAL"
    whatsapp_use_separate_sender: bool = False
    whatsapp_sender_number: Optional[str] = None

@router.post("/notify/dispatch")
async def dispatch(req: DispatchRequest):
    if req.channel == "telegram":
        # Use existing TELEGRAM_BOT_TOKEN from env
        # bot.send_message(chat_id=req.recipient, text=req.message)
        ...
    elif req.channel == "sms":
        # Use TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER from env
        # client.messages.create(to=req.recipient, from_=from_num, body=req.message)
        ...
    elif req.channel == "whatsapp":
        if req.whatsapp_use_separate_sender and req.whatsapp_sender_number:
            from_num = req.whatsapp_sender_number
        else:
            from_num = f"whatsapp:{os.environ['TWILIO_FROM_NUMBER']}"
        # client.messages.create(to=f"whatsapp:{req.recipient}", from_=from_num, body=req.message)
        ...
    elif req.channel == "email":
        # Email not yet implemented — return 501 Not Implemented with message
        # "Email dispatch not yet configured. Add SMTP settings to enable."
        raise HTTPException(status_code=501, detail="Email dispatch not yet implemented")
    return {"status": "sent"}
```

> **Note on Email:** Email support is scaffolded (channel type stored in DB, UI supports it) but the actual SMTP dispatch returns 501. Add a visible note in the UI that email alerts require SMTP configuration (future work). This keeps the feature complete without blocking deployment.

This endpoint is **internal only** — it is NOT exposed through nginx. It is called only by the API Gateway over the Docker internal network (`http://notifier:8001`).

---

## 7. Frontend — Alerts Setup Page

### 7.1 Route & Access

- Route: `/alerts-setup`
- Add to `react-router-dom` routes in `App.tsx` — wrap with the existing admin-only guard (same pattern as `/vault`).
- Add to the left sidebar navigation, below "Vault", visible only when `user.role === 'admin'`.
- Label: **"Alerts Setup"** with a bell or user-with-bell icon (use an icon from the existing icon set already in the project).

### 7.2 Page Layout

The page has two main areas:

**Header bar:**
- Page title: "Alerts Setup"
- Subtitle: "Manage who receives alert notifications and on which channels."
- Primary CTA button: `+ Add Contact` (top-right) — opens the Add Contact panel.

**Contact cards list:**
- Each contact is a card showing:
  - Contact display name (bold)
  - Active/inactive toggle (pill badge: green "Active" / grey "Inactive") — clicking toggles `is_active` via `PUT /alert-contacts/{id}`
  - Row of channel chips showing configured channels (Email, SMS, WhatsApp, Telegram) with their threshold badges
  - Action buttons: **Edit**, **Test**, **Delete**
- Empty state: "No alert contacts configured. Add your first contact to start receiving notifications."

### 7.3 Add / Edit Contact — Side Panel (Drawer)

Open as a right-side drawer (not a modal). The drawer has two sections:

**Section 1 — Contact Details**
- Field: `Display Name` (text input, required, max 80 chars) — this is a non-PII label for internal use (e.g. "NOC Duty Engineer", "Airport Manager")
- Toggle: `Active` (on/off)

**Section 2 — Notification Channels**

Sub-header: "Notification Channels — at least one required"

The admin can add one or more channels. Each channel is a collapsible row/card within the drawer. Render an `+ Add Channel` button that appends a new channel form row.

**Per-channel form row:**

| Field | Type | Notes |
|-------|------|-------|
| Channel Type | Select dropdown | Options: Email, Phone (SMS), Phone (WhatsApp), Telegram |
| Recipient | Text input | Label changes based on channel: "Email address" / "Phone number (E.164 format, e.g. +521234567890)" / "Telegram Chat ID" |
| Severity Threshold | Select dropdown | Options: INFO (all alerts), WARNING and above, CRITICAL only |
| Active | Toggle | Per-channel active switch |
| [WhatsApp only] Use separate sender number | Checkbox | When ticked, reveals an additional text input: "WhatsApp sender number (E.164)" |
| Remove channel | ✕ icon button | Removes this channel row (cannot remove if it's the only one) |
| [WhatsApp only] Activation notice | Inline info banner | See note below |

> **WhatsApp channel — UI activation notice:** When the admin selects "Phone (WhatsApp)" as the channel type, display a persistent inline info banner beneath the recipient field:
>
> _"⚠️ WhatsApp requires your Twilio number to be WhatsApp-enabled. For testing, activate the Twilio WhatsApp Sandbox at console.twilio.com → Messaging → Try it out → Send a WhatsApp message. For production, a Meta Business API approval is required. SMS will work immediately with no extra setup."_
>
> Style as a blue/amber info box (not an error). It should always be visible when the WhatsApp channel type is selected — not dismissible.

**Validation (client-side):**
- Display name: required, non-empty
- At least one channel must be present and active
- Email: basic email format validation
- Phone: must start with `+` and contain only digits after (E.164 hint)
- Telegram chat ID: must be numeric
- WhatsApp separate sender: required if checkbox is ticked

**Drawer footer buttons:**
- `Cancel` — closes drawer, discards changes
- `Save Contact` — submits, shows inline loading state, closes on success, refreshes list

### 7.4 Test Alert Button

Each contact card has a **Test** button (secondary, outline style). On click:
- Show a loading spinner on the button
- Call `POST /alert-contacts/{id}/test`
- Display a result toast/notification per channel:
  - ✅ "Test sent via Telegram" (green)
  - ❌ "SMS test failed: Twilio error 21211" (red)
- If email channel exists, show an inline note: "Email test skipped — SMTP not yet configured."

### 7.5 Delete Contact

Clicking **Delete** on a contact card:
- Shows a confirmation dialog: "Delete [display_name]? This will permanently remove the contact and all their notification channels. This action cannot be undone."
- Confirm button: "Delete" (red/destructive)
- On confirm: calls `DELETE /alert-contacts/{id}`, removes card from list on success.

### 7.6 Data Fetching

Use the existing SWR pattern (`useSWR`) already used across the project:
- `GET /alert-contacts` — contact list (PII masked, sufficient for card display)
- Mutate (revalidate) the list after any create / update / delete action.

### 7.7 Masked PII Display

In the contact card channel chips, show the masked values returned by the API:
- Phone: `+******1234`
- Email: `jo***@example.com`
- Telegram: `1234***`

Do **not** implement a "reveal" button in this phase — the reveal endpoint exists in the API but the UI for it is deferred.

### 7.8 Style & Component Guidelines

- Follow the existing Tailwind CSS dark-theme conventions already used in the project (match Vault page styling as reference).
- Channel type chips: use colour coding consistent with the existing severity badge system — or introduce neutral channel-type colours (e.g. blue for Telegram, green for WhatsApp, amber for SMS, purple for Email).
- Severity threshold badges inside chips: use the existing severity colour system (`CRITICAL` = red, `WARNING` = amber, `INFO` = blue/grey).
- The drawer overlay should dim the background (existing pattern if available, otherwise `bg-black/40`).
- All form inputs must follow the existing `input` class conventions in the project.

---

## 8. Sidebar Navigation Update

In the sidebar component (locate by searching for `Vault` nav item), add a new entry **below Vault**:

```tsx
{user?.role === 'admin' && (
  <NavLink to="/alerts-setup" ...>
    <BellAlertIcon className="..." />
    Alerts Setup
  </NavLink>
)}
```

Use the same conditional admin-guard pattern already applied to the Vault nav item.

---

## 9. Files to Create / Modify

### New files
| File | Description |
|------|-------------|
| `migrations/004_alert_contacts.sql` | DB migration — two new tables |
| `services/api-gateway/routers/alert_contacts.py` | New FastAPI router |
| `services/notifier/routers/dispatch.py` | New dynamic dispatch endpoint |
| `services/frontend/src/pages/AlertsSetup.tsx` | New React page |
| `services/frontend/src/hooks/useAlertContacts.ts` | SWR data hook (optional, if project uses hook files) |

### Modified files
| File | Change |
|------|--------|
| `services/api-gateway/main.py` | Register `alert_contacts_router` |
| `services/notifier/main.py` | Register dispatch router |
| `services/frontend/src/App.tsx` | Add `/alerts-setup` route |
| `services/frontend/src/components/Sidebar.tsx` | Add "Alerts Setup" nav item |
| `.env.secret` | Add `ALERT_CONTACTS_ENCRYPTION_KEY` |
| `infra/docker-compose.yml` | Expose `ALERT_CONTACTS_ENCRYPTION_KEY` to api-gateway container |

---

## 10. Deployment Steps (in order)

1. Generate the new Fernet key and add to `.env.secret`:
   ```bash
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
2. Apply the DB migration:
   ```bash
   docker exec -i aeronet-postgres psql -U aeronet -d aeronet < migrations/004_alert_contacts.sql
   ```
3. Rebuild the API Gateway and Notifier containers:
   ```bash
   cd /opt/aeronet-os
   docker compose -f infra/docker-compose.yml --env-file .env.secret build api-gateway notifier
   docker compose -f infra/docker-compose.yml --env-file .env.secret up -d api-gateway notifier
   ```
4. Rebuild and restart the frontend:
   ```bash
   docker compose -f infra/docker-compose.yml --env-file .env.secret build frontend
   docker compose -f infra/docker-compose.yml --env-file .env.secret up -d frontend
   ```
5. Verify endpoints in Swagger: `https://api.aeronet.local/docs` — confirm `/alert-contacts` routes appear under the `alert-contacts` tag.
6. Log in as admin to `https://aeronet.local` — confirm "Alerts Setup" appears in the sidebar.

---

## 11. Out of Scope (Defer to Future Work)

- SMTP / email dispatch implementation (endpoint scaffolded, returns 501)
- "Reveal" button in frontend for unmasking PII
- Alert dispatch trigger (the actual wiring of `audit_log` INSERT → dispatch loop) — this briefing covers the contacts management GUI and the dispatch endpoint; the trigger/polling mechanism is a separate feature
- Notification history / delivery log per contact
- Bulk import of contacts

---

## 12. Key Constraints Reminder

- **No role below `admin` may access any `/alert-contacts` endpoint or the `/alerts-setup` frontend route.**
- **PII is never stored in plaintext** — always encrypted with `ALERT_CONTACTS_ENCRYPTION_KEY` before INSERT/UPDATE.
- **PII is never logged** — audit log entries reference contact UUID only.
- **Hard delete** — no soft delete / `deleted_at` flag. Contact deletion is permanent and cascades to channels.
- **Email channel is scaffolded but dispatch returns 501** — the UI must display a clear note to the admin.
- **The Notifier's existing env-var-based Telegram/Twilio config remains unchanged** — the new dispatch endpoint reuses those service credentials but routes to dynamic recipients.
