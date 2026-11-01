#!/usr/bin/env bash
# Redeploy the API from the latest main branch: pull, build, migrate, restart.
# Run on the server with: sudo /opt/buildtruck/app/deploy/update-api.sh
set -euo pipefail

APP_DIR=/opt/buildtruck/app
ENV_FILE=/etc/buildtruck/api.env
run_as_app() { sudo -H -u buildtruck "$@"; }

cd "$APP_DIR"
run_as_app git pull --ff-only

cd "$APP_DIR/site-attendance-backend"
# --no-workspaces: install from this package's own lockfile, not the monorepo root.
run_as_app npm ci --no-workspaces
run_as_app npm run build
run_as_app npm prune --omit=dev --no-workspaces

run_as_app node --env-file="$ENV_FILE" dist/scripts/migrate.js

systemctl restart buildtruck-api
sleep 2
systemctl --no-pager --lines=5 status buildtruck-api
curl -fsS http://127.0.0.1:5000/api/health && echo
