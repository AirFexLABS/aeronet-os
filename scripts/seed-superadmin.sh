#!/usr/bin/env bash
# Seeds the superadmin user into the database.
# Run ONCE after the stack is first started.
# Usage: ./scripts/seed-superadmin.sh <password>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <password>"
  echo "Example: $0 'MyStr0ngP@ssword!'"
  exit 1
fi

PASSWORD="$1"
ENV_FILE=".env.secret"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env.secret not found"
  exit 1
fi

HASH=$(python3 -c "
import bcrypt, sys
pw = sys.argv[1].encode()
print(bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode())
" "$PASSWORD")

docker exec -i aeronet-postgres psql \
  -U aeronet -d aeronet << SQL
INSERT INTO users (username, email, hashed_password, role, is_active)
VALUES (
  'superadmin',
  'admin@aeronet.local',
  '$HASH',
  'admin',
  true
)
ON CONFLICT (username) DO UPDATE
  SET hashed_password = EXCLUDED.hashed_password,
      role            = EXCLUDED.role,
      is_active       = EXCLUDED.is_active;
SQL

echo ""
echo "Superadmin user seeded."
echo "   Username: superadmin"
echo "   Role:     admin"
echo ""
echo "Store this password securely. Use ./scripts/rotate-secrets.sh to rotate later."
