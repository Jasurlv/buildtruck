import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import { getAuthenticatedWorkerId, requireRole } from "../middleware/auth.js";

const router = Router();

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
      const result = await pool.query(
        `SELECT * FROM attendance_logs
         WHERE worker_id = $1 AND end_work_time IS NULL
         ORDER BY punch_in_time DESC
         LIMIT 1`,
        [workerId],
      );
      return res.json({ activeShift: result.rows[0] || null });
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
                a.daily_earned
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
    const today = new Date().toISOString().split("T")[0];

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

    // Insert attendance log
    const newLog = await pool.query(
      `INSERT INTO attendance_logs (worker_id, building_id, work_date, punch_in_time, status)
       VALUES ($1, $2, $3, NOW(), 'Present') RETURNING *`,
      [workerId, worker.building_id, today],
    );

    return res
      .status(201)
      .json({ message: "Punched in successfully!", log: newLog.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error during punch in" });
  }
  },
);

// 2. START LUNCH
router.post(
  "/lunch-start",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const workerId = getAuthenticatedWorkerId(req);

      const updated = await pool.query(
        `UPDATE attendance_logs 
       SET lunch_start_time = NOW() 
       WHERE id = (
         SELECT id FROM attendance_logs
         WHERE worker_id = $1 AND end_work_time IS NULL
         ORDER BY punch_in_time DESC
         LIMIT 1
       )
       RETURNING *`,
        [workerId],
      );

      if (updated.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "No active punch-in found for today" });
      }

      return res.json({ message: "Lunch started", log: updated.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error starting lunch" });
    }
  },
);

// 3. END LUNCH
router.post(
  "/lunch-end",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const workerId = getAuthenticatedWorkerId(req);

    const updated = await pool.query(
      `UPDATE attendance_logs 
       SET lunch_end_time = NOW() 
       WHERE id = (
         SELECT id FROM attendance_logs
         WHERE worker_id = $1 AND end_work_time IS NULL
         ORDER BY punch_in_time DESC
         LIMIT 1
       )
       RETURNING *`,
      [workerId],
    );

    if (updated.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No active attendance record found" });
    }

    return res.json({
      message: "Lunch ended. Back to work!",
      log: updated.rows[0],
    });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error ending lunch" });
    }
  },
);

// 4. END WORK (Calculate Total Hours & Daily Pay with Late Penalty rules)
router.post(
  "/end-work",
  requireRole("worker"),
  async (req: Request, res: Response): Promise<any> => {
  try {
    const workerId = getAuthenticatedWorkerId(req);

    const logRes = await pool.query(
      `SELECT a.*, w.hourly_rate
       FROM attendance_logs a
       JOIN workers w ON w.id = a.worker_id
       WHERE a.worker_id = $1 AND a.end_work_time IS NULL
       ORDER BY a.punch_in_time DESC
       LIMIT 1`,
      [workerId],
    );

    if (logRes.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No active shift found for today" });
    }

    const log = logRes.rows[0];
    const punchIn = new Date(log.punch_in_time);
    const endWork = new Date();

    let workedMs = endWork.getTime() - punchIn.getTime();

    // Subtract the recorded lunch, or the default one-hour break when none was recorded.
    if (log.lunch_start_time) {
      const lunchEnd = log.lunch_end_time
        ? new Date(log.lunch_end_time)
        : endWork;
      const lunchMs =
        lunchEnd.getTime() - new Date(log.lunch_start_time).getTime();
      workedMs -= lunchMs;
    } else {
      workedMs -= 3600000; // deduct standard 1 hour lunch
    }

    const workedHours = Math.max(
      0,
      parseFloat((workedMs / (1000 * 60 * 60)).toFixed(2)),
    );

    const workerHourlyRate = Number(log.hourly_rate);
    const hourlyRate =
      Number.isFinite(workerHourlyRate) && workerHourlyRate >= 0
        ? workerHourlyRate
        : 6.25;
    const dailyEarned = parseFloat((workedHours * hourlyRate).toFixed(2));

    const finalUpdate = await pool.query(
      `UPDATE attendance_logs 
       SET end_work_time = $1,
           lunch_end_time = CASE
             WHEN lunch_start_time IS NOT NULL AND lunch_end_time IS NULL THEN $1
             ELSE lunch_end_time
           END,
           total_worked_hours = $2, daily_earned = $3, status = 'Completed'
       WHERE id = $4 AND end_work_time IS NULL RETURNING *`,
      [endWork, workedHours, dailyEarned, log.id],
    );

    return res.json({
      message: "Work day ended successfully!",
      summary: {
        worked_hours: workedHours,
        earned_today: dailyEarned,
      },
      log: finalUpdate.rows[0],
      },
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error ending work" });
  }
});

export default router;
