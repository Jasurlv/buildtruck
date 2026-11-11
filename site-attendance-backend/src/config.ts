import dotenv from "dotenv";

dotenv.config({ quiet: true });

export const isProduction = process.env.NODE_ENV === "production";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be configured");
  }
  return databaseUrl;
}

export function getPort(): number {
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  return port;
}

// Interface to bind to. Production sets 127.0.0.1 so only the reverse proxy can reach the API.
export function getHost(): string | undefined {
  return process.env.HOST || undefined;
}

// Number of reverse proxies in front of the API (1 behind nginx), used to read client IPs.
// Required in production: if it is wrong behind nginx, every client appears as 127.0.0.1
// and shares a single login rate-limit bucket.
export function getTrustProxyHops(): number {
  if (isProduction && !process.env.TRUST_PROXY) {
    throw new Error("TRUST_PROXY must be set in production (1 behind nginx, 0 if exposed directly)");
  }
  const hops = Number(process.env.TRUST_PROXY || 0);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error("TRUST_PROXY must be a non-negative integer");
  }
  return hops;
}

// Browser origins allowed to call the API (the admin dashboard). Native mobile apps are not subject to CORS.
export function getCorsOrigins(): string[] | undefined {
  const origins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    if (isProduction) {
      throw new Error("CORS_ORIGINS must list the admin dashboard origin(s) in production");
    }
    return undefined;
  }
  return origins;
}

// Timezone the building sites operate in; decides which calendar day a shift belongs to.
export function getAppTimezone(): string {
  const timezone = process.env.APP_TIMEZONE || "Europe/Riga";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new Error(`APP_TIMEZONE "${timezone}" is not a valid IANA timezone`);
  }
  return timezone;
}

export type WorkRules = {
  changingAllowanceMinutes: number;
  /** "HH:MM" in APP_TIMEZONE. */
  lunchOpensAt: string;
  /** "HH:MM" in APP_TIMEZONE; this whole minute still counts. */
  lunchLatestStart: string;
  lunchMinMinutes: number;
  lunchMaxMinutes: number;
  lunchDefaultDeductionMinutes: number;
  lunchAutoDeductMinShiftHours: number;
};

function numberEnv(name: string, fallback: number, integer = true): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a non-negative ${integer ? "whole " : ""}number`);
  }
  return value;
}

function clockEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${name} must be a 24-hour HH:MM time`);
  }
  return value;
}

let workRules: WorkRules | undefined;

// Attendance and pay rules. Times are interpreted in APP_TIMEZONE.
export function getWorkRules(): WorkRules {
  if (workRules) return workRules;
  const rules: WorkRules = {
    changingAllowanceMinutes: numberEnv("CHANGING_ALLOWANCE_MINUTES", 15),
    lunchOpensAt: clockEnv("LUNCH_OPENS_AT", "12:00"),
    lunchLatestStart: clockEnv("LUNCH_LATEST_START", "12:30"),
    // A worker picks a whole number of minutes from min to max (30-60 by default).
    lunchMinMinutes: numberEnv("LUNCH_MIN_MINUTES", 30),
    lunchMaxMinutes: numberEnv("LUNCH_MAX_MINUTES", 60),
    lunchDefaultDeductionMinutes: numberEnv("LUNCH_DEFAULT_DEDUCTION_MINUTES", 60),
    lunchAutoDeductMinShiftHours: numberEnv("LUNCH_AUTO_DEDUCT_MIN_SHIFT_HOURS", 5, false),
  };
  if (rules.lunchOpensAt > rules.lunchLatestStart) {
    throw new Error("LUNCH_OPENS_AT must not be later than LUNCH_LATEST_START");
  }
  if (rules.lunchMinMinutes > rules.lunchMaxMinutes) {
    throw new Error("LUNCH_MIN_MINUTES must not be greater than LUNCH_MAX_MINUTES");
  }
  workRules = rules;
  return rules;
}
