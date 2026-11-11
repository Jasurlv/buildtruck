import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import {
  getAppTimezone,
  getCorsOrigins,
  getHost,
  getJwtSecret,
  getPort,
  getTrustProxyHops,
  getWorkRules,
} from "./config.js";
import pool from "./db/pool.js";
import buildingRoutes from "./routes/buildings.js";
import workerRoutes from "./routes/workers.js";
import attendanceRoutes from "./routes/attendance.js";
import adminRoutes from "./routes/admin.js";
import workerAuthRoutes from "./routes/workerAuth.js";
import reportRoutes from "./routes/reports.js";
import shiftRoutes from "./routes/shifts.js";
import { requireRole } from "./middleware/auth.js";
import { closeOverdueShifts } from "./shiftStore.js";

// Fail fast on missing or invalid configuration instead of on the first request.
getJwtSecret();
getAppTimezone();
getWorkRules();
const PORT = getPort();
const HOST = getHost();
const corsOrigins = getCorsOrigins();

const app = express();
app.set("trust proxy", getTrustProxyHops());

app.use(helmet());
// Browsers hide the Date header cross-origin unless it is exposed; the admin
// dashboard reads it to use the server's clock instead of the computer's.
app.use(cors({ ...(corsOrigins ? { origin: corsOrigins } : {}), exposedHeaders: ["Date"] }));
app.use(express.json({ limit: "100kb" }));

// Login throttling counts failed attempts only. Workers often share one public IP
// (site Wi-Fi, mobile carrier NAT), so the strict limit is per IP + username: one
// person mistyping cannot lock out colleagues. A looser per-IP limit stops one
// client from guessing passwords across many usernames.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginLimitOptions = {
  windowMs: LOGIN_WINDOW_MS,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many failed login attempts. Try again in 15 minutes." },
} as const;
const loginPerIpLimiter = rateLimit({ ...loginLimitOptions, limit: 100 });
const loginPerAccountLimiter = rateLimit({
  ...loginLimitOptions,
  limit: 10,
  keyGenerator: (req) => {
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}|${username}`;
  },
});

// Routes
app.use(
  ["/api/admin/login", "/api/worker-auth/login"],
  loginPerIpLimiter,
  loginPerAccountLimiter,
);
app.use("/api/admin", adminRoutes);
app.use("/api/buildings", requireRole("admin"), buildingRoutes);
app.use("/api/workers", requireRole("admin"), workerRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/worker-auth", workerAuthRoutes);
app.use("/api/reports", requireRole("admin"), reportRoutes);
app.use("/api/shifts", requireRole("admin"), shiftRoutes);

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

// Closes shifts left running past MAX_SHIFT_HOURS. Requests that read or start shifts
// also check (lazily), so a missed tick is never visible; this keeps reports and the
// database current when nobody is using the app. `new Date()` is the clock, so the
// e2e fake clock (test/fakeClock.mjs) applies here too.
const AUTO_CLOSE_INTERVAL_MS = 60_000;
let autoCloseRunning = false;
async function autoCloseTick(): Promise<void> {
  if (autoCloseRunning) return; // a slow run must not overlap the next one
  autoCloseRunning = true;
  try {
    const closed = await closeOverdueShifts(new Date());
    if (closed > 0) console.log(`Auto-closed ${closed} shift(s) past the maximum length`);
  } catch (error) {
    console.error("Auto-close check failed:", error);
  } finally {
    autoCloseRunning = false;
  }
}
void autoCloseTick();
const autoCloseTimer = setInterval(() => void autoCloseTick(), AUTO_CLOSE_INTERVAL_MS);

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  clearInterval(autoCloseTimer);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
