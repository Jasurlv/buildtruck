import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  parseId,
  parseNumber,
  parseText,
  pgErrorCode,
} from "../validation.js";

const router = Router();

// bcrypt only uses the first 72 bytes of a password.
const MAX_PASSWORD_BYTES = 72;

function parseWorker(body: any) {
  const full_name = parseText(body?.full_name, 255);
  const username = parseText(body?.username, 100);
  const hourly_rate =
    body?.hourly_rate === undefined || body?.hourly_rate === null
      ? 6.25
      : parseNumber(body.hourly_rate);
  const hasBuilding =
    body?.assigned_building_id !== undefined &&
    body?.assigned_building_id !== null &&
    body?.assigned_building_id !== "";
  const assigned_building_id = hasBuilding ? parseId(body.assigned_building_id) : null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (
    !full_name ||
    !username ||
    !Number.isFinite(hourly_rate) ||
    hourly_rate < 0 ||
    hourly_rate > 10000 ||
    (hasBuilding && !assigned_building_id) ||
    Buffer.byteLength(password) > MAX_PASSWORD_BYTES
  ) {
    return null;
  }
  return { full_name, username, password, hourly_rate, assigned_building_id };
}

const INVALID_WORKER_ERROR =
  "Full name, username and a valid hourly rate are required (password at most 72 characters).";

function handleWriteError(err: unknown, res: Response, fallback: string) {
  const code = pgErrorCode(err);
  if (code === PG_UNIQUE_VIOLATION) {
    return res
      .status(400)
      .json({ error: "This username is already taken by another worker." });
  }
  if (code === PG_FOREIGN_KEY_VIOLATION) {
    return res.status(400).json({ error: "The assigned building does not exist." });
  }
  console.error(err);
  return res.status(500).json({ error: fallback });
}

// GET all workers
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await pool.query(`
      SELECT w.id, w.full_name, w.username, w.hourly_rate,
             w.assigned_building_id, b.name AS building_name
      FROM workers w
      LEFT JOIN buildings b ON w.assigned_building_id = b.id
      ORDER BY w.id DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error fetching workers" });
  }
});

// POST create worker with unique username check & password hashing
router.post("/", async (req: Request, res: Response): Promise<any> => {
  const worker = parseWorker(req.body);
  if (!worker) {
    return res.status(400).json({ error: INVALID_WORKER_ERROR });
  }
  if (!worker.password) {
    return res.status(400).json({ error: "A password is required for new workers." });
  }
  const { full_name, username, password, hourly_rate, assigned_building_id } = worker;
  try {
    const existing = await pool.query(
      `SELECT id FROM workers WHERE LOWER(username) = LOWER($1)`,
      [username],
    );
    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "This username is already taken by another worker." });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      `INSERT INTO workers (full_name, username, password, hourly_rate, assigned_building_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, username, hourly_rate, assigned_building_id`,
      [full_name, username, hashedPassword, hourly_rate, assigned_building_id],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    return handleWriteError(err, res, "Server error creating worker");
  }
});

// PUT update worker with unique username check
router.put("/:id", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Worker not found" });
  }
  const worker = parseWorker(req.body);
  if (!worker) {
    return res.status(400).json({ error: INVALID_WORKER_ERROR });
  }
  const { full_name, username, password, hourly_rate, assigned_building_id } = worker;
  try {
    const existing = await pool.query(
      `SELECT id FROM workers WHERE LOWER(username) = LOWER($1) AND id != $2`,
      [username, id],
    );
    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "This username is already taken by another worker." });
    }

    let query = `UPDATE workers SET full_name = $1, username = $2, hourly_rate = $3, assigned_building_id = $4`;
    let params: any[] = [
      full_name,
      username,
      hourly_rate,
      assigned_building_id,
    ];

    if (password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += `, password = $5 WHERE id = $6
                RETURNING id, full_name, username, hourly_rate, assigned_building_id`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE id = $5
                RETURNING id, full_name, username, hourly_rate, assigned_building_id`;
      params.push(id);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return handleWriteError(err, res, "Server error updating worker");
  }
});

// DELETE worker
router.delete("/:id", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Worker not found" });
  }
  try {
    const result = await pool.query(`DELETE FROM workers WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error deleting worker" });
  }
});

export default router;
