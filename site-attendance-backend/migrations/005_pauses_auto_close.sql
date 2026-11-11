-- Pauses within a shift and automatic closing of shifts left running.
--
-- shift_pauses holds every interval that is not paid time apart from lunch:
-- worker breaks now ('break') and time outside the site radius later ('outside').
-- Unpaid time = lunch deduction + the pauses (clipped to the paid part of the shift).

CREATE TABLE shift_pauses (
  id                 SERIAL PRIMARY KEY,
  shift_id           INTEGER NOT NULL REFERENCES attendance_logs(id) ON DELETE CASCADE,
  kind               VARCHAR(20) NOT NULL CHECK (kind IN ('break', 'outside')),
  started_at         TIMESTAMPTZ NOT NULL,
  ended_at           TIMESTAMPTZ,
  reason             TEXT,
  edited_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  edited_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX shift_pauses_shift_id_idx ON shift_pauses (shift_id);

-- At most one open pause per shift, whatever its kind; concurrent "start break"
-- requests cannot both succeed.
CREATE UNIQUE INDEX shift_pauses_one_open_per_shift_uq
  ON shift_pauses (shift_id)
  WHERE ended_at IS NULL;

-- break_minutes: pause time deducted when the shift was completed (NULL while running).
-- auto_closed: the server ended the shift after MAX_SHIFT_HOURS of paid time.
-- auto_close_acknowledged_at: when the worker saw the "closed automatically" notice.
ALTER TABLE attendance_logs
  ADD COLUMN break_minutes              NUMERIC(7,2) CHECK (break_minutes >= 0),
  ADD COLUMN auto_closed                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_close_acknowledged_at TIMESTAMPTZ;

-- Shifts completed before breaks existed had none.
UPDATE attendance_logs SET break_minutes = 0 WHERE end_work_time IS NOT NULL;

-- The auto-close check looks for running shifts by paid start.
CREATE INDEX attendance_logs_running_paid_start_idx
  ON attendance_logs (paid_start_at)
  WHERE end_work_time IS NULL;
