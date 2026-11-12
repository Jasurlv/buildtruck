#!/usr/bin/env bash
# Redeploy the admin dashboard from the latest main branch: pull, build, restart.
# Run on the server as the deploy user: ~/buildtruck/deploy/update-admin.sh
#
# The build goes into .next-build and replaces .next only when it is complete, so
# the running site keeps serving until the restart. The previous build is kept in
# .next-old for a quick rollback (see deploy/DEPLOY.md, Dashboard).
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the deploy user, not root (it asks for sudo only to restart the service)." >&2
  exit 1
fi

APP_DIR="${APP_DIR:-$HOME/buildtruck}"
ADMIN_DIR="$APP_DIR/site-attendance-admin"
ENV_FILE=/etc/buildtruck/admin.env

if [[ ! -r $ENV_FILE ]]; then
  echo "Cannot read $ENV_FILE. Create it from deploy/admin.env.example (DEPLOY.md, Dashboard)." >&2
  exit 1
fi

# NEXT_PUBLIC_* values are baked into the browser code at build time. Only those
# lines are read (KEY=value); the file is not executed.
while IFS= read -r line || [[ -n $line ]]; do
  line=${line%$'\r'}
  if [[ $line =~ ^(NEXT_PUBLIC_[A-Z0-9_]+)=(.*)$ ]]; then
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  fi
done < "$ENV_FILE"
for name in NEXT_PUBLIC_API_URL NEXT_PUBLIC_APP_TIMEZONE; do
  if [[ -z ${!name:-} ]]; then
    echo "$name is not set in $ENV_FILE." >&2
    exit 1
  fi
done
if [[ $NEXT_PUBLIC_API_URL != https://*/api ]]; then
  echo "NEXT_PUBLIC_API_URL must be https://... ending in /api (got: $NEXT_PUBLIC_API_URL)." >&2
  exit 1
fi

cd "$APP_DIR"
git pull --ff-only

cd "$ADMIN_DIR"
# --no-workspaces: install from this package's own lockfile, not the monorepo root.
npm ci --no-workspaces

export NEXT_TELEMETRY_DISABLED=1
rm -rf .next-build
# Reuse the previous build cache (faster builds); next build keeps cache/ when it
# cleans its output directory.
if [[ -d .next/cache ]]; then
  mkdir -p .next-build
  cp -a .next/cache .next-build/cache
fi
NEXT_DIST_DIR=.next-build npm run build

rm -rf .next-old
if [[ -d .next ]]; then
  mv .next .next-old
fi
mv .next-build .next

sudo systemctl restart buildtruck-admin
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
    echo "Dashboard is up on 127.0.0.1:3000 (API: $NEXT_PUBLIC_API_URL, timezone: $NEXT_PUBLIC_APP_TIMEZONE)."
    echo "Deployed $(git -C "$APP_DIR" log -1 --format='%h %s')"
    exit 0
  fi
  sleep 0.5
done
echo "Dashboard did not respond on 127.0.0.1:3000. Check: journalctl -u buildtruck-admin -n 50" >&2
if [[ -d .next-old ]]; then
  echo "Roll back: cd $ADMIN_DIR && mv .next .next-failed && mv .next-old .next && sudo systemctl restart buildtruck-admin" >&2
fi
exit 1
