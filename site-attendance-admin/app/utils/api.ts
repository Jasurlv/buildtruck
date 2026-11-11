import { recordServerTime } from "./serverClock";

export function getAdminApiUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  const baseUrl =
    configuredUrl ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:5000/api"
      : "");

  if (!baseUrl) {
    throw new Error("Set NEXT_PUBLIC_API_URL to the deployed HTTPS API URL.");
  }
  if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
    throw new Error("The production API URL must use HTTPS.");
  }
  const normalizedUrl = baseUrl.replace(/\/+$/, "");
  if (!normalizedUrl.endsWith("/api")) {
    throw new Error("NEXT_PUBLIC_API_URL must end with /api.");
  }
  return normalizedUrl;
}

export async function adminFetch(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const requestStartedAt = Date.now();
  const response = await fetch(`${getAdminApiUrl()}${path}`, {
    // A response reused from the browser cache would carry a stale Date header.
    cache: "no-store",
    ...init,
    headers,
  });
  recordServerTime(response, requestStartedAt);
  return response;
}