import { Router, Request, Response } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { getAppTimezone, getWorkRules } from "../config.js";
import { getAuthenticatedWorkerId, requireRole } from "../middleware/auth.js";
import {
  computePaidStart,
  computeShiftPay,
  effectiveHourlyRate,
  localDate,
  lunchWindow,
  rulesView,
  shiftView,
  zonedTimeToInstant,
  type ShiftRow,
} from "../shiftRules.js";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "../validation.js";

const router = Router();

/** The current time and rules, included in every shift status response. */
function statusFields(now: Date) {
  return { server_now: now.toISOString(), rules: rulesView(now, getWorkRules(), getAppTimezone()) };
}

const view = (row: ShiftRow) => shiftView(row, getAppTimezone());

// Helper function to calculate distance in meters between two lat/lng coordinates (Haversine formula)
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// 0. GET ACTIVE ATTENDANCE (Required for Mobile App to check active status)
router.get(
  "/active",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    const workerId = getAuthenticatedWorkerId(req);
    try {
      const now = new Date();
      const [result, workerResult] = await Promise.all([
        pool.query(
          `SELECT * FROM attendance_logs
           WHERE worker_id = $1 AND end_work_time IS NULL
           ORDER BY punch_in_time DESC
           LIMIT 1`,
          [workerId],
        ),
        pool.query(
          `SELECT to_char(work_start_time, 'HH24:MI') AS work_start,
                  to_char(work_start_time - make_interval(mins => $2), 'HH24:MI') AS arrive_by
           FROM workers WHERE id = $1`,
          [workerId, getWorkRules().changingAllowanceMinutes],
        ),
      ]);
      return res.json({
        activeShift: result.rows[0] ? view(result.rows[0]) : null,
        schedule: workerResult.rows[0] ?? null,
        ...statusFields(now),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch active shift" });
    }
  },
);

router.get(
  "/history",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    const workerId = getAuthenticatedWorkerId(req);
    try {
      const result = await pool.query(
        `SELECT a.id, w.full_name, a.punch_in_time, a.lunch_start_time,
                a.lunch_end_time, a.end_work_time, a.total_worked_hours,
                a.daily_earned, a.paid_start_at, a.lunch_minutes,
                a.lunch_deducted_minutes
         FROM attendance_logs a
         JOIN workers w ON w.id = a.worker_id
         WHERE a.worker_id = $1 AND a.end_work_time IS NOT NULL
         ORDER BY a.punch_in_time DESC`,
        [workerId],
      );
      return res.json({ shifts: result.rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch work history" });
    }
  },
);

// 1. PUNCH IN (Start Day) - Checks Geofence Radius (supports 100m drift buffer if configured)
router.post(
  "/punch-in",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
  try {
    const workerId = getAuthenticatedWorkerId(req);
    const { latitude, longitude } = req.body;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ error: "Valid location coordinates are required" });
    }

    // Get worker and their assigned building info
    const workerRes = await pool.query(
      `SELECT w.*, b.latitude AS b_lat, b.longitude AS b_lng, b.radius_meters, b.id AS building_id 
       FROM workers w 
       JOIN buildings b ON w.assigned_building_id = b.id 
       WHERE w.id = $1`,
      [workerId],
    );

    if (workerRes.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Worker or assigned building not found" });
    }

    const worker = workerRes.rows[0];

    // Check geofence (with 70m buffer added to site radius for GPS drift protection)
    const distance = calculateDistance(
      latitude,
      longitude,
      parseFloat(worker.b_lat),
      parseFloat(worker.b_lng),
    );
    const allowedRadius = (worker.radius_meters || 30) + 70;

    if (distance > allowedRadius) {
      return res.status(400).json({
        error: "Outside site radius!",
        distance_meters: Math.round(distance),
        allowed_radius: allowedRadius,
      });
    }

    // Prevent duplicate active shifts while allowing multiple shifts per day.
    const existingLog = await pool.query(
      `SELECT id FROM attendance_logs
       WHERE worker_id = $1 AND end_work_time IS NULL`,
      [workerId],
    );

    if (existingLog.rows.length > 0) {
      return res.status(400).json({ error: "A shift is already active" });
    }

    // work_date is the calendar day at the building sites. The schedule is copied
    // onto the shift, so later edits to the worker do not change past lateness.
    const now = new Date();
    const timezone = getAppTimezone();
    const workDate = localDate(now, timezone);
    const scheduledStart = zonedTimeToInstant(
      workDate,
      String(worker.work_start_time).slice(0, 5),
      timezone,
    );
    const paidStart = computePaidStart(now, scheduledStart, getWorkRules().changingAllowanceMinutes);
    const newLog = await pool.query(
      `INSERT INTO attendance_logs
         (worker_id, building_id, work_date, punch_in_time, scheduled_start_at, paid_start_at, status)
       VALUES ($1, $2, $3::date, $4, $5, $6, 'Present') RETURNING *`,
      [workerId, worker.building_id, workDate, now, scheduledStart, paidStart],
    );

    return res.status(201).json({
      message: "Punched in successfully!",
      log: view(newLog.rows[0]),
      ...statusFields(now),
    });
  } catch (err) {
    // A concurrent punch-in for the same worker hit the one-active-shift index.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: "A shift is already active" });
    }
    console.error(err);
    return res.status(500).json({ error: "Server error during punch in" });
  }
  },
);

