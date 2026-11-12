// Timezone of the building sites. Must match the backend's APP_TIMEZONE, which
// decides the calendar day (work_date) each shift is filed under.
export const APP_TIMEZONE =
  process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() || "Europe/Riga";

let dateFormatter: Intl.DateTimeFormat;
let dateTimeFormatter: Intl.DateTimeFormat;
try {
  dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // 00:00-23:59, never "24:00"
  });
} catch {
  throw new Error(
    `NEXT_PUBLIC_APP_TIMEZONE "${APP_TIMEZONE}" is not a valid IANA timezone.`,
  );
}

// Builds the output from the parts, so the result never depends on locale punctuation.
function partsOf(formatter: Intl.DateTimeFormat, instant: Date): Record<string, string> {
  return Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
}

/** Calendar date (YYYY-MM-DD) of `instant` in the sites' timezone, not the browser's. */
export function appDate(instant: Date = new Date()): string {
  const parts = partsOf(dateFormatter, instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "en": DD/MM/YYYY; "ru": DD.MM.YYYY. Only the order and separators change. */
export type DateStyle = "en" | "ru";

const DATE_SEPARATOR: Record<DateStyle, string> = { en: "/", ru: "." };

/**
 * A timestamp from the API as "DD/MM/YYYY, HH:mm" (24-hour; "DD.MM.YYYY, HH:mm"
 * for "ru") in the sites' timezone, not the browser's. Missing or invalid values
 * become "—". CSV exports always use the "en" form, so files stay the same.
 */
export function formatAppDateTime(
  value: string | null | undefined,
  style: DateStyle = "en",
): string {
  if (!value) return "—";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "—";
  const parts = partsOf(dateTimeFormatter, instant);
  const separator = DATE_SEPARATOR[style];
  return `${parts.day}${separator}${parts.month}${separator}${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** A calendar date (YYYY-MM-DD, already the sites' day): as is for "en", DD.MM.YYYY for "ru". */
export function formatWorkDate(value: string, style: DateStyle = "en"): string {
  const date = String(value).slice(0, 10);
  if (style === "en") return date;
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}.${month}.${year}` : date;
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, unaffected by DST). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Default report range: the last `days` calendar days in the sites' timezone,
 * both ends inclusive (the backend filters work_date BETWEEN start AND end).
 * `nowMs` should come from serverNow(), so a wrong computer clock can't hide
 * today's shifts.
 */
export function defaultDateRange(
  nowMs: number,
  days = 30,
): { start: string; end: string } {
  const end = appDate(new Date(nowMs));
  return { start: addDays(end, -(days - 1)), end };
}
