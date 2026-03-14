#!/usr/bin/env bash
# Run the full smoke test suite against a live docker compose stack.
# Usage: ./tests/run_smoke.sh [--up] [--down]
set -euo pipefail

# Port exposure for smoke tests is handled via docker-compose.override.yml.
# The override file adds host port mappings for notifier (:8001) and
# enroller (:8002) that are NOT present in the production compose file.
# In CI environments without the override file, set:
#   TEST_NOTIFIER_URL=http://localhost:8001
#   TEST_ENROLLER_URL=http://localhost:8002
# and ensure those ports are forwarded by your CI networking layer.

COMPOSE_FILE="infra/docker-compose.yml"
ENV_FILE=".env.secret"

if [[ "${1:-}" == "--up" ]]; then
  echo "▶ Starting stack..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
  echo "⏳ Waiting 15s for services to initialize..."
  sleep 15
fi

echo "🧪 Running smoke tests..."
pytest tests/smoke/ -v --timeout=30 --tb=short

if [[ "${1:-}" == "--down" || "${2:-}" == "--down" ]]; then
  echo "▶ Tearing down stack..."
  docker compose -f "$COMPOSE_FILE" down
fi
