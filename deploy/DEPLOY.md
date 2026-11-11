# Deploying the Buildtruck API and database

Target: Hetzner CX23, Ubuntu 24.04 (Helsinki, backups on), Node.js 22, PostgreSQL 16.

```
mobile app / admin dashboard ──HTTPS──▶ nginx :443 ──▶ API 127.0.0.1:5000 ──▶ PostgreSQL 127.0.0.1:5432
```

The API runs as the `deploy` user from `/home/deploy/buildtruck`. Replace `api.example.com`
and `admin.example.com` with your real domains.

## Already done on the server

- [x] Hetzner CX23, Ubuntu 24.04
- [x] Non-root sudo user `deploy`; key-only SSH; root login disabled
- [x] ufw allows OpenSSH, 80 and 443
- [x] PostgreSQL 16 installed; role `timetrack` and database `timetrack_db` created
- [x] Node.js 22 and git installed
- [x] GitHub deploy key configured for `deploy`

Still needed: a DNS `A` record (and `AAAA` for IPv6) pointing `api.example.com` at the
server. Certbot needs it in step 9.

All commands below run as `deploy` over SSH.

---

## 1. Clone the repository

```bash
git clone git@github.com:Jasurlv/buildtruck.git ~/buildtruck
```

## 2. Install and build

```bash
cd ~/buildtruck/site-attendance-backend
npm ci --no-workspaces
npm run build
npm prune --omit=dev --no-workspaces
```

`--no-workspaces` is required. Without it, npm sees the monorepo root `package.json` and fails.

## 3. Prepare the database

Make `timetrack` the owner of `timetrack_db`. On PostgreSQL 15+ the owner is the only role
that can create tables in the `public` schema by default. If `timetrack` already owns it,
these commands change nothing:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'EOF'
ALTER DATABASE timetrack_db OWNER TO timetrack;
ALTER DATABASE timetrack_db SET timezone TO 'UTC';
EOF
```

If you don't know the `timetrack` password, or the role has none, set a new one:
`sudo -u postgres psql -c '\password timetrack'`

## 4. Create the production env file

```bash
sudo mkdir -p /etc/buildtruck
sudo cp ~/buildtruck/deploy/api.env.example /etc/buildtruck/api.env
sudo chown root:deploy /etc/buildtruck/api.env
sudo chmod 640 /etc/buildtruck/api.env
openssl rand -base64 48             # copy the output for JWT_SECRET
sudo nano /etc/buildtruck/api.env
```

Fill in:

- `DATABASE_URL`: replace `CHANGE_ME` with the `timetrack` password. If the password contains
  `@ : / ? # %` or spaces, percent-encode it first:
  ```bash
  read -rsp "DB password: " P; echo; P="$P" node -e 'console.log(encodeURIComponent(process.env.P))'; unset P
  ```
- `JWT_SECRET`: the `openssl` output from above
- `CORS_ORIGINS`: the admin dashboard's origin, e.g. `https://admin.example.com`

Check the database connection:

```bash
node --env-file=/etc/buildtruck/api.env -e '
  const { Client } = require("./node_modules/pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.query("select current_user, current_database(), version()"))
   .then(r => { console.log(r.rows[0]); return c.end(); })
   .catch(e => { console.error("DB connection failed:", e.message); process.exit(1); });'
```

Run it from `~/buildtruck/site-attendance-backend`.

## 5. Run the migrations

```bash
cd ~/buildtruck/site-attendance-backend
node --env-file=/etc/buildtruck/api.env dist/scripts/migrate.js
```

Expected output: `Applied 001_create_admins.sql`, `002_core_tables.sql`,
`003_production_hardening.sql`, `004_pay_attendance_rules.sql`, then `Database schema is up to date.` Running it again only
prints the last line.

## 6. Create the first admin

The password is read with a hidden prompt, so it never appears in shell history or the
process list. It needs at least 12 characters.

