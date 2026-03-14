#!/usr/bin/env bash
# Pre-flight check: validates all smoke test preconditions before running pytest.
# Run this before ./run_smoke.sh to catch configuration issues early.
set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  ✅ $label"
    ((PASS++))
  else
    echo "  ❌ $label"
    ((FAIL++))
  fi
}

echo ""
echo "AeroNet OS — Smoke Test Pre-flight"
echo "==================================="

echo ""
echo "▶ Services reachable:"
check "api-gateway  :8000 /health" "curl -sf http://localhost:8000/health"
check "notifier     :8001 /health" "curl -sf http://localhost:8001/health"
check "enroller     :8002 /health" "curl -sf http://localhost:8002/health"
check "portal       :8080 /health" "curl -sf http://localhost:8080/health"
check "frontend     :5173 /"       "curl -sf http://localhost:5173/"
check "grafana      :3000 /api/health" \
  "curl -sf -u admin:\${GRAFANA_ADMIN_PASSWORD:-admin} http://localhost:3000/api/health"

echo ""
echo "▶ Database reachable:"
check "postgres :5432" \
  "pg_isready -h localhost -p 5432 -U aeronet -d aeronet"

echo ""
echo "▶ Required env vars set:"
for var in POSTGRES_PASSWORD MIST_API_TOKEN MIST_SITE_ID \
           NOTIFIER_URL ENROLLER_URL SECRET_KEY; do
  check "$var is set" "[ -n \"\${$var:-}\" ]"
done

echo ""
echo "▶ Required files present:"
check ".env.secret exists"             "[ -f .env.secret ]"
check "docker-compose.override.yml"    "[ -f infra/docker-compose.override.yml ]"
check "tests/requirements-test.txt"    "[ -f tests/requirements-test.txt ]"

echo ""
echo "==================================="
if [ "$FAIL" -eq 0 ]; then
  echo "✅ All $PASS checks passed — safe to run smoke tests."
  exit 0
else
  echo "❌ $FAIL check(s) failed. Fix blockers before running pytest."
  exit 1
fi
