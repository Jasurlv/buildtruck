// Address search via the public Nominatim service (OpenStreetMap).
//
// PRODUCTION: replace public Nominatim with a geocoding service that uses an API
// key, or route requests through our own backend proxy. Nominatim's usage policy
// allows about 1 request per second, forbids search-as-you-type, and may block
// clients without notice.

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const MIN_REQUEST_GAP_MS = 1000;

export type GeocodeResult = { latitude: number; longitude: number };

/** The service failed or refused the request (network error, 429, 403, ...). */
export class GeocodingUnavailableError extends Error {
  constructor() {
    super("Address search is unavailable");
    this.name = "GeocodingUnavailableError";
  }
}

// Per page session, keyed by normalized query; null means "no match". Failures
// are not cached, so a later search can retry.
const cache = new Map<string, GeocodeResult | null>();
let nextRequestAllowedAt = 0;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Returns the best match for `query`, or null if there is none. Throws
 * GeocodingUnavailableError when the service fails, and rejects with the abort
 * reason when `signal` is aborted.
 */
export async function geocodeAddress(
  query: string,
  signal: AbortSignal,
): Promise<GeocodeResult | null> {
  const text = query.trim();
  const key = text.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Reserve the next free slot so requests are always at least 1 s apart, even
  // if this one is cancelled while waiting.
  const sendAt = Math.max(Date.now(), nextRequestAllowedAt);
  nextRequestAllowedAt = sendAt + MIN_REQUEST_GAP_MS;
  await wait(sendAt - Date.now(), signal);
  // Timers can fire late; count the gap from when the request is really sent.
  nextRequestAllowedAt = Math.max(nextRequestAllowedAt, Date.now() + MIN_REQUEST_GAP_MS);

  let data: unknown;
  try {
    const response = await fetch(
      `${NOMINATIM_SEARCH_URL}?format=json&limit=1&q=${encodeURIComponent(text)}`,
      { signal, headers: { Accept: "application/json" } },
    );
    if (!response.ok) throw new GeocodingUnavailableError();
    data = await response.json();
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error instanceof GeocodingUnavailableError
      ? error
      : new GeocodingUnavailableError();
  }

  const first = Array.isArray(data) ? data[0] : undefined;
  const latitude = Number(first?.lat);
  const longitude = Number(first?.lon);
  const result =
    first && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
  cache.set(key, result);
  return result;
}
