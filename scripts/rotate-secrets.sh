#!/usr/bin/env bash
# Rotates all secrets in .env.secret.
# Generates new cryptographically random values for SECRET_KEY and POSTGRES_PASSWORD.
# Does NOT rotate external API keys (MIST, Twilio, Telegram) — do those manually.
set -euo pipefail

ENV_FILE=".env.secret"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. Copy .env.secret.example first."
  exit 1
fi

echo "This will rotate SECRET_KEY and POSTGRES_PASSWORD in $ENV_FILE."
echo "After rotation you must restart the stack and update the DB password manually."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

NEW_SECRET_KEY=$(openssl rand -hex 32)
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=')

sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=${NEW_SECRET_KEY}|"           "$ENV_FILE"
sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|" "$ENV_FILE"
rm -f "${ENV_FILE}.bak"

echo ""
echo "Rotated in $ENV_FILE:"
echo "  SECRET_KEY        -> (new 64-char hex)"
echo "  POSTGRES_PASSWORD -> (new 32-char base64)"
echo ""
echo "Next steps:"
echo "  1. Update PostgreSQL user password:"
echo "     docker exec -it aeronet-postgres psql -U aeronet -c \\"
echo "       \"ALTER USER aeronet PASSWORD '${NEW_PG_PASS}';\""
echo "  2. Restart the stack: docker compose restart"
echo "  3. Update POSTGRES_PASSWORD in GitHub Secrets if using CD pipeline."
