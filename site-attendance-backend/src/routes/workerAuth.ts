import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config.js";

const router = Router();

// Worker Login Route
router.post("/login", async (req: Request, res: Response): Promise<any> => {
  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const result = await pool.query(
      `SELECT w.*, b.name AS building_name, b.address AS building_address, b.latitude, b.longitude, b.radius_meters 
       FROM workers w 
       LEFT JOIN buildings b ON w.assigned_building_id = b.id 
       WHERE LOWER(w.username) = LOWER($1)`,
      [username],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const worker = result.rows[0];
    const isMatch = await bcrypt.compare(password, worker.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Generate token for worker
    const token = jwt.sign(
      { workerId: Number(worker.id), username: worker.username, role: "worker" },
      getJwtSecret(),
      { expiresIn: "7d" }, // Longer session for mobile workers
    );

    // Return worker info along with token (excluding password)
    delete worker.password;
    return res.json({ success: true, token, worker });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error during worker login" });
  }
});

export default router;
