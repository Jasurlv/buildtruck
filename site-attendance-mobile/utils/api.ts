import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { stopBackgroundGeofenceMonitoring } from "./backgroundGeofence";
import { recordServerTime } from "./serverClock";

export const SESSION_EXPIRED_REASON = "session-expired";
export const SESSION_EXPIRED_MESSAGE = "Your session expired. Please log in again.";

// Everything tied to the signed-in worker; cleared together when the session ends.
const SESSION_KEYS = [
  "worker_token",
  "worker_data",
  "shift_start_time", // legacy: written by the removed stopwatch, cleared for old installs
  "shift_lunch_paused",
  "geofence_last_result",
];

export function getApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const baseUrl =
    configuredUrl ||
    (__DEV__ ? "http://172.20.10.3:5000/api" : "");

  if (!baseUrl) {
    throw new Error("Set EXPO_PUBLIC_API_URL to the deployed HTTPS API URL.");
  }
  if (!__DEV__ && !baseUrl.startsWith("https://")) {
    throw new Error("The production API URL must use HTTPS.");
  }
  const normalizedUrl = baseUrl.replace(/\/+$/, "");
  if (!normalizedUrl.endsWith("/api")) {
    throw new Error("EXPO_PUBLIC_API_URL must end with /api.");
  }
  return normalizedUrl;
}

/**
 * Thrown by workerFetch when the session is missing or rejected (HTTP 401).
 * By then the session is already cleared and the login screen is opening, so
 * screens should not show their own error for it.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

let sessionEndHandled = false;

/** Store a fresh login. Re-arms the session-expired redirect. */
export async function startWorkerSession(token: string, worker: unknown): Promise<void> {
  await SecureStore.setItemAsync("worker_token", token);
  await SecureStore.setItemAsync("worker_data", JSON.stringify(worker));
  sessionEndHandled = false;
}

// Several requests can fail with 401 at once (e.g. on app start); only the first
// one clears the session and navigates.
async function endExpiredSession(): Promise<void> {
  if (sessionEndHandled) return;
  sessionEndHandled = true;
  try {
    await stopBackgroundGeofenceMonitoring();
  } catch (error) {
    console.error("Unable to stop background location after session expiry:", error);
  }
  await Promise.all(SESSION_KEYS.map((key) => SecureStore.deleteItemAsync(key)));
  router.replace({ pathname: "/login", params: { reason: SESSION_EXPIRED_REASON } });
}

/**
 * fetch() for authenticated worker endpoints. `path` is relative to the API base
 * URL, e.g. "/attendance/active". A missing token or a 401 response ends the
 * session centrally and throws SessionExpiredError.
 */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await SecureStore.getItemAsync("worker_token");
  if (!token) {
    await endExpiredSession();
    throw new SessionExpiredError();
  }

  const requestStartedAt = Date.now();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    // "no-store" makes fetch add a unique ?_= parameter to GET requests, so iOS
    // never serves a cached response (with a stale Date header or shift data).
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  });
  recordServerTime(response, requestStartedAt);
  if (response.status === 401) {
    await endExpiredSession();
    throw new SessionExpiredError();
  }
  return response;
}
