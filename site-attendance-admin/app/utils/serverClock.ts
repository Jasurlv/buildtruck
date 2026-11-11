// API server clock minus computer clock, so report dates do not depend on the
// admin's computer clock being right. Updated from every API response.
let serverOffsetMs = 0;

/**
 * Records the server time from a response's HTTP `Date` header. The header has
 * 1-second resolution (truncated), so compare it against the middle of the
 * request's round trip plus half a second.
 *
 * The API is on another origin, so browsers only reveal this header if the API
 * sends `Access-Control-Expose-Headers: Date`. Without it the header reads as
 * null and the computer clock is used.
 */
export function recordServerTime(response: Response, requestStartedAt: number): void {
  const header = response.headers.get("date");
  const serverMs = header ? Date.parse(header) : NaN;
  if (!Number.isFinite(serverMs)) return;
  const midpoint = (requestStartedAt + Date.now()) / 2;
  serverOffsetMs = serverMs + 500 - midpoint;
}

/** Current time according to the server (the computer clock until a Date header has been read). */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}
