import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  getAppTimezone,
  getCorsOrigins,
  getHost,
  getJwtSecret,
  getPort,
  getTrustProxyHops,
} from "./config.js";
import pool from "./db/pool.js";
import buildingRoutes from "./routes/buildings.js";
import workerRoutes from "./routes/workers.js";
import attendanceRoutes from "./routes/attendance.js";
import adminRoutes from "./routes/admin.js";
import workerAuthRoutes from "./routes/workerAuth.js";
import reportRoutes from "./routes/reports.js";
import { requireRole } from "./middleware/auth.js";

// Fail fast on missing or invalid configuration instead of on the first request.
getJwtSecret();
getAppTimezone();
const PORT = getPort();
const HOST = getHost();
const corsOrigins = getCorsOrigins();

const app = express();
app.set("trust proxy", getTrustProxyHops());

app.use(helmet());
app.use(cors(corsOrigins ? { origin: corsOrigins } : undefined));
app.use(express.json({ limit: "100kb" }));

// Only failed attempts count, so workers sharing a site network are not locked out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many failed login attempts. Try again in 15 minutes." },
});

// Routes
app.use("/api/admin/login", loginLimiter);
app.use("/api/worker-auth/login", loginLimiter);
app.use("/api/admin", adminRoutes);
app.use("/api/buildings", requireRole("admin"), buildingRoutes);
app.use("/api/workers", requireRole("admin"), workerRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/worker-auth", workerAuthRoutes);
app.use("/api/reports", requireRole("admin"), reportRoutes);

const healthCheck: RequestHandler = async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Site Attendance API is running!",
      db_time: result.rows[0].now,
    });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "Database connection failed" });
  }
};
app.get("/", healthCheck);
app.get("/api/health", healthCheck);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Malformed JSON and oversized bodies arrive here as 4xx errors; anything else is a bug.
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = Number(err?.status);
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: err.expose ? err.message : "Bad request" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const onListen = (error?: Error) => {
  if (error) throw error;
  console.log(`Server is running on ${HOST ?? "all interfaces"}, port ${PORT}`);
};
const server = HOST ? app.listen(PORT, HOST, onListen) : app.listen(PORT, onListen);

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