```bash
cd ~/buildtruck/site-attendance-backend
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password: " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
node --env-file=/etc/buildtruck/api.env dist/scripts/createAdmin.js
unset ADMIN_USERNAME ADMIN_PASSWORD
```

## 7. Optional but recommended: end-to-end test on this server

This runs the full API test suite (158 checks) with the server's own Node 22 and
PostgreSQL 16. It uses a throwaway database `timetrack_e2e` and port 5055, then deletes the
database. Production data is not touched.

```bash
~/buildtruck/deploy/e2e-test.sh
```

It should end with `ALL PASSED`. It then lists the client IPs the API saw for failed logins:
they should be `203.0.113.x` addresses, not `127.0.0.1`, which proves `TRUST_PROXY` works.

## 8. Run the API with systemd

```bash
sudo cp ~/buildtruck/deploy/systemd/buildtruck-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buildtruck-api
systemctl status buildtruck-api --no-pager
```

Logs: `journalctl -u buildtruck-api -f`. Failed logins are logged with the client IP.

### Smoke test on localhost (before nginx)

```bash
API=http://127.0.0.1:5000/api

# 1. Health: expect {"message":"Site Attendance API is running!","db_time":...}
curl -s $API/health; echo

# 2. Admin login: credentials go through stdin, not the command line
read -rp "Admin username: " U; read -rsp "Admin password: " P; echo; export U P
TOKEN=$(node -e 'console.log(JSON.stringify({username: process.env.U, password: process.env.P}))' \
  | curl -s -H 'Content-Type: application/json' --data @- $API/admin/login \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token ?? ""')
unset U P
[ -n "$TOKEN" ] && echo "Admin login OK" || echo "Admin login FAILED"

# 3. Authenticated request: expect [] on a fresh database
curl -s -H "Authorization: Bearer $TOKEN" $API/buildings; echo

# 4. Wrong password: expect 401
curl -s -o /dev/null -w "wrong password -> HTTP %{http_code}\n" \
  -H 'Content-Type: application/json' -d '{"username":"nobody","password":"wrong"}' $API/admin/login
```

## 9. nginx and Let's Encrypt

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo cp ~/buildtruck/deploy/nginx/buildtruck-api.conf /etc/nginx/sites-available/buildtruck-api
sudo sed -i 's/api.example.com/YOUR_API_DOMAIN/' /etc/nginx/sites-available/buildtruck-api
sudo ln -s /etc/nginx/sites-available/buildtruck-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d YOUR_API_DOMAIN --redirect -m you@example.com --agree-tos
curl -s https://YOUR_API_DOMAIN/api/health; echo
```

Certbot renews certificates automatically (`systemctl list-timers | grep certbot`).

nginx passes the client IP in `X-Forwarded-For`. With `TRUST_PROXY=1`, the API uses the
address nginx saw and ignores anything a client wrote into that header itself.

Login rate limiting counts **failed** attempts only:
- 10 per IP + username per 15 minutes. One person mistyping a password cannot lock out
  colleagues on the same site Wi-Fi or mobile network.
- 100 per IP per 15 minutes, across all usernames. This stops password guessing across many
  accounts.

## 10. Backups

Hetzner backups are daily whole-server snapshots (the last 7 are kept). A nightly `pg_dump`
also lets you restore only the database:

```bash
sudo install -m 755 ~/buildtruck/deploy/backup-db.sh /usr/local/bin/buildtruck-backup-db
sudo install -d -o postgres -g postgres -m 700 /var/backups/buildtruck
sudo cp ~/buildtruck/deploy/systemd/buildtruck-db-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buildtruck-db-backup.timer

