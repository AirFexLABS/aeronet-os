# GitHub Actions Secrets

Set these in: Repository → Settings → Secrets and variables → Actions

## CI Secrets (used by ci.yml smoke tests)
| Secret | Description |
|---|---|
| CI_POSTGRES_PASSWORD | Test database password |
| CI_SECRET_KEY | FastAPI JWT signing key (test value) |
| CI_MIST_API_TOKEN | Juniper MIST API token (use a read-only test token) |
| CI_MIST_SITE_ID | MIST site UUID for CI test environment |
| CI_TWILIO_ACCOUNT_SID | Twilio SID (use test credentials — no real SMS sent when SMOKE_TEST=true) |
| CI_TWILIO_AUTH_TOKEN | Twilio auth token |
| CI_TELEGRAM_BOT_TOKEN | Telegram bot token (messages suppressed in CI) |
| CI_GRAFANA_ADMIN_PASSWORD | Grafana admin password for CI stack |

## CD Secrets (used by cd.yml deploy)
| Secret | Description |
|---|---|
| DEPLOY_HOST | IP or hostname of the production/staging server |
| DEPLOY_USER | SSH username on the target server |
| DEPLOY_SSH_KEY | Private SSH key (ed25519 recommended) — public key must be in authorized_keys on host |

## Phase 14 Secrets

| Secret | Description |
|---|---|
| CREDENTIALS_ENCRYPTION_KEY | Fernet key for device credential encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| TELEGRAM_CHAT_ID | Target chat/group ID. Find via @userinfobot |
| TWILIO_FROM_NUMBER | Your Twilio SMS-capable phone number (E.164 format, e.g. +12125551234) |
| TWILIO_TO_NUMBER | Destination SMS number for CRITICAL alerts (E.164 format) |
| SCAN_TARGETS | Comma-separated CIDR blocks to scan (not secret but env-configured) |

## Notes
- GITHUB_TOKEN is provided automatically by GitHub Actions — do not add it manually.
- Twilio and Telegram messages are suppressed in CI via the SMOKE_TEST=true env var.
  Guard in notifier/app/main.py:
    `if os.getenv("SMOKE_TEST") == "true": return {"status": "suppressed"}`
- Rotate CI_SECRET_KEY and CI_POSTGRES_PASSWORD quarterly.
- Never use production MIST_API_TOKEN in CI — create a read-only token scoped to a test site.
