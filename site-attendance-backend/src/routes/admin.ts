import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "buildtruck_super_secret_key_2026";

router.post("/login", (req: Request, res: Response): any => {
  const { username, password } = req.body;

  // Verify default admin credentials
  if (username === "admin" && password === "admin123") {
    // Generate JWT token expiring in 30 minutes
    const token = jwt.sign({ username: "admin", role: "superadmin" }, JWT_SECRET, { expiresIn: "30m" });
    return res.json({ success: true, token });
  }

  return res.status(401).json({ error: "Invalid admin username or password" });
});

export default router;