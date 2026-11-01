#!/usr/bin/env bash
# Redeploy the API from the latest main branch: pull, build, migrate, restart.
# Run on the server as the deploy user: ~/buildtruck/deploy/update-api.sh
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the deploy user, not root (it asks for sudo only to restart the service)." >&2
  exit 1
fi

APP_DIR="${APP_DIR:-$HOME/buildtruck}"
ENV_FILE=/etc/buildtruck/api.env

cd "$APP_DIR"
git pull --ff-only

cd "$APP_DIR/site-attendance-backend"
# --no-workspaces: install from this package's own lockfile, not the monorepo root.
npm ci --no-workspaces
npm run build
npm prune --omit=dev --no-workspaces

node --env-file="$ENV_FILE" dist/scripts/migrate.js

sudo systemctl restart buildtruck-api
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:5000/api/health; then
    echo
    echo "Deployed $(git -C "$APP_DIR" log -1 --format='%h %s')"
    exit 0
  fi
  sleep 0.5
done
echo "API did not become healthy. Check: journalctl -u buildtruck-api -n 50" >&2
exit 1
