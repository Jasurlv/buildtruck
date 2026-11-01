# Deploying the Buildtruck API and database

This guide is for a single Hetzner Cloud server (Ubuntu 24.04, Helsinki, backups enabled)
running:

- **PostgreSQL 18** (same major version as development), listening on localhost only
- **The Node.js API** as a hardened systemd service on `127.0.0.1:5000`
- **nginx** in front of it with a Let's Encrypt certificate

```
mobile app / admin dashboard ──HTTPS──▶ nginx :443 ──▶ API 127.0.0.1:5000 ──▶ PostgreSQL 127.0.0.1:5432
```

Throughout this guide, replace `api.example.com` with your API domain and
`admin.example.com` with the admin dashboard's domain.

---

## 0. Before you start

1. **DNS:** create an `A` record (plus `AAAA` for IPv6) pointing `api.example.com` at the
   server's IP. Certbot (step 8) needs this record to work.
2. **Rotate leaked secrets.** `site-attendance-backend/.env` was committed to GitHub in the past
   (commits `8e28a93`, `adbb98f`). Treat its `JWT_SECRET` and database password as public:
   - Production gets brand-new secrets (step 5), so the server is not affected.
   - Change the local `postgres` password on your PC if the repository is or was public.
   - Consider making the GitHub repository private.

## 1. First login and base hardening

SSH in as `root` with the key you added when creating the server:

```bash
apt update && apt full-upgrade -y
timedatectl            # leave the server clock on UTC; the app handles Europe/Riga itself

# Personal sudo user (replace "jasur")
adduser jasur
usermod -aG sudo jasur
rsync --archive --chown=jasur:jasur ~/.ssh /home/jasur

# Firewall: only SSH, HTTP and HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Open a **new** terminal and confirm `ssh jasur@<server-ip>` works and `sudo -v` succeeds.
Only then disable root login and password logins:

```bash
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo systemctl restart ssh
```

Ubuntu 24.04 installs security updates automatically (`unattended-upgrades`). Check that it
is enabled with `systemctl status unattended-upgrades`.

Optional: also create a Hetzner Cloud Firewall that allows only TCP 22, 80 and 443.

## 2. Install Node.js 24, PostgreSQL 18, nginx and certbot

```bash
# Node.js 24 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 18 from the official PostgreSQL apt repository
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-18

sudo apt install -y nginx certbot python3-certbot-nginx git

node -v && psql --version
```

## 3. Create the database

```bash
DB_PASSWORD=$(openssl rand -hex 24)
echo "Database password: $DB_PASSWORD"    # paste it into api.env in step 5

sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" <<'EOF'
CREATE ROLE buildtruck LOGIN PASSWORD :'pw';
CREATE DATABASE buildtruck OWNER buildtruck;
ALTER DATABASE buildtruck SET timezone TO 'UTC';
EOF
```

PostgreSQL on Ubuntu only listens on localhost by default. Leave it that way.

## 4. App user and code

```bash
sudo useradd --system --create-home --home-dir /opt/buildtruck --shell /usr/sbin/nologin buildtruck
```

If the GitHub repository is **private**, give the server a read-only deploy key:

```bash
sudo -H -u buildtruck mkdir -p -m 700 /opt/buildtruck/.ssh
sudo -H -u buildtruck ssh-keygen -t ed25519 -N "" -f /opt/buildtruck/.ssh/id_ed25519
sudo cat /opt/buildtruck/.ssh/id_ed25519.pub
# GitHub → repo → Settings → Deploy keys → Add (read-only), paste the key
sudo -H -u buildtruck git clone git@github.com:Jasurlv/buildtruck.git /opt/buildtruck/app
```

If it is public: `sudo -H -u buildtruck git clone https://github.com/Jasurlv/buildtruck.git /opt/buildtruck/app`

## 5. Production environment file

```bash
sudo mkdir -p /etc/buildtruck
sudo cp /opt/buildtruck/app/deploy/api.env.example /etc/buildtruck/api.env
openssl rand -base64 48          # use the output as JWT_SECRET
sudo nano /etc/buildtruck/api.env
sudo chown root:buildtruck /etc/buildtruck/api.env
sudo chmod 640 /etc/buildtruck/api.env
```

Set `DATABASE_URL` (password from step 3), `JWT_SECRET` and `CORS_ORIGINS`
(for example `https://admin.example.com`). The API refuses to start if any of these are
missing or invalid.

## 6. Build, migrate and create the first admin

```bash
cd /opt/buildtruck/app/site-attendance-backend
sudo -H -u buildtruck npm ci --no-workspaces
sudo -H -u buildtruck npm run build
sudo -H -u buildtruck npm prune --omit=dev --no-workspaces
sudo -H -u buildtruck node --env-file=/etc/buildtruck/api.env dist/scripts/migrate.js
```

`--no-workspaces` is required: without it, npm sees the monorepo root and fails.

Create the first admin. The password is read with a hidden prompt, so it never appears in
shell history or the process list:

