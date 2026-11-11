import { Router, type Request, type Response } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { getWorkRules } from "../config.js";
import {
  computeShiftPay,
  effectiveHourlyRate,
  toPauseInterval,
  type ShiftRow,
} from "../shiftRules.js";
import { closeOverdueShifts, loadBreaks } from "../shiftStore.js";
import { parseId, parseText } from "../validation.js";

const router = Router();

const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;
const MAX_LUNCH_MINUTES = 480;
const REASON_MAX_LENGTH = 500;

type Failure = { status: number; code: string; error: string };
const failure = (status: number, code: string, error: string): Failure => ({ status, code, error });
const isFailure = (value: object): value is Failure => "code" in value;
const send = (res: Response, { status, code, error }: Failure) =>
  res.status(status).json({ error, code });

/** An ISO 8601 instant with an explicit offset, so its meaning never depends on the server. */
function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const iso = (value: unknown) => (value ? new Date(value as string | Date).toISOString() : null);
const numeric = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function auditSnapshot(row: ShiftRow) {
  return {
    paid_start_at: iso(row.paid_start_at),
    finish_at: iso(row.end_work_time),
    lunch_minutes: row.lunch_minutes ?? null,
    lunch_deducted_minutes: numeric(row.lunch_deducted_minutes),
    break_minutes: numeric(row.break_minutes),
    total_worked_hours: numeric(row.total_worked_hours),
    daily_earned: numeric(row.daily_earned),
  };
}

