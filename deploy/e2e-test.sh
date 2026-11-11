#!/usr/bin/env bash
# Run the end-to-end API checks on this server (its real Node and PostgreSQL versions)
# against a throwaway database. Production data and the running service are untouched.
# Run as the deploy user after building: ~/buildtruck/deploy/e2e-test.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/buildtruck}"
ENV_FILE="${ENV_FILE:-/etc/buildtruck/api.env}"
DB_ROLE="${DB_ROLE:-timetrack}"
TEST_DB=timetrack_e2e
TEST_PORT=5055
CLOCK_PORT=5056

prod_url=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
export DATABASE_URL="${prod_url%/*}/$TEST_DB"
export NODE_ENV=production HOST=127.0.0.1 PORT=$TEST_PORT TRUST_PROXY=1
export CORS_ORIGINS=https://e2e.invalid E2E_ALLOWED_ORIGIN=https://e2e.invalid
export JWT_SECRET; JWT_SECRET=$(openssl rand -base64 48)
export ADMIN_USERNAME=e2e-admin ADMIN_PASSWORD; ADMIN_PASSWORD=$(openssl rand -hex 16)
export API_URL="http://127.0.0.1:$TEST_PORT/api" E2E_ALLOW_WRITES=1 E2E_CLOCK_PORT=$CLOCK_PORT

server_log=$(mktemp)
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  sudo -u postgres dropdb --if-exists "$TEST_DB"
  rm -f "$server_log"
}
trap cleanup EXIT

echo "Node $(node -v), $(sudo -u postgres psql -tAc 'SELECT version()' | cut -d' ' -f1-2)"
sudo -u postgres dropdb --if-exists "$TEST_DB"
sudo -u postgres createdb -O "$DB_ROLE" "$TEST_DB"

cd "$APP_DIR/site-attendance-backend"
node dist/scripts/migrate.js
node dist/scripts/createAdmin.js
# The preload lets the tests set this throwaway instance's clock; production never loads it.
node --import ./test/fakeClock.mjs dist/index.js >"$server_log" 2>&1 &
server_pid=$!
for _ in $(seq 1 20); do
  curl -fsS "$API_URL/health" >/dev/null 2>&1 && break
  sleep 0.5
done

status=0
node test/e2e.mjs || status=$?

echo
echo "== Client IPs the API saw for failed logins (should be 203.0.113.x, not 127.0.0.1):"
grep -o 'from [^ ]*$' "$server_log" | sort | uniq -c || true
exit "$status"
