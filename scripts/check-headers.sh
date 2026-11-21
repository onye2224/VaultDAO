#!/usr/bin/env bash
# ==============================================================================
# VaultDAO – HTTP Security Header Regression Check
# ==============================================================================
# Verifies that the frontend Nginx image emits the required security headers.
# Usable standalone or called from scripts/smoke-test.sh.
#
# Usage:
#   bash scripts/check-headers.sh [URL]          # defaults to http://localhost:8080
#
# Exit code: 0 all required headers present, 1 one or more missing/wrong.

set -euo pipefail

URL="${1:-http://localhost:8080}"

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; FAILED=1; }

FAILED=0

# Fetch only headers
HEADERS=$(curl -sI "$URL")

check_header() {
  local name="$1"
  local pattern="$2"   # grep -iE pattern against the header value
  local line
  line=$(echo "$HEADERS" | grep -i "^${name}:" || true)
  if [[ -z "$line" ]]; then
    fail "Missing header: ${name}"
  elif echo "$line" | grep -iqE "$pattern"; then
    pass "${name}: $(echo "$line" | cut -d: -f2- | xargs)"
  else
    fail "${name} present but value does not match /${pattern}/: $(echo "$line" | cut -d: -f2- | xargs)"
  fi
}

echo "Checking security headers on ${URL} …"
echo ""

check_header "X-Frame-Options"        "DENY"
check_header "X-Content-Type-Options" "nosniff"
check_header "Referrer-Policy"        "strict-origin-when-cross-origin"
check_header "Permissions-Policy"     "geolocation"
check_header "Content-Security-Policy" "default-src"

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "All security headers present."
else
  echo "One or more security headers missing or incorrect." >&2
  exit 1
fi