// PATCH /api/shifts/:id
// Body: { reason, paid_start_at?, finish_at?, lunch_minutes? }. Hours and earnings are
// recalculated by the same rules as a normal finish (lunch, breaks), and the change is
// written to shift_adjustments in the same transaction. Setting finish_at on a running
// shift ends it, and ends an open break at that time.
router.patch("/:id", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) return send(res, failure(404, "SHIFT_NOT_FOUND", "Shift not found"));

  const body = req.body ?? {};
  const reason = parseText(body.reason, REASON_MAX_LENGTH);
  if (!reason) {
    return send(res, failure(400, "REASON_REQUIRED", `A reason of at most ${REASON_MAX_LENGTH} characters is required.`));
  }

  const has = (field: string) => body[field] !== undefined;
  if (!has("paid_start_at") && !has("finish_at") && !has("lunch_minutes")) {
    return send(res, failure(400, "NO_FIELDS", "Provide paid_start_at, finish_at or lunch_minutes."));
  }

  const requestedPaidStart = has("paid_start_at") ? parseInstant(body.paid_start_at) : null;
  const requestedFinish = has("finish_at") ? parseInstant(body.finish_at) : null;
  if ((has("paid_start_at") && !requestedPaidStart) || (has("finish_at") && !requestedFinish)) {
    return send(res, failure(400, "INVALID_TIMESTAMP", "Times must be ISO 8601 with a timezone, e.g. 2026-11-08T08:15:00+02:00."));
  }
  const requestedLunch: number | null = has("lunch_minutes") ? body.lunch_minutes : null;
  if (
    has("lunch_minutes") &&
    (!Number.isInteger(requestedLunch) || requestedLunch! < 0 || requestedLunch! > MAX_LUNCH_MINUTES)
  ) {
    return send(res, failure(400, "INVALID_LUNCH_MINUTES", `lunch_minutes must be a whole number from 0 to ${MAX_LUNCH_MINUTES}.`));
  }

  const now = new Date();
  try {
    // A running shift past the limit is closed first; the correction then applies to it.
    await closeOverdueShifts(now);
    const outcome = await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT a.*, w.hourly_rate
         FROM attendance_logs a
         LEFT JOIN workers w ON w.id = a.worker_id
         WHERE a.id = $1
         FOR UPDATE OF a`,
        [id],
      );
      const row: ShiftRow | undefined = found.rows[0];
      if (!row) return failure(404, "SHIFT_NOT_FOUND", "Shift not found");

      const paidStart = requestedPaidStart ?? new Date(row.paid_start_at ?? row.punch_in_time);
      const finish = requestedFinish ?? (row.end_work_time ? new Date(row.end_work_time) : null);
      if (!finish) {
        return failure(409, "SHIFT_STILL_ACTIVE", "This shift is still running: provide finish_at to end it.");
      }
      if (requestedPaidStart || requestedFinish) {
        if (finish <= paidStart || finish.getTime() - paidStart.getTime() > MAX_SHIFT_MS) {
          return failure(400, "INVALID_SHIFT_TIMES", "finish_at must be after paid_start_at and within 24 hours of it.");
        }
        if (finish > now) {
          return failure(400, "FINISH_IN_FUTURE", "finish_at cannot be in the future.");
        }
      }

      const lunchStartedAt = row.lunch_start_time ? new Date(row.lunch_start_time) : null;
      const lunchMinutes: number | null = requestedLunch ?? row.lunch_minutes ?? null;
      let lunchPlannedEndAt = row.lunch_planned_end_at ? new Date(row.lunch_planned_end_at) : null;
      if (requestedLunch !== null && lunchStartedAt) {
        // Capped at the finish so the admin's figure is deducted exactly, even for
        // a shift that originally finished during lunch.
        lunchPlannedEndAt = new Date(
          Math.min(lunchStartedAt.getTime() + requestedLunch * 60_000, finish.getTime()),
        );
      }

      const unchanged =
        paidStart.getTime() === new Date(row.paid_start_at ?? row.punch_in_time).getTime() &&
        finish.getTime() === (row.end_work_time ? new Date(row.end_work_time).getTime() : NaN) &&
        lunchMinutes === (row.lunch_minutes ?? null);
      if (unchanged) return failure(400, "NO_CHANGES", "These values are already on the shift.");

      if (!row.end_work_time) {
        // Ending a running shift: a break still open ends at the finish.
        await client.query(
          `UPDATE shift_pauses SET ended_at = GREATEST(started_at, $2)
           WHERE shift_id = $1 AND ended_at IS NULL`,
          [id, finish],
        );
      }
      const breaks = (await loadBreaks(client, id)).map(toPauseInterval);

      // Keeps the rate the shift was paid at; older shifts have none stored.
      const hourlyRate = effectiveHourlyRate(row.hourly_rate_applied ?? row.hourly_rate);
      const pay = computeShiftPay(
        { paidStart, finish, lunchStartedAt, lunchMinutes, lunchPlannedEndAt, breaks },
        getWorkRules(),
        hourlyRate,
      );
      const lunchEnd =
        lunchStartedAt && lunchPlannedEndAt
          ? new Date(Math.min(lunchPlannedEndAt.getTime(), finish.getTime()))
          : (row.lunch_end_time ?? null);

      const updated = await client.query(
        `UPDATE attendance_logs
         SET paid_start_at = $1, end_work_time = $2, lunch_minutes = $3,
             lunch_planned_end_at = $4, lunch_end_time = $5, lunch_deducted_minutes = $6,
             total_worked_hours = $7, daily_earned = $8, hourly_rate_applied = $9,
             break_minutes = $10, status = 'Completed'
         WHERE id = $11
         RETURNING *`,
        [paidStart, finish, lunchMinutes, lunchPlannedEndAt, lunchEnd, pay.lunchDeductedMinutes,
         pay.workedHours, pay.earned, hourlyRate, pay.breakMinutes, id],
      );
      const shift: ShiftRow = updated.rows[0];
      const adjustment = await client.query(
        `INSERT INTO shift_adjustments
           (attendance_log_id, admin_id, admin_username, reason, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, req.auth?.adminId ?? null, req.auth?.username ?? "unknown", reason,
         JSON.stringify(auditSnapshot(row)), JSON.stringify(auditSnapshot(shift))],
      );
      return { shift, adjustment: adjustment.rows[0] };
    });

    if (isFailure(outcome)) return send(res, outcome);
    return res.json(outcome);
  } catch (error) {
    console.error("Shift correction failed:", error);
    return res.status(500).json({ error: "Unable to correct this shift" });
  }
});

// GET /api/shifts/:id/adjustments: the audit trail, newest first.
router.get("/:id/adjustments", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) return send(res, failure(404, "SHIFT_NOT_FOUND", "Shift not found"));
  try {
    const result = await pool.query(
      `SELECT * FROM shift_adjustments WHERE attendance_log_id = $1 ORDER BY id DESC`,
      [id],
    );
    return res.json({ adjustments: result.rows });
  } catch (error) {
    console.error("Shift adjustments query failed:", error);
    return res.status(500).json({ error: "Unable to load shift adjustments" });
  }
});

export default router;
