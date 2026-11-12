// Turns the API's error responses into text in the selected language. The server
// answers in English; the app shows its own translation, chosen by the
// machine-readable `code` when there is one, otherwise by the known English message
// or the HTTP status. Unknown errors get a general message, never raw English.
import i18n from "../i18n";
import { minutesText } from "../i18n/format";
import type { ShiftRules } from "./shiftTime";

type ErrorBody = { error?: unknown; code?: unknown; distance_meters?: unknown } | null;

/** An error whose message is already translated and can be shown as is. */
export class ServerError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ServerError";
    this.status = status;
    this.code = code;
  }
}

// Server messages without a code (backend routes workerAuth.ts, attendance.ts, index.ts).
const KNOWN_MESSAGES = {
  "Username and password are required": "errors.missingCredentials",
  "Invalid username or password": "errors.invalidCredentials",
  "Too many failed login attempts. Try again in 15 minutes.": "errors.tooManyAttempts",
  "Valid location coordinates are required": "errors.invalidLocation",
  "Worker or assigned building not found": "errors.noAssignedBuilding",
  "A shift is already active": "errors.shiftAlreadyActive",
} as const;

/** The response body as JSON, or null (e.g. an HTML error page from a proxy). */
export async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function serverErrorMessage(
  status: number,
  body: ErrorBody,
  rules?: ShiftRules | null,
): string {
  const code = typeof body?.code === "string" ? body.code : null;
  const codeKey = `errors.codes.${code}`;
  if (code && i18n.exists(codeKey)) {
    return i18n.t(codeKey as "errors.codes.NO_ACTIVE_SHIFT", {
      time:
        code === "LUNCH_WINDOW_CLOSED"
          ? rules?.lunch_latest_start_local ?? "–"
          : rules?.lunch_opens_local ?? "–",
      duration: minutesText(rules?.lunch_default_deduction_minutes ?? 60),
      min: rules?.lunch_min_minutes ?? "–",
      max: rules?.lunch_max_minutes ?? "–",
    });
  }

  const message = typeof body?.error === "string" ? body.error : "";
  if (message === "Outside site radius!") {
    const distance = Number(body?.distance_meters);
    return Number.isFinite(distance)
      ? i18n.t("errors.outsideRadius", { distance: Math.round(distance) })
      : i18n.t("errors.outsideRadiusUnknown");
  }
  if (message in KNOWN_MESSAGES) {
    return i18n.t(KNOWN_MESSAGES[message as keyof typeof KNOWN_MESSAGES]);
  }
  if (status === 429) return i18n.t("errors.tooManyAttempts");
  if (status >= 500) return i18n.t("errors.server");
  return i18n.t("errors.generic");
}

/** Throws a ServerError for a failed response (the body must already be read). */
export function throwServerError(
  response: Response,
  body: ErrorBody,
  rules?: ShiftRules | null,
): never {
  const code = typeof body?.code === "string" ? body.code : null;
  throw new ServerError(serverErrorMessage(response.status, body, rules), response.status, code);
}

/** Text for a caught error: the server's (translated) reason, or "no connection". */
export function errorText(error: unknown): string {
  if (error instanceof ServerError) return error.message;
  return i18n.t("errors.connection");
}
