# Buildtruck attendance

## Production setup

The step-by-step server guide for the API and database (Hetzner, Ubuntu 24.04, PostgreSQL,
systemd, nginx, TLS, backups) is in [deploy/DEPLOY.md](deploy/DEPLOY.md). In short:

1. Configure the backend environment from `deploy/api.env.example`. It needs `DATABASE_URL`,
   a strong, unique `JWT_SECRET` (at least 32 characters, from a cryptographically secure
   generator) and `CORS_ORIGINS`. Do not commit real environment files or secrets.
2. Build the backend and apply the database migrations with `npm run build && npm run migrate`.
   Migrations live in `site-attendance-backend/migrations/`, are tracked in the
   `schema_migrations` table and each one runs once. In development, `npm run migrate:dev`
   runs them without building. `deploy/e2e-test.sh` runs the end-to-end API checks
   (`site-attendance-backend/test/e2e.mjs`) on the server against a throwaway database.
3. Provision the first administrator by setting `ADMIN_USERNAME` and a unique
   `ADMIN_PASSWORD` of at least 12 characters in the process environment, then running
   `npm run create-admin` (or `create-admin:dev`). Credentials are never embedded in the
   application or command-line arguments.
4. Set `EXPO_PUBLIC_API_URL` for mobile builds and `NEXT_PUBLIC_API_URL` for the
   admin build to the deployed HTTPS API base URL ending in `/api`. No
   production endpoint is hardcoded; the existing local-network mobile URL and
   localhost admin URL are development-only defaults.
5. Rebuild the mobile app with EAS/native tooling after enabling background
   location. Background geofence updates are best-effort: iOS and Android may
   delay or stop updates due to battery policies, denied permissions, or a
   force-stopped app. The active shift must still be finished in the app.

The backend requires bearer JWTs for worker attendance actions, worker and
building administration, and payroll reports. Worker attendance identity is
read from the verified token rather than a caller-supplied worker ID. Admin
accounts are database-managed.
