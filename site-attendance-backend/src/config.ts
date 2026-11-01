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
export function getTrustProxyHops(): number {
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
