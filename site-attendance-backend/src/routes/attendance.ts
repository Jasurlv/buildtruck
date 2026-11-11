import { Router, Request, Response } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { getAppTimezone, getWorkRules } from "../config.js";
import { getAuthenticatedWorkerId, requireRole } from "../middleware/auth.js";
import {
  breakFields,
  computePaidStart,
  localDate,
  lunchWindow,
  rulesView,
  shiftView,
  zonedTimeToInstant,
  type PauseRow,
  type ShiftRow,
} from "../shiftRules.js";
import { closeOverdueShifts, completeShift, loadBreaks, type Db } from "../shiftStore.js";
import { PG_UNIQUE_VIOLATION, parseId, pgErrorCode } from "../validation.js";

const router = Router();

/** The current time and rules, included in every shift status response. */
function statusFields(now: Date) {
  const timezone = getAppTimezone();
  return {
    server_now: now.toISOString(),
    // The sites' calendar date, so clients can tell a shift left open from an earlier day.
    today_local: localDate(now, timezone),
    rules: rulesView(now, getWorkRules(), timezone),
  };
}

const view = (row: ShiftRow) => shiftView(row, getAppTimezone());

/** The shift as clients see it, including its breaks (pass them if already loaded). */
async function viewWithBreaks(db: Db, row: ShiftRow, now: Date, breaks?: PauseRow[]) {
  // Locked rows carry the worker's hourly_rate (for pay); it is not part of the shift.
  const stored = { ...row };
  delete stored.hourly_rate;
  const allBreaks = breaks ?? (await loadBreaks(db, row.id));
  return { ...view(stored), ...breakFields(row, allBreaks, now, getAppTimezone()) };
}

type Refusal = { status: number; code: string; error: string };
const refusal = (status: number, code: string, error: string): Refusal => ({ status, code, error });
const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "code" in value && "status" in value;
const sendRefusal = (res: Response, { status, code, error }: Refusal) =>
  res.status(status).json({ error, code });

/** The worker's running shift, locked for this transaction, with their hourly rate. */
async function lockActiveShift(db: Db, workerId: number): Promise<ShiftRow | undefined> {
  const result = await db.query(
    `SELECT a.*, w.hourly_rate
     FROM attendance_logs a
     JOIN workers w ON w.id = a.worker_id
     WHERE a.worker_id = $1 AND a.end_work_time IS NULL
     ORDER BY a.punch_in_time DESC
     LIMIT 1
     FOR UPDATE OF a`,
    [workerId],
  );
  return result.rows[0];
}

/** A lunch is running at `now` (started and its planned end not reached). */
function isOnLunch(shift: ShiftRow, now: Date): boolean {
  if (!shift.lunch_start_time) return false;
  const end = shift.lunch_planned_end_at ?? shift.lunch_end_time;
  return new Date(shift.lunch_start_time) <= now && (!end || now < new Date(end));
}

const NO_ACTIVE_SHIFT = refusal(404, "NO_ACTIVE_SHIFT", "No active shift found.");

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
      // Lazy check: correct even if the auto-close timer has not run yet.
      await closeOverdueShifts(now, { workerId });
      const [result, workerResult, latestResult] = await Promise.all([
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
        pool.query(
          `SELECT * FROM attendance_logs
           WHERE worker_id = $1
           ORDER BY punch_in_time DESC
           LIMIT 1`,
          [workerId],
        ),
      ]);
      const activeRow: ShiftRow | undefined = result.rows[0];
      // Shown once: until the worker acknowledges it, and only for their latest shift.
      const latest: ShiftRow | undefined = latestResult.rows[0];
      const autoClosed =
        latest?.auto_closed && !latest.auto_close_acknowledged_at ? latest : null;
      return res.json({
        activeShift: activeRow ? await viewWithBreaks(pool, activeRow, now) : null,
        schedule: workerResult.rows[0] ?? null,
        last_shift_auto_closed: autoClosed !== null,
        auto_closed_shift: autoClosed ? autoClosedNotice(autoClosed) : null,
        ...statusFields(now),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch active shift" });
    }
  },
);

/** What the "closed automatically" notice needs. */
function autoClosedNotice(row: ShiftRow) {
  const shift = view(row);
  const paidStart = new Date(row.paid_start_at ?? row.punch_in_time);
  const finish = new Date(row.end_work_time);
  return {
    id: row.id,
    work_date: row.work_date,
    paid_start_at: row.paid_start_at,
    finish_at: row.end_work_time,
    // From the stored shift, so the notice stays right if MAX_SHIFT_HOURS changes later.
    closed_after_hours: parseFloat(((finish.getTime() - paidStart.getTime()) / 3_600_000).toFixed(2)),
    total_worked_hours: row.total_worked_hours,
    daily_earned: row.daily_earned,
    local_times: shift.local_times,
  };
}

