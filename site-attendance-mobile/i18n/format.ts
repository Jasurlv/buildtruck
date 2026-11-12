// Dates, times and durations in the selected language. Times stay 24-hour "HH:MM"
// in every language; only words and date order change.
import i18n from "./index";

const pad = (value: number) => String(value).padStart(2, "0");

function monthName(month: number): string | null {
  const months = i18n.t("dates.months", { returnObjects: true }) as unknown;
  return Array.isArray(months) && typeof months[month - 1] === "string" ? months[month - 1] : null;
}

/** "2025-06-09" -> "9 June 2025" / "9 июня 2025" / "9-iyun, 2025-yil" (shown as is, no time zone). */
export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const name = month ? monthName(month) : null;
  if (!name || !day || !year) return isoDate;
  return i18n.t("dates.long", { day, month: name, year });
}

/** A timestamp as "09/06/2025, 14:05" (EN) or "09.06.2025, 14:05" (RU, UZ), in the phone's time zone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return i18n.t("dates.dateTime", {
    date: i18n.t("dates.numeric", {
      day: pad(date.getDate()),
      month: pad(date.getMonth() + 1),
      year: date.getFullYear(),
    }),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  });
}

/** "7h 5m" / "7 ч 5 мин" / "7 soat 5 daq" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  return i18n.t("units.duration", { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
}

/** "45 minutes" / "45 минут" / "45 daqiqa", with the right plural form. */
export function minutesText(count: number): string {
  return i18n.t("units.minutes", { count });
}

/** "14 hours" / "14 часов" / "14 soat" */
export function hoursText(count: number): string {
  return i18n.t("units.hours", { count });
}
