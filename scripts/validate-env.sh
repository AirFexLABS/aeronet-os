#!/usr/bin/env bash
# Validates .env.secret before stack startup.
# Checks: file exists, no empty required values, key format validation.
set -euo pipefail

ENV_FILE=".env.secret"
PASS=0
FAIL=0

check_set() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [ -z "$val" ]; then
    echo "  FAIL $key — not set"
    ((FAIL++))
  else
    echo "  OK   $key"
    ((PASS++))
  fi
}

check_length() {
  local key="$1"
  local min="$2"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [ ${#val} -lt "$min" ]; then
    echo "  FAIL $key — too short (${#val} chars, min $min)"
    ((FAIL++))
  else
    echo "  OK   $key (${#val} chars)"
    ((PASS++))
  fi
}

check_e164() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [[ ! "$val" =~ ^\+[1-9][0-9]{7,14}$ ]]; then
    echo "  FAIL $key — not valid E.164 format (expected +1234567890)"
    ((FAIL++))
  else
    echo "  OK   $key"
    ((PASS++))
  fi
}

echo ""
echo "AeroNet OS — environment validation"
echo "====================================="

if [ ! -f "$ENV_FILE" ]; then
  echo "FAIL $ENV_FILE not found. Copy .env.secret.example first."
  exit 1
fi

echo ""
echo "Generated secrets:"
check_length "SECRET_KEY"                 32
check_length "POSTGRES_PASSWORD"          12
check_length "CREDENTIALS_ENCRYPTION_KEY" 44
check_length "GRAFANA_ADMIN_PASSWORD"     8

echo ""
echo "Juniper MIST:"
check_set "MIST_API_TOKEN"
check_set "MIST_SITE_ID"

echo ""
echo "Twilio:"
check_set    "TWILIO_ACCOUNT_SID"
check_set    "TWILIO_AUTH_TOKEN"
check_e164   "TWILIO_FROM_NUMBER"
check_e164   "TWILIO_TO_NUMBER"

echo ""
echo "Telegram:"
check_set "TELEGRAM_BOT_TOKEN"
check_set "TELEGRAM_CHAT_ID"

echo ""
echo "Grafana:"
check_set "GRAFANA_ADMIN_USER"
check_set "GRAFANA_ADMIN_PASSWORD"

echo ""
echo "Services:"
check_set "NOTIFIER_URL"
check_set "ENROLLER_URL"
check_set "POSTGRES_PASSWORD"

echo ""
echo "====================================="
if [ "$FAIL" -eq 0 ]; then
  echo "All $PASS checks passed — .env.secret is ready."
  exit 0
else
  echo "$FAIL check(s) failed. Fix before running start.sh."
  exit 1
fi
