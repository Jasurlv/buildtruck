// Maps the API's (English) error responses to translation keys, so errors appear
// in the selected language. By `code` when the API sends one, otherwise by the
// known message or the HTTP status; anything unknown gets a general message.
import type { TranslationKey, TranslationValues } from "./index";

export type ErrorText = { key: TranslationKey; values?: TranslationValues };

// Same limits as the API (backend src/routes/buildings.ts).
export const MIN_RADIUS_METERS = 50;
export const MAX_RADIUS_METERS = 500;

const KNOWN_MESSAGES: Record<string, TranslationKey> = {
  "Username and password are required": "errors.missingCredentials",
  "Invalid admin username or password": "errors.invalidCredentials",
  "Too many failed login attempts. Try again in 15 minutes.": "errors.tooManyAttempts",
  "Authentication required": "errors.sessionExpired",
  "Invalid or expired token": "errors.sessionExpired",
  "You are not allowed to access this resource": "errors.forbidden",
  "A building site with this name already exists.": "errors.duplicateBuilding",
  "Another building site with this name already exists.": "errors.duplicateBuilding",
  "Building not found": "errors.buildingNotFound",
  "This username is already taken by another worker.": "errors.usernameTaken",
  "The assigned building does not exist.": "errors.buildingMissing",
  "A password is required for new workers.": "errors.passwordRequired",
  "Worker not found": "errors.workerNotFound",
  "Provide valid start_date and end_date values (YYYY-MM-DD)": "errors.invalidDates",
};

const CODES: Record<string, ErrorText> = {
  INVALID_BUILDING: { key: "errors.invalidBuilding" },
  INVALID_RADIUS: {
    key: "errors.invalidRadius",
    values: { min: MIN_RADIUS_METERS, max: MAX_RADIUS_METERS },
  },
};

export function apiErrorText(status: number, body: unknown): ErrorText {
  const data = (body ?? {}) as { code?: unknown; error?: unknown };
  if (typeof data.code === "string" && data.code in CODES) return CODES[data.code];

  const message = typeof data.error === "string" ? data.error : "";
  if (message in KNOWN_MESSAGES) return { key: KNOWN_MESSAGES[message] };
  if (message.startsWith("Full name, username, a valid hourly rate")) {
    return { key: "errors.invalidWorker" };
  }
  if (message.startsWith("search must be at most")) return { key: "errors.searchTooLong" };
  const tooMany = /^Too many rows to export: (\d+) .*\(limit (\d+)\)/.exec(message);
  if (tooMany) {
    return { key: "errors.tooManyRows", values: { count: Number(tooMany[1]), limit: Number(tooMany[2]) } };
  }

  if (status === 401) return { key: "errors.sessionExpired" };
  if (status === 403) return { key: "errors.forbidden" };
  if (status === 429) return { key: "errors.tooManyAttempts" };
  if (status >= 500) return { key: "errors.server" };
  return { key: "errors.generic" };
}

/** An API failure carrying translated-text info; thrown by components, shown in their catch. */
export class ApiError extends Error {
  readonly text: ErrorText;
  constructor(text: ErrorText) {
    super(text.key);
    this.name = "ApiError";
    this.text = text;
  }
}

export async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Throws an ApiError for a failed response (pass the body if already read). */
export async function throwApiError(response: Response, body?: unknown): Promise<never> {
  const data = body === undefined ? await readJson(response) : body;
  throw new ApiError(apiErrorText(response.status, data));
}

/**
 * The text to show for a caught error: the API's reason if it was an ApiError,
 * otherwise "cannot reach the server" (fetch itself failed), or `fallback`.
 */
export function errorTextOf(error: unknown, fallback?: TranslationKey): ErrorText {
  if (error instanceof ApiError) return error.text;
  if (error instanceof TypeError) return { key: "errors.connection" };
  return { key: fallback ?? "errors.generic" };
}