```bash
read -rp "Admin username: " ADMIN_USERNAME
read -rsp "Admin password (12+ chars): " ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
sudo -H -u buildtruck --preserve-env=ADMIN_USERNAME,ADMIN_PASSWORD \
  node --env-file=/etc/buildtruck/api.env dist/scripts/createAdmin.js
unset ADMIN_USERNAME ADMIN_PASSWORD
```

## 7. Run the API with systemd

```bash
sudo cp /opt/buildtruck/app/deploy/systemd/buildtruck-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buildtruck-api
systemctl status buildtruck-api
curl -s http://127.0.0.1:5000/api/health
```

Logs: `journalctl -u buildtruck-api -f`

## 8. nginx and HTTPS

```bash
sudo cp /opt/buildtruck/app/deploy/nginx/buildtruck-api.conf /etc/nginx/sites-available/buildtruck-api
sudo sed -i 's/api.example.com/YOUR_API_DOMAIN/' /etc/nginx/sites-available/buildtruck-api
sudo ln -s /etc/nginx/sites-available/buildtruck-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d YOUR_API_DOMAIN --redirect -m you@example.com --agree-tos
curl -s https://YOUR_API_DOMAIN/api/health
```

Certbot renews certificates automatically (`systemctl list-timers | grep certbot`).

## 9. Backups

Hetzner's server backups are daily whole-disk snapshots (the last 7 are kept). They are good
for disaster recovery but restore the whole server. A nightly `pg_dump` lets you restore just
the database, or move it to another machine:

```bash
sudo install -m 755 /opt/buildtruck/app/deploy/backup-db.sh /usr/local/bin/buildtruck-backup-db
sudo install -d -o postgres -g postgres -m 700 /var/backups/buildtruck
sudo cp /opt/buildtruck/app/deploy/systemd/buildtruck-db-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buildtruck-db-backup.timer

sudo systemctl start buildtruck-db-backup     # run once now
journalctl -u buildtruck-db-backup -n 5
sudo ls -lh /var/backups/buildtruck
```

Dumps are kept for 14 days. Because they are on the same server, they are also included in
Hetzner's snapshots. For an off-site copy, sync `/var/backups/buildtruck` to a Hetzner
Storage Box.

**Test a restore** once, into a scratch database:

```bash
sudo -u postgres createdb restore_test
sudo -u postgres pg_restore --no-owner -d restore_test /var/backups/buildtruck/<file>.dump
sudo -u postgres psql -d restore_test -c "SELECT COUNT(*) FROM attendance_logs;"
sudo -u postgres dropdb restore_test
```

## 10. Verify

- `https://YOUR_API_DOMAIN/api/health` returns `{"message":"Site Attendance API is running!",...}`
- Admin login works from the admin dashboard's origin
- `curl -sI https://YOUR_API_DOMAIN/api/health` shows `strict-transport-security` and no `x-powered-by`
- After a reboot (`sudo reboot`) the API comes back by itself
- Optional: add an external uptime monitor on `/api/health`

## 11. Deploying updates

Push to `main`, then on the server run:

```bash
sudo /opt/buildtruck/app/deploy/update-api.sh
```

It pulls, installs, builds, applies new migrations and restarts the service. Migrations are
tracked in the `schema_migrations` table and each file runs once, inside a transaction. To
change the schema, add a new numbered file such as `migrations/004_....sql`. Never edit a
migration that has already been applied.

## Optional: moving existing local data to production

Do this **instead of** running the migrations on an empty production database in step 6.
Create the admin afterwards only if your local data has no admin yet.

1. On your PC, apply the migrations to the local database first. Migration 003 converts
   timestamps using the database's own timezone, which is how they were written:
   ```bash
   cd site-attendance-backend
   npm run migrate:dev
   "/c/Program Files/PostgreSQL/18/bin/pg_dump.exe" --format=custom --no-owner --no-privileges \
     -U postgres -d site_attendance_db -f buildtruck.dump
   ```
2. Copy it up: `scp buildtruck.dump jasur@<server-ip>:/tmp/`
3. On the server, restore it as the `buildtruck` user so that user owns the tables:
   ```bash
   sudo chmod 644 /tmp/buildtruck.dump
   sudo -H -u buildtruck bash -c 'set -a; . /etc/buildtruck/api.env; pg_restore --no-owner --no-privileges -d "$DATABASE_URL" /tmp/buildtruck.dump'
   sudo -H -u buildtruck node --env-file=/etc/buildtruck/api.env /opt/buildtruck/app/site-attendance-backend/dist/scripts/migrate.js
   rm /tmp/buildtruck.dump
   ```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | At least 32 characters; signs admin and worker tokens |
| `CORS_ORIGINS` | in production | Comma-separated admin dashboard origins |
| `NODE_ENV` | | `production` makes `CORS_ORIGINS` mandatory |
| `HOST` / `PORT` | | Bind address and port (default: all interfaces, port 5000) |
| `TRUST_PROXY` | | Number of proxies in front (1 behind nginx) |
| `APP_TIMEZONE` | | Sites' timezone for shift dates (default `Europe/Riga`) |
| `DB_POOL_MAX` | | Max PostgreSQL connections (default 10) |
