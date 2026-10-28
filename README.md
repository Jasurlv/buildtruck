# Buildtruck attendance

## Production setup

1. Configure the backend environment with `DATABASE_URL`, `PORT`, and a strong,
   unique `JWT_SECRET` (at least 32 characters). Generate the JWT secret with a
   cryptographically secure random generator; do not commit real environment
   files or secrets.
2. Apply `site-attendance-backend/src/db/migrations/001_create_admins.sql` to
   the production PostgreSQL database before deploying the backend.
3. Provision the first administrator from the backend directory by setting
   `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 12 characters in
   the process environment, then running `npm run create-admin`. Credentials
   are never embedded in the application or command-line arguments.
4. Set `EXPO_PUBLIC_API_URL` for mobile builds and `NEXT_PUBLIC_API_URL` for the
   admin build to the deployed HTTPS API base URL ending in `/api`. No
   production endpoint is hardcoded; the existing local-network mobile URL and
   localhost admin URL are development-only defaults.
5. Rebuild the mobile app with EAS/native tooling after enabling background
   location. Background geofence updates are best-effort: iOS and Android may
   delay or stop updates due to battery policies, denied permissions, or a
   force-stopped app. The active shift must still be finished in the app.

The backend now requires bearer JWTs for worker attendance actions, worker and
building administration, and payroll reports. Worker attendance identity is
read from the verified token rather than a caller-supplied worker ID. Admin
accounts are database-managed.