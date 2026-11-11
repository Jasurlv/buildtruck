// Database steps shared by finishing a shift (worker tap), closing it automatically
// and showing it: breaks, completion and the auto-close sweep.
import type { QueryResult } from "pg";
import pool, { withTransaction } from "./db/pool.js";
import { getWorkRules } from "./config.js";
import {
  computeShiftPay,
  effectiveHourlyRate,
  toPauseInterval,
  type PauseRow,
  type ShiftRow,
} from "./shiftRules.js";

const HOUR_MS = 60 * 60 * 1000;

/** The pool or a transaction's client. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<QueryResult<any>> };

/** The shift's breaks, oldest first. */
export async function loadBreaks(db: Db, shiftId: number): Promise<PauseRow[]> {
  const result = await db.query(
    `SELECT id, started_at, ended_at FROM shift_pauses
     WHERE shift_id = $1 AND kind = 'break'
     ORDER BY started_at, id`,
    [shiftId],
  );
  return result.rows;
}

/**
 * Ends a running shift at `finish`: closes an open break at the finish, applies the
 * pay rules and stores the result. `row` must be locked (SELECT ... FOR UPDATE) by the
 * caller's transaction and include the worker's hourly_rate. Returns null if the shift
 * was already completed (the UPDATE only touches a running shift).
 */
export async function completeShift(
  db: Db,
  row: ShiftRow,
  finish: Date,
  { autoClosed }: { autoClosed: boolean },
) {
  await db.query(
    `UPDATE shift_pauses SET ended_at = GREATEST(started_at, $2)
     WHERE shift_id = $1 AND ended_at IS NULL`,
    [row.id, finish],
  );
  const breaks = await loadBreaks(db, row.id);
  const hourlyRate = effectiveHourlyRate(row.hourly_rate);
  const pay = computeShiftPay(
    {
      paidStart: new Date(row.paid_start_at ?? row.punch_in_time),
      finish,
      lunchStartedAt: row.lunch_start_time ? new Date(row.lunch_start_time) : null,
      lunchMinutes: row.lunch_minutes ?? null,
      lunchPlannedEndAt: row.lunch_planned_end_at ? new Date(row.lunch_planned_end_at) : null,
      breaks: breaks.map(toPauseInterval),
    },
    getWorkRules(),
    hourlyRate,
  );
  const updated = await db.query(
    `UPDATE attendance_logs
     SET end_work_time = $1,
         lunch_end_time = CASE WHEN lunch_start_time IS NOT NULL
                               THEN LEAST(lunch_end_time, $1) ELSE lunch_end_time END,
         lunch_deducted_minutes = $2, break_minutes = $3,
         total_worked_hours = $4, daily_earned = $5, hourly_rate_applied = $6,
         status = 'Completed', auto_closed = $7
     WHERE id = $8 AND end_work_time IS NULL
     RETURNING *`,
    [finish, pay.lunchDeductedMinutes, pay.breakMinutes, pay.workedHours, pay.earned,
     hourlyRate, autoClosed, row.id],
  );
  const shift: ShiftRow | undefined = updated.rows[0];
  return shift ? { pay, row: shift, breaks } : null;
}

const OVERDUE = `
  a.end_work_time IS NULL
  AND COALESCE(a.paid_start_at, a.punch_in_time) + make_interval(secs => $2::float8 * 3600) <= $1`;

/**
 * Closes every running shift whose paid start is at least MAX_SHIFT_HOURS before
 * `now`, finishing it exactly MAX_SHIFT_HOURS after paid start with the normal
 * deductions. Optionally limited to one worker's shifts.
 *
 * Idempotent and safe to run concurrently (the timer and the lazy checks): rows are
 * locked, and a row another transaction completed meanwhile no longer matches
 * `end_work_time IS NULL`, so it is skipped. Returns the number of shifts closed.
 */
export async function closeOverdueShifts(
  now: Date,
  { workerId }: { workerId?: number } = {},
): Promise<number> {
  const maxShiftHours = getWorkRules().maxShiftHours;
  const params: unknown[] = [now, maxShiftHours];
  const byWorker = workerId === undefined ? "" : `AND a.worker_id = $${params.push(workerId)}`;

  // Almost always nothing is due: answer that with one indexed read, no transaction.
  const due = await pool.query(
    `SELECT 1 FROM attendance_logs a WHERE ${OVERDUE} ${byWorker} LIMIT 1`,
    params,
  );
  if (due.rows.length === 0) return 0;

  return withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT a.*, w.hourly_rate
       FROM attendance_logs a
       LEFT JOIN workers w ON w.id = a.worker_id
       WHERE ${OVERDUE} ${byWorker}
       ORDER BY a.id
       FOR UPDATE OF a`,
      params,
    );
    let closed = 0;
    for (const row of locked.rows as ShiftRow[]) {
      const paidStart = new Date(row.paid_start_at ?? row.punch_in_time);
      const finish = new Date(paidStart.getTime() + maxShiftHours * HOUR_MS);
      if (await completeShift(client, row, finish, { autoClosed: true })) closed++;
    }
    return closed;
  });
}
