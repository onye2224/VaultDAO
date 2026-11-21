#!/usr/bin/env bash
# ==============================================================================
# VaultDAO Production Smoke Test
# ==============================================================================
# Spins up the production compose stack, waits for both services to become
# healthy, runs basic endpoint checks, then tears down.
#
# Usage:
#   bash scripts/smoke-test.sh
#
# Prerequisites: docker, curl (or wget), bash >= 4

set -euo pipefail

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
BACKEND_URL="http://localhost:8787"
FRONTEND_URL="http://localhost:8080"
TIMEOUT=90   # seconds to wait for healthy status

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

wait_healthy() {
  local service="$1"
  local elapsed=0
  echo "Waiting for '$service' to become healthy (timeout ${TIMEOUT}s)…"
  while true; do
    status=$(docker compose $COMPOSE_FILES ps --format json "$service" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || true)
    # Fallback for older compose versions
    if [[ -z "$status" ]]; then
      status=$(docker inspect --format='{{.State.Health.Status}}' "vaultdao-${service}" 2>/dev/null || true)
    fi
    [[ "$status" == "healthy" ]] && { pass "'$service' is healthy"; return 0; }
    [[ $elapsed -ge $TIMEOUT ]] && fail "'$service' did not become healthy within ${TIMEOUT}s (last status: ${status:-unknown})"
    sleep 3
    elapsed=$((elapsed + 3))
  done
}

# ── Bring up the stack ────────────────────────────────────────────────────────

echo "==> Building and starting production stack…"
docker compose $COMPOSE_FILES up -d --build

# ── Wait for services ─────────────────────────────────────────────────────────

wait_healthy backend
wait_healthy frontend

# ── Backend checks ────────────────────────────────────────────────────────────

echo ""
echo "==> Backend endpoint checks (${BACKEND_URL})"

status=$(curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/health")
[[ "$status" == "200" ]] && pass "/health → HTTP $status" || fail "/health returned HTTP $status"

# ── Frontend / header regression checks ──────────────────────────────────────

echo ""
echo "==> Frontend header regression checks (${FRONTEND_URL})"
bash "$(dirname "$0")/check-headers.sh" "$FRONTEND_URL"

# ── SPA fallback check ────────────────────────────────────────────────────────

echo ""
echo "==> SPA fallback check"
status=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_URL}/some/deep/client-route")
[[ "$status" == "200" ]] && pass "Deep route falls back to index.html (HTTP $status)" \
  || fail "SPA fallback failed – expected 200, got $status"

# ── Teardown ──────────────────────────────────────────────────────────────────

echo ""
echo "==> Tearing down stack…"
docker compose $COMPOSE_FILES down -v

echo ""
echo "All smoke checks passed."
