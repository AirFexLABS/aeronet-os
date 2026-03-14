# Secrets setup guide

This document explains how to obtain and generate every value in `.env.secret`.
Work through each section before running `./scripts/start.sh`.

## Quick reference

| Variable | Source | Required |
|---|---|---|
| SECRET_KEY | Generated (openssl) | Yes |
| POSTGRES_PASSWORD | Generated (openssl) | Yes |
| CREDENTIALS_ENCRYPTION_KEY | Generated (Fernet) | Yes |
| GRAFANA_ADMIN_PASSWORD | Generated (openssl) | Yes |
| GRAFANA_ADMIN_USER | Static (default: admin) | Yes |
| MIST_API_TOKEN | Juniper MIST console | Yes |
| MIST_SITE_ID | Juniper MIST console | Yes |
| TWILIO_ACCOUNT_SID | Twilio console | Yes |
| TWILIO_AUTH_TOKEN | Twilio console | Yes |
| TWILIO_FROM_NUMBER | Twilio console | Yes |
| TWILIO_TO_NUMBER | Your ops phone | Yes |
| TELEGRAM_BOT_TOKEN | Telegram @BotFather | Yes |
| TELEGRAM_CHAT_ID | Telegram API | Yes |
| SCAN_TARGETS | Your network CIDRs | Yes |
| SCAN_INTERVAL_MINUTES | Static (default: 30) | No |
| NOTIFIER_URL | Static | No |
| ENROLLER_URL | Static | No |
| PORTAL_PORT | Static (default: 8080) | No |
| GRAFANA_URL | Static | No |

## Generated secrets (create these first)

### SECRET_KEY

Used for: JWT signing (api-gateway), Grafana secret key, portal JWT validation.
Must be identical across api-gateway, portal, and grafana services.

```bash
openssl rand -hex 32
```

### POSTGRES_PASSWORD

Used for: PostgreSQL superuser password and Grafana datasource connection.

```bash
openssl rand -base64 24 | tr -d '/+='
```

### CREDENTIALS_ENCRYPTION_KEY

Used for: Fernet encryption of device SSH credentials stored in the DB.

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Or use the helper script:

```bash
bash scripts/generate-fernet-key.sh
```

**Warning:** Losing this key means all stored device credentials become unrecoverable.
Back it up securely before deploying.

### GRAFANA_ADMIN_PASSWORD

Used for: Grafana admin login and portal basic-auth injection.

```bash
openssl rand -base64 16 | tr -d '/+='
```

## Juniper MIST

1. Log in to [manage.mist.com](https://manage.mist.com)
2. Navigate to Organization > Settings > API Token
3. Click "Create Token" — choose Read-Only scope
4. Copy the token value > `MIST_API_TOKEN`
5. Navigate to the target site > copy the UUID from the URL > `MIST_SITE_ID`

## Twilio

1. Log in to [console.twilio.com](https://console.twilio.com)
2. From the dashboard copy: Account SID > `TWILIO_ACCOUNT_SID`
3. Click "Show" on Auth Token > `TWILIO_AUTH_TOKEN`
4. Buy or use an existing SMS-capable number > `TWILIO_FROM_NUMBER` (E.164: +12125551234)
5. Set the destination number > `TWILIO_TO_NUMBER` (E.164 format)

Note: CRITICAL alerts only. Use Twilio test credentials in CI (no real SMS sent).

## Telegram

1. Message @BotFather on Telegram
2. Send `/newbot` and follow prompts > copy the token > `TELEGRAM_BOT_TOKEN`
3. Add the bot to your ops group/channel
4. Get the chat ID:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

Look for `"chat":{"id": ...}` in the response > `TELEGRAM_CHAT_ID`

Note: negative IDs are group chats, positive IDs are direct messages.

## GitHub CD deployment

| Secret | How to obtain |
|---|---|
| DEPLOY_HOST | IP or hostname of the target server |
| DEPLOY_USER | SSH username (must have docker group membership) |
| DEPLOY_SSH_KEY | See below |

Generate a dedicated deploy keypair:

```bash
ssh-keygen -t ed25519 -C "aeronet-github-actions" -f ~/.ssh/aeronet_deploy
cat ~/.ssh/aeronet_deploy       # paste as DEPLOY_SSH_KEY in GitHub Secrets
cat ~/.ssh/aeronet_deploy.pub   # add to ~/.ssh/authorized_keys on the server
```