sudo systemctl start buildtruck-db-backup     # run once now
journalctl -u buildtruck-db-backup -n 5 --no-pager
sudo ls -lh /var/backups/buildtruck
```

The script is copied to `/usr/local/bin` because the `postgres` user cannot read files in
`/home/deploy`. Dumps of `timetrack_db` are kept for 14 days and are included in the Hetzner
snapshots. For an off-site copy, sync `/var/backups/buildtruck` to a Hetzner Storage Box.

**Test a restore** once, into a scratch database:

```bash
sudo -u postgres createdb restore_test
sudo -u postgres pg_restore --no-owner -d restore_test "$(sudo ls -1t /var/backups/buildtruck/*.dump | head -1)"
sudo -u postgres psql -d restore_test -c "SELECT filename FROM schema_migrations;"
sudo -u postgres dropdb restore_test
```

If you edit `backup-db.sh` later, run the `install` line again.

## 11. Deploying updates

Push to `main`, then on the server, as `deploy`:

```bash
~/buildtruck/deploy/update-api.sh
```

It pulls, installs, builds, applies new migrations, restarts the service and waits for the
health check. Each migration runs once, inside a transaction, and is recorded in
`schema_migrations`. To change the schema, add a new numbered file such as
`migrations/004_....sql`. Never edit a migration that has already been applied.

If the systemd unit file changes, copy it again and run `sudo systemctl daemon-reload`.

## Optional: moving existing local data to production

Do this right after step 4, **instead of** steps 5 and 6, while `timetrack_db` is still empty.

Your PC runs PostgreSQL 18 and the server runs 16. The server's tools can't read 18's
custom-format dumps, so use a plain SQL dump:

1. On your PC, bring the local database up to date, then dump it. Migration 003 converts
   timestamps using the database's own timezone, which is how they were written.
   ```bash
   cd site-attendance-backend
   npm run migrate:dev
   "/c/Program Files/PostgreSQL/18/bin/pg_dump.exe" --no-owner --no-privileges \
     -U postgres -d site_attendance_db -f buildtruck.sql
   scp buildtruck.sql deploy@<server-ip>:~/
   ```
2. On the server, load it as `timetrack` (`SET ROLE`) so that role owns the tables:
   ```bash
   sed -i -e '/^SET transaction_timeout/d' ~/buildtruck.sql
   install -m 644 ~/buildtruck.sql /tmp/buildtruck.sql     # postgres can't read /home/deploy
   sudo -u postgres psql -d timetrack_db -v ON_ERROR_STOP=1 \
     -c 'SET ROLE timetrack' -f /tmp/buildtruck.sql
   rm ~/buildtruck.sql /tmp/buildtruck.sql
   cd ~/buildtruck/site-attendance-backend
   node --env-file=/etc/buildtruck/api.env dist/scripts/migrate.js   # should apply nothing
   ```
   The `sed` removes a setting that only exists in PostgreSQL 17+. If `psql` complains about
   `\restrict`, update the server (`sudo apt update && sudo apt upgrade`): PostgreSQL 16.10
   and later understand it.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | At least 32 characters; signs admin and worker tokens |
| `CORS_ORIGINS` | in production | Comma-separated admin dashboard origins |
| `TRUST_PROXY` | in production | Number of proxies in front of the API: `1` behind nginx |
| `NODE_ENV` | | `production` makes the two variables above mandatory |
| `HOST` / `PORT` | | Bind address and port (default: all interfaces, port 5000) |
| `APP_TIMEZONE` | | Sites' timezone for shift dates (default `Europe/Riga`) |
| `DB_POOL_MAX` | | Max PostgreSQL connections (default 10) |
| `CHANGING_ALLOWANCE_MINUTES` | | Minutes to change clothes before paid time starts (default 15) |
| `LUNCH_OPENS_AT` / `LUNCH_LATEST_START` | | Lunch can start in this window, `HH:MM` in `APP_TIMEZONE` (default `12:00` / `12:30`) |
| `LUNCH_MIN_MINUTES` / `LUNCH_MAX_MINUTES` | | Lunch lengths a worker can choose, whole minutes from min to max (default 30 / 60; the app offers them in 5-minute steps) |
| `LUNCH_DEFAULT_DEDUCTION_MINUTES` | | Deducted when no lunch was recorded (default 60) |
| `LUNCH_AUTO_DEDUCT_MIN_SHIFT_HOURS` | | That deduction applies to shifts longer than this (default 5) |
