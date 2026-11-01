-- Core tables: buildings, workers, attendance_logs.
-- Matches the schema of the original local database (site_attendance_db).
-- admins is created in 001_create_admins.sql.

CREATE TABLE IF NOT EXISTS buildings (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255)   NOT NULL,
  address       TEXT           NOT NULL,
  latitude      NUMERIC(10,8)  NOT NULL,
  longitude     NUMERIC(11,8)  NOT NULL,
  radius_meters INTEGER        DEFAULT 30,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workers (
  id                   SERIAL PRIMARY KEY,
  full_name            VARCHAR(255) NOT NULL,
  username             VARCHAR(100) NOT NULL UNIQUE,
  password             VARCHAR(255) NOT NULL,  -- bcrypt hash, never plain text
  hourly_rate          NUMERIC(10,2) DEFAULT 6.25,
  assigned_building_id INTEGER REFERENCES buildings(id) ON DELETE SET NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id                 SERIAL PRIMARY KEY,
  worker_id          INTEGER REFERENCES workers(id)   ON DELETE CASCADE,
  building_id        INTEGER REFERENCES buildings(id) ON DELETE CASCADE,
  work_date          DATE NOT NULL,
  punch_in_time      TIMESTAMP,
  lunch_start_time   TIMESTAMP,
  lunch_end_time     TIMESTAMP,
  end_work_time      TIMESTAMP,
  total_worked_hours NUMERIC(5,2)  DEFAULT 0.00,
  daily_earned       NUMERIC(10,2) DEFAULT 0.00,
  status             VARCHAR(50)   DEFAULT 'Pending',
  created_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);
