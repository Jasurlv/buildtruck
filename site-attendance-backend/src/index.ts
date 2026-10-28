import express from "express";
import cors from "cors";
import "./config.js";
import pool from "./db/pool.js";
import buildingRoutes from "./routes/buildings.js";
import workerRoutes from "./routes/workers.js";
import attendanceRoutes from "./routes/attendance.js";
import adminRoutes from "./routes/admin.js";
import workerAuthRoutes from "./routes/workerAuth.js";
import reportRoutes from "./routes/reports.js";
import { getJwtSecret } from "./config.js";
import { requireRole } from "./middleware/auth.js";

getJwtSecret();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/buildings", requireRole("admin"), buildingRoutes);
app.use("/api/workers", requireRole("admin"), workerRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/worker-auth", workerAuthRoutes);
app.use("/api/reports", requireRole("admin"), reportRoutes);

app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Site Attendance API is running!",
      db_time: result.rows[0].now,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