// 2. START LUNCH. There is no way to end it early: pay resumes at the planned end.
router.post(
  "/lunch",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    const refuse = (status: number, code: string, error: string) =>
      res.status(status).json({ error, code });
    try {
      const workerId = getAuthenticatedWorkerId(req);
      const rules = getWorkRules();

      const minutes = req.body?.minutes;
      if (
        !Number.isInteger(minutes) ||
        minutes < rules.lunchMinMinutes ||
        minutes > rules.lunchMaxMinutes
      ) {
        return refuse(
          400,
          "INVALID_LUNCH_MINUTES",
          `Lunch must be a whole number of minutes from ${rules.lunchMinMinutes} to ${rules.lunchMaxMinutes}.`,
        );
      }

      const now = new Date();
      const active = await pool.query(
        `SELECT * FROM attendance_logs
         WHERE worker_id = $1 AND end_work_time IS NULL
         ORDER BY punch_in_time DESC
         LIMIT 1`,
        [workerId],
      );
      const shift: ShiftRow | undefined = active.rows[0];
      if (!shift) {
        return refuse(404, "NO_ACTIVE_SHIFT", "No active shift found.");
      }
      if (shift.lunch_start_time) {
        return refuse(409, "LUNCH_ALREADY_TAKEN", "Lunch has already been taken on this shift.");
      }
      if (now < new Date(shift.paid_start_at ?? shift.punch_in_time)) {
        return refuse(409, "LUNCH_BEFORE_PAID_START", "Lunch is available once paid time has started.");
      }
      const window = lunchWindow(now, rules, getAppTimezone());
      if (now < window.opensAt) {
        return refuse(409, "LUNCH_WINDOW_NOT_OPEN", `Lunch is available from ${rules.lunchOpensAt}.`);
      }
      if (now >= window.closesAt) {
        return refuse(
          409,
          "LUNCH_WINDOW_CLOSED",
          `The lunch window closed at ${rules.lunchLatestStart}. ${rules.lunchDefaultDeductionMinutes} minutes will be deducted automatically.`,
        );
      }

      const plannedEnd = new Date(now.getTime() + minutes * 60_000);
      // The IS NULL conditions make this safe against a double tap or a concurrent finish.
      const updated = await pool.query(
        `UPDATE attendance_logs
         SET lunch_start_time = $2, lunch_minutes = $3,
             lunch_planned_end_at = $4, lunch_end_time = $4
         WHERE id = $1 AND end_work_time IS NULL AND lunch_start_time IS NULL
         RETURNING *`,
        [shift.id, now, minutes, plannedEnd],
      );
      if (updated.rows.length === 0) {
        return refuse(409, "LUNCH_ALREADY_TAKEN", "Lunch has already been taken on this shift.");
      }

      return res.json({
        message: "Lunch started",
        log: view(updated.rows[0]),
        ...statusFields(now),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error starting lunch" });
    }
  },
);

// 3. END WORK. The Finish tap is the paid end; see computeShiftPay for the rules.
router.post(
  "/end-work",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
  try {
    const workerId = getAuthenticatedWorkerId(req);
    const now = new Date();

    const outcome = await withTransaction(async (client) => {
      // The row lock stops a lunch starting between this read and the update.
      const logRes = await client.query(
        `SELECT a.*, w.hourly_rate
         FROM attendance_logs a
         JOIN workers w ON w.id = a.worker_id
         WHERE a.worker_id = $1 AND a.end_work_time IS NULL
         ORDER BY a.punch_in_time DESC
         LIMIT 1
         FOR UPDATE OF a`,
        [workerId],
      );
      const log: ShiftRow | undefined = logRes.rows[0];
      if (!log) return null;

      const lunchStartedAt = log.lunch_start_time ? new Date(log.lunch_start_time) : null;
      const lunchPlannedEndAt = log.lunch_planned_end_at ? new Date(log.lunch_planned_end_at) : null;
      const hourlyRate = effectiveHourlyRate(log.hourly_rate);
      const pay = computeShiftPay(
        {
          paidStart: new Date(log.paid_start_at ?? log.punch_in_time),
          finish: now,
          lunchStartedAt,
          lunchMinutes: log.lunch_minutes ?? null,
          lunchPlannedEndAt,
        },
        getWorkRules(),
        hourlyRate,
      );

      const finalUpdate = await client.query(
        `UPDATE attendance_logs
         SET end_work_time = $1,
             lunch_end_time = CASE WHEN lunch_start_time IS NOT NULL
                                   THEN LEAST(lunch_end_time, $1) ELSE lunch_end_time END,
             lunch_deducted_minutes = $2,
             total_worked_hours = $3, daily_earned = $4, hourly_rate_applied = $5,
             status = 'Completed'
         WHERE id = $6 RETURNING *`,
        [now, pay.lunchDeductedMinutes, pay.workedHours, pay.earned, hourlyRate, log.id],
      );
      return { pay, row: finalUpdate.rows[0] as ShiftRow };
    });

    if (!outcome) {
      return res
        .status(404)
        .json({ error: "No active shift found for today", code: "NO_ACTIVE_SHIFT" });
    }

    const { pay, row } = outcome;
    const shift = view(row);
    return res.json({
      message: "Work day ended successfully!",
      summary: {
        worked_hours: pay.workedHours,
        earned_today: pay.earned,
        arrival_at: shift.arrival_at,
        paid_start_at: row.paid_start_at,
        finish_at: shift.finish_at,
        lateness_minutes: shift.lateness_minutes,
        waiting_minutes: shift.waiting_minutes,
        lunch_deducted_minutes: pay.lunchDeductedMinutes,
        lunch_deduction_type: pay.lunchDeductionType,
      },
      log: shift,
      ...statusFields(now),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error ending work" });
  }
});

export default router;
