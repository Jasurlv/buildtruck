-- Pay and attendance rules: per-worker start time, paid start (changing allowance),
-- planned lunches and an audit trail for admin corrections.
--
-- Arrival, finish and lunch start keep their columns (punch_in_time, end_work_time,
-- lunch_start_time). Existing shifts keep their stored hours and earnings.

ALTER TABLE workers
  ADD COLUMN work_start_time TIME NOT NULL DEFAULT '08:00';

ALTER TABLE attendance_logs
  ADD COLUMN scheduled_start_at     TIMESTAMPTZ,
  ADD COLUMN paid_start_at          TIMESTAMPTZ,
  ADD COLUMN lunch_minutes          INTEGER CHECK (lunch_minutes >= 0),
  ADD COLUMN lunch_planned_end_at   TIMESTAMPTZ,
  ADD COLUMN lunch_deducted_minutes NUMERIC(7,2) CHECK (lunch_deducted_minutes >= 0),
  ADD COLUMN hourly_rate_applied    NUMERIC(10,2);

-- Old shifts were paid from the punch-in. They had no schedule, so
-- scheduled_start_at stays NULL and their lateness is unknown rather than 0.
UPDATE attendance_logs SET paid_start_at = punch_in_time;

-- Lunches with both ends recorded: keep what actually happened.
UPDATE attendance_logs
SET lunch_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (lunch_end_time - lunch_start_time)) / 60))::int,
    lunch_planned_end_at = lunch_end_time
WHERE lunch_start_time IS NOT NULL AND lunch_end_time IS NOT NULL;

-- A lunch still open on a running shift can no longer be ended by the worker:
-- close it as a standard 60-minute lunch.
UPDATE attendance_logs
SET lunch_minutes = 60,
    lunch_planned_end_at = lunch_start_time + INTERVAL '60 minutes',
    lunch_end_time = lunch_start_time + INTERVAL '60 minutes'
WHERE lunch_start_time IS NOT NULL AND lunch_end_time IS NULL AND end_work_time IS NULL;

-- What the old code deducted from completed shifts (the actual lunch, otherwise 1 hour).
UPDATE attendance_logs
SET lunch_deducted_minutes = CASE
      WHEN lunch_start_time IS NOT NULL AND lunch_end_time IS NOT NULL
        THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (lunch_end_time - lunch_start_time)) / 60, 2))
      ELSE 60
    END
WHERE end_work_time IS NOT NULL;

-- One row per admin correction. The audit outlives the shift and the admin account:
-- deleting either keeps the row (SET NULL), and admin_username is a snapshot.
CREATE TABLE shift_adjustments (
  id                SERIAL PRIMARY KEY,
  attendance_log_id INTEGER REFERENCES attendance_logs(id) ON DELETE SET NULL,
  admin_id          INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  admin_username    VARCHAR(80) NOT NULL,
  reason            TEXT NOT NULL CHECK (btrim(reason) <> ''),
  old_values        JSONB NOT NULL,
  new_values        JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX shift_adjustments_attendance_log_id_idx
  ON shift_adjustments (attendance_log_id);
