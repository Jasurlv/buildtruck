import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config.js";

const router = Router();

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
      "SELECT id, username, password_hash FROM admins WHERE LOWER(username) = LOWER($1)",
      [username],
    );
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: "Invalid admin username or password" });
    }

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: "admin" },
      getJwtSecret(),
      { expiresIn: "30m" },
    );
    return res.json({ success: true, token });
  } catch (error) {
    console.error("Admin login failed:", error);
    return res.status(500).json({ error: "Unable to sign in" });
  }
});

export default router;