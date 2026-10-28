import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "buildtruck_super_secret_key_2026";

// Worker Login Route
router.post("/login", async (req: Request, res: Response): Promise<any> => {
  const { username, password } = req.body;

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
      { id: worker.id, username: worker.username, role: "worker" },
      JWT_SECRET,
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
