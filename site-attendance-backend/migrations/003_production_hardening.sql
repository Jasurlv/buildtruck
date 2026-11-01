-- Production hardening for the core tables.
--
-- 1. Store timestamps as absolute instants (TIMESTAMPTZ). Existing values are
--    interpreted in the session TimeZone, which is how NOW() wrote them, so run
--    this against an existing database with its usual TimeZone setting.
-- 2. Enforce one active shift per worker and case-insensitive worker usernames
--    in the database, so concurrent requests cannot bypass the API checks.
-- 3. Index the lookups the API performs on every request.

ALTER TABLE buildings
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE workers
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE attendance_logs
  ALTER COLUMN punch_in_time    TYPE TIMESTAMPTZ,
  ALTER COLUMN lunch_start_time TYPE TIMESTAMPTZ,
  ALTER COLUMN lunch_end_time   TYPE TIMESTAMPTZ,
  ALTER COLUMN end_work_time    TYPE TIMESTAMPTZ,
  ALTER COLUMN created_at       TYPE TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS workers_username_case_insensitive_uq
  ON workers (LOWER(username));

CREATE INDEX IF NOT EXISTS workers_assigned_building_id_idx
  ON workers (assigned_building_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_one_active_shift_uq
  ON attendance_logs (worker_id)
  WHERE end_work_time IS NULL;

CREATE INDEX IF NOT EXISTS attendance_logs_worker_punch_in_idx
  ON attendance_logs (worker_id, punch_in_time DESC);

CREATE INDEX IF NOT EXISTS attendance_logs_work_date_idx
  ON attendance_logs (work_date);

CREATE INDEX IF NOT EXISTS attendance_logs_building_id_idx
  ON attendance_logs (building_id);
