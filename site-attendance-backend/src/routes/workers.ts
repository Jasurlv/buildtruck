import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";

const router = Router();

// GET all workers
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await pool.query(`
      SELECT w.*, b.name AS building_name 
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
  const { full_name, username, password, hourly_rate, assigned_building_id } =
    req.body;
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
      `INSERT INTO workers (full_name, username, password, hourly_rate, assigned_building_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [full_name, username, hashedPassword, hourly_rate, assigned_building_id],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error creating worker" });
  }
});

// PUT update worker with unique username check
router.put("/:id", async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const { full_name, username, password, hourly_rate, assigned_building_id } =
    req.body;
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

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += `, password = $5 WHERE id = $6 RETURNING *`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE id = $5 RETURNING *`;
      params.push(id);
    }

    const result = await pool.query(query, params);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error updating worker" });
  }
});

// DELETE worker
router.delete("/:id", async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM workers WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error deleting worker" });
  }
});

export default router;
