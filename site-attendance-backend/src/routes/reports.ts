import { Router, type Request, type Response } from "express";
import pool from "../db/pool.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

router.get("/", async (req: Request, res: Response): Promise<any> => {
  const endDefault = new Date().toISOString().slice(0, 10);
  const startDefault = new Date(Date.now() - 29 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const startDate = req.query.start_date ?? startDefault;
  const endDate = req.query.end_date ?? endDefault;

  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
    return res.status(400).json({
      error: "Provide valid start_date and end_date values (YYYY-MM-DD)",
    });
  }

  try {
    const result = await pool.query(
      `SELECT a.id, w.full_name, b.name AS building_name, a.work_date,
              a.punch_in_time, a.lunch_start_time, a.lunch_end_time,
              a.end_work_time, a.total_worked_hours, a.daily_earned
       FROM attendance_logs a
       JOIN workers w ON w.id = a.worker_id
       LEFT JOIN buildings b ON b.id = a.building_id
       WHERE a.work_date BETWEEN $1::date AND $2::date
       ORDER BY a.punch_in_time DESC
       LIMIT 5000`,
      [startDate, endDate],
    );
    const shifts = result.rows;
    return res.json({
      start_date: startDate,
      end_date: endDate,
      shifts,
      totals: {
        worked_hours: shifts.reduce(
          (sum: number, row: { total_worked_hours: string | number | null }) =>
            sum + Number(row.total_worked_hours || 0),
          0,
        ),
        earned: shifts.reduce(
          (sum: number, row: { daily_earned: string | number | null }) =>
            sum + Number(row.daily_earned || 0),
          0,
        ),
        shift_count: shifts.length,
      },
      truncated: shifts.length === 5000,
    });
  } catch (error) {
    console.error("Attendance report query failed:", error);
    return res.status(500).json({ error: "Unable to load attendance report" });
  }
});

export default router;