// The worker has seen the "closed automatically" notice for this shift. Idempotent.
router.post(
  "/auto-closed/:id/acknowledge",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    const workerId = getAuthenticatedWorkerId(req);
    const id = parseId(req.params.id);
    if (!id) return sendRefusal(res, refusal(404, "SHIFT_NOT_FOUND", "Shift not found."));
    try {
      const result = await pool.query(
        `UPDATE attendance_logs
         SET auto_close_acknowledged_at = COALESCE(auto_close_acknowledged_at, $3)
         WHERE id = $1 AND worker_id = $2 AND auto_closed
         RETURNING id, auto_close_acknowledged_at`,
        [id, workerId, new Date()],
      );
      if (result.rows.length === 0) {
        return sendRefusal(res, refusal(404, "SHIFT_NOT_FOUND", "No automatically closed shift with this id."));
      }
      return res.json({ acknowledged: true, ...result.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Unable to acknowledge the notice" });
    }
  },
);

router.get(
  "/history",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    const workerId = getAuthenticatedWorkerId(req);
    try {
      await closeOverdueShifts(new Date(), { workerId });
      const result = await pool.query(
        `SELECT a.id, w.full_name, a.punch_in_time, a.lunch_start_time,
                a.lunch_end_time, a.end_work_time, a.total_worked_hours,
                a.daily_earned, a.paid_start_at, a.lunch_minutes,
                a.lunch_deducted_minutes, a.break_minutes, a.auto_closed
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

    const now = new Date();
    // A shift left running past the limit is closed first, so the worker can start a new one.
    await closeOverdueShifts(now, { workerId });

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
      log: await viewWithBreaks(pool, newLog.rows[0], now, []),
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
    try {
      const workerId = getAuthenticatedWorkerId(req);
      const rules = getWorkRules();

      const minutes = req.body?.minutes;
      if (
        !Number.isInteger(minutes) ||
        minutes < rules.lunchMinMinutes ||
        minutes > rules.lunchMaxMinutes
      ) {
        return sendRefusal(res, refusal(
          400,
          "INVALID_LUNCH_MINUTES",
          `Lunch must be a whole number of minutes from ${rules.lunchMinMinutes} to ${rules.lunchMaxMinutes}.`,
        ));
      }

      const now = new Date();
      await closeOverdueShifts(now, { workerId });
      // The row lock serialises lunch, breaks and finish for this shift (double taps,
      // concurrent requests): each sees the others' committed changes.
      const outcome = await withTransaction(async (client) => {
        const shift = await lockActiveShift(client, workerId);
        if (!shift) return NO_ACTIVE_SHIFT;
        if (shift.lunch_start_time) {
          return refusal(409, "LUNCH_ALREADY_TAKEN", "Lunch has already been taken on this shift.");
        }
        if (now < new Date(shift.paid_start_at ?? shift.punch_in_time)) {
          return refusal(409, "LUNCH_BEFORE_PAID_START", "Lunch is available once paid time has started.");
        }
        const window = lunchWindow(now, rules, getAppTimezone());
        if (now < window.opensAt) {
          return refusal(409, "LUNCH_WINDOW_NOT_OPEN", `Lunch is available from ${rules.lunchOpensAt}.`);
        }
        if (now >= window.closesAt) {
          return refusal(
            409,
            "LUNCH_WINDOW_CLOSED",
            `The lunch window closed at ${rules.lunchLatestStart}. ${rules.lunchDefaultDeductionMinutes} minutes will be deducted automatically.`,
          );
        }
        const breaks = await loadBreaks(client, shift.id);
        if (breaks.some((pause) => !pause.ended_at)) {
          return refusal(409, "BREAK_ACTIVE", "End your break before starting lunch.");
        }

        const plannedEnd = new Date(now.getTime() + minutes * 60_000);
        const updated = await client.query(
          `UPDATE attendance_logs
           SET lunch_start_time = $2, lunch_minutes = $3,
               lunch_planned_end_at = $4, lunch_end_time = $4
           WHERE id = $1 AND end_work_time IS NULL AND lunch_start_time IS NULL
           RETURNING *`,
          [shift.id, now, minutes, plannedEnd],
        );
        if (updated.rows.length === 0) {
          return refusal(409, "LUNCH_ALREADY_TAKEN", "Lunch has already been taken on this shift.");
        }
        return { row: updated.rows[0] as ShiftRow, breaks };
      });
      if (isRefusal(outcome)) return sendRefusal(res, outcome);

      return res.json({
        message: "Lunch started",
        log: await viewWithBreaks(pool, outcome.row, now, outcome.breaks),
        ...statusFields(now),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error starting lunch" });
    }
  },
);

// 3. BREAKS. Unpaid; any number per shift, one at a time, never during lunch.
router.post(
  "/break/start",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const workerId = getAuthenticatedWorkerId(req);
      const now = new Date();
      await closeOverdueShifts(now, { workerId });
      const outcome = await withTransaction(async (client) => {
        const shift = await lockActiveShift(client, workerId);
        if (!shift) return NO_ACTIVE_SHIFT;
        if (now < new Date(shift.paid_start_at ?? shift.punch_in_time)) {
          return refusal(409, "BEFORE_PAID_START", "A break can be taken once paid time has started.");
        }
        if (isOnLunch(shift, now)) {
          return refusal(409, "LUNCH_ACTIVE", "You are on lunch: a break can be taken after it.");
        }
        const breaks = await loadBreaks(client, shift.id);
        if (breaks.some((pause) => !pause.ended_at)) {
          return refusal(409, "BREAK_ALREADY_OPEN", "A break is already running.");
        }
        const inserted = await client.query(
          `INSERT INTO shift_pauses (shift_id, kind, started_at)
           VALUES ($1, 'break', $2)
           RETURNING id, started_at, ended_at`,
          [shift.id, now],
        );
        return { row: shift, breaks: [...breaks, inserted.rows[0] as PauseRow] };
      });
      if (isRefusal(outcome)) return sendRefusal(res, outcome);
      return res.json({
        message: "Break started",
        log: await viewWithBreaks(pool, outcome.row, now, outcome.breaks),
        ...statusFields(now),
      });
    } catch (err) {
      // Defence in depth: the one-open-pause index rejected a second open break.
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        return sendRefusal(res, refusal(409, "BREAK_ALREADY_OPEN", "A break is already running."));
      }
      console.error(err);
      return res.status(500).json({ error: "Server error starting break" });
    }
  },
);

router.post(
  "/break/end",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const workerId = getAuthenticatedWorkerId(req);
      const now = new Date();
      await closeOverdueShifts(now, { workerId });
      const outcome = await withTransaction(async (client) => {
        const shift = await lockActiveShift(client, workerId);
        if (!shift) return NO_ACTIVE_SHIFT;
        const ended = await client.query(
          `UPDATE shift_pauses SET ended_at = GREATEST(started_at, $2)
           WHERE shift_id = $1 AND kind = 'break' AND ended_at IS NULL
           RETURNING id`,
          [shift.id, now],
        );
        if (ended.rows.length === 0) {
          return refusal(409, "NO_OPEN_BREAK", "There is no break to end.");
        }
        return { row: shift, breaks: await loadBreaks(client, shift.id) };
      });
      if (isRefusal(outcome)) return sendRefusal(res, outcome);
      return res.json({
        message: "Break ended",
        log: await viewWithBreaks(pool, outcome.row, now, outcome.breaks),
        ...statusFields(now),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error ending break" });
    }
  },
);

// 4. END WORK. The Finish tap is the paid end; see computeShiftPay for the rules.
// An open break ends at the finish.
router.post(
  "/end-work",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
  try {
    const workerId = getAuthenticatedWorkerId(req);
    const now = new Date();
    const autoClosed = await closeOverdueShifts(now, { workerId });

    // The row lock stops a lunch or break starting between this read and the update.
    const outcome = await withTransaction(async (client) => {
      const log = await lockActiveShift(client, workerId);
      if (!log) return null;
      return completeShift(client, log, now, { autoClosed: false });
    });

    if (!outcome) {
      const { maxShiftHours } = getWorkRules();
      return res.status(404).json({
        error: autoClosed > 0
          ? `Your shift was closed automatically after ${maxShiftHours} hours.`
          : "No active shift found for today",
        code: "NO_ACTIVE_SHIFT",
      });
    }

    const { pay, row, breaks } = outcome;
    const shift = await viewWithBreaks(pool, row, now, breaks);
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
        break_minutes: pay.breakMinutes,
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
