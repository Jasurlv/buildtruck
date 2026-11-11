// Server clock minus phone clock, so displayed work time does not depend on
// the phone's clock being right. Updated from every API response.
let serverOffsetMs = 0;

/**
 * Records the server time from a response's HTTP `Date` header. The header has
 * 1-second resolution (truncated), so compare it against the middle of the
 * request's round trip plus half a second.
 */
export function recordServerTime(response: Response, requestStartedAt: number): void {
  const header = response.headers.get("date");
  const serverMs = header ? Date.parse(header) : NaN;
  if (!Number.isFinite(serverMs)) return;
  const midpoint = (requestStartedAt + Date.now()) / 2;
  serverOffsetMs = serverMs + 500 - midpoint;
}

/** Current time according to the server (falls back to the phone clock until the first response). */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}
