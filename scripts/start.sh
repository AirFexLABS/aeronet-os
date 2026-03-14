#!/usr/bin/env bash
# Production startup script. Validates prerequisites then starts the stack.
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.yml"
ENV_FILE=".env.secret"

echo "AeroNet OS — Production Start"
echo "================================="

# 1. Validate .env.secret
echo "Validating environment..."
bash scripts/validate-env.sh || {
  echo ""
  echo "Environment validation failed. Fix .env.secret before starting."
  exit 1
}

# 2. Check TLS certs exist
if [ ! -f "infra/nginx/certs/aeronet.crt" ]; then
  echo "TLS certs not found. Generating self-signed certs..."
  bash infra/nginx/generate-certs.sh
fi

# 3. Pull images
echo "Pulling latest images..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

# 4. Start stack
echo "Starting stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# 5. Wait for postgres health
echo "Waiting for postgres to be healthy..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres \
       pg_isready -U aeronet -d aeronet &>/dev/null; then
    echo "  Postgres ready."
    break
  fi
  [ "$i" -eq 30 ] && { echo "Postgres did not become healthy in 30s."; exit 1; }
  sleep 2
done

# 6. Run preflight
echo "Running preflight checks..."
sleep 10
bash tests/smoke/preflight.sh

echo ""
echo "AeroNet OS is running."
echo "  Frontend: https://aeronet.local"
echo "  API:      https://api.aeronet.local"
echo "  Grafana:  https://grafana.aeronet.local"
