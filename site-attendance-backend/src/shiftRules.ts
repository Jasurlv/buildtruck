// The attendance and pay rules, as pure calculations. Everything here takes the
// current time as an argument; the routes read it once per request.
import type { WorkRules } from "./config.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: Date, timezone: string): Record<string, string> {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
}

/** Calendar date (YYYY-MM-DD) of an instant in the timezone. */
export function localDate(instant: Date, timezone: string): string {
  const parts = localParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Wall-clock time (HH:MM) of an instant in the timezone. */
export function localTime(instant: Date, timezone: string): string {
  const parts = localParts(instant, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function offsetMs(instantMs: number, timezone: string): number {
  const p = localParts(new Date(instantMs), timezone);
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return wall - instantMs;
}

/** The instant a wall-clock date and time (HH:MM) occurs in the timezone. DST-aware. */
export function zonedTimeToInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The second pass corrects the offset when the first guess is across a DST change.
  const guess = wall - offsetMs(wall, timezone);
  return new Date(wall - offsetMs(guess, timezone));
}

/**
 * Paid time starts at the scheduled start or one changing allowance after
 * arrival, whichever is later.
 */
export function computePaidStart(arrival: Date, scheduled: Date, allowanceMinutes: number): Date {
  return new Date(Math.max(scheduled.getTime(), arrival.getTime() + allowanceMinutes * MINUTE_MS));
}

/** Today's lunch window. `closesAt` is the first instant it is no longer open. */
export function lunchWindow(now: Date, rules: WorkRules, timezone: string) {
  const date = localDate(now, timezone);
  return {
    opensAt: zonedTimeToInstant(date, rules.lunchOpensAt, timezone),
    closesAt: new Date(
      zonedTimeToInstant(date, rules.lunchLatestStart, timezone).getTime() + MINUTE_MS,
    ),
  };
}

export type LunchDeductionType = "recorded" | "elapsed" | "default" | "none";

/** A break (or other pause); an open one has no end yet. */
export type PauseInterval = { startedAt: Date; endedAt: Date | null };

/**
 * Total pause time inside [paidStart, until]. An open pause runs until `until`.
 * Clipping keeps the figure right when an admin moves the paid start or finish.
 */
export function pauseMs(pauses: PauseInterval[], paidStart: Date, until: Date): number {
  let total = 0;
  for (const pause of pauses) {
    const start = Math.max(pause.startedAt.getTime(), paidStart.getTime());
    const end = Math.min((pause.endedAt ?? until).getTime(), until.getTime());
    total += Math.max(0, end - start);
  }
  return total;
}

export type ShiftPayInput = {
  paidStart: Date;
  finish: Date;
  lunchStartedAt: Date | null;
  lunchMinutes: number | null;
  lunchPlannedEndAt: Date | null;
  /** Breaks taken during the shift (default: none). */
  breaks?: PauseInterval[];
};

/** worked = finish - paid start - lunch deduction - breaks, never below 0. */
export function computeShiftPay(input: ShiftPayInput, rules: WorkRules, hourlyRate: number) {
  const { paidStart, finish, lunchStartedAt, lunchMinutes, lunchPlannedEndAt } = input;
  const paidMs = Math.max(0, finish.getTime() - paidStart.getTime());

  let deductionMs = 0;
  let type: LunchDeductionType = "none";
  if (lunchMinutes !== null) {
    if (lunchStartedAt && lunchPlannedEndAt && finish < lunchPlannedEndAt) {
      // Finished during lunch: only the part of the lunch that actually happened.
      deductionMs = Math.max(0, finish.getTime() - lunchStartedAt.getTime());
      type = "elapsed";
    } else {
      deductionMs = lunchMinutes * MINUTE_MS;
      type = "recorded";
    }
  } else if (paidMs > rules.lunchAutoDeductMinShiftHours * HOUR_MS) {
    deductionMs = rules.lunchDefaultDeductionMinutes * MINUTE_MS;
    type = "default";
  }
  deductionMs = Math.min(deductionMs, paidMs);
  // Breaks never overlap a lunch (each is refused while the other runs), so they add up.
  const breakMs = Math.min(pauseMs(input.breaks ?? [], paidStart, finish), paidMs - deductionMs);

  const workedHours = parseFloat(((paidMs - deductionMs - breakMs) / HOUR_MS).toFixed(2));
  return {
    workedHours,
    earned: parseFloat((workedHours * hourlyRate).toFixed(2)),
    lunchDeductedMinutes: parseFloat((deductionMs / MINUTE_MS).toFixed(2)),
    lunchDeductionType: type,
    breakMinutes: parseFloat((breakMs / MINUTE_MS).toFixed(2)),
  };
}

export function effectiveHourlyRate(value: unknown): number {
  const rate = Number(value);
  return value !== null && Number.isFinite(rate) && rate >= 0 ? rate : 6.25;
}

const toDate = (value: unknown): Date | null => (value ? new Date(value as string | Date) : null);

/** Whole minutes from `from` to `to`, or null if either is unknown. */
function minutesBetween(from: unknown, to: unknown): number | null {
  const start = toDate(from);
  const end = toDate(to);
  return start && end ? Math.round((end.getTime() - start.getTime()) / MINUTE_MS) : null;
}

export type ShiftRow = Record<string, any>;

/** A shift_pauses row as stored. */
export type PauseRow = { id: number; started_at: Date | string; ended_at: Date | string | null };

export const toPauseInterval = (pause: PauseRow): PauseInterval => ({
  startedAt: new Date(pause.started_at),
  endedAt: pause.ended_at ? new Date(pause.ended_at) : null,
});

/**
 * The shift's breaks for clients: the list, the open one (if any) and the total so
 * far. `now` is the server time; a finished shift counts up to its finish.
 */
export function breakFields(row: ShiftRow, breaks: PauseRow[], now: Date, timezone: string) {
  const open = breaks.find((pause) => !pause.ended_at) ?? null;
  const paidStart = new Date(row.paid_start_at ?? row.punch_in_time);
  const until = row.end_work_time ? new Date(row.end_work_time) : now;
  return {
    breaks: breaks.map((pause) => ({
      id: pause.id,
      started_at: new Date(pause.started_at).toISOString(),
      ended_at: pause.ended_at ? new Date(pause.ended_at).toISOString() : null,
    })),
    open_break: open
      ? {
          id: open.id,
          started_at: new Date(open.started_at).toISOString(),
          // "HH:MM" in the sites' timezone, whatever timezone the phone is set to.
          local_started: localTime(new Date(open.started_at), timezone),
        }
      : null,
    break_minutes: parseFloat(
      (pauseMs(breaks.map(toPauseInterval), paidStart, until) / MINUTE_MS).toFixed(2),
    ),
  };
}

/** A shift as sent to clients: the stored row plus every value they display. */
export function shiftView(row: ShiftRow, timezone: string) {
  const clock = (value: unknown) => {
    const instant = toDate(value);
    return instant ? localTime(instant, timezone) : null;
  };
  const lateness = minutesBetween(row.scheduled_start_at, row.paid_start_at);
  return {
    ...row,
    arrival_at: row.punch_in_time,
    finish_at: row.end_work_time,
    lunch_started_at: row.lunch_start_time,
    waiting_minutes: minutesBetween(row.punch_in_time, row.paid_start_at),
    lateness_minutes: lateness === null ? null : Math.max(0, lateness),
    // Wall-clock labels in the sites' timezone, whatever timezone the phone is set to.
    local_times: {
      arrival: clock(row.punch_in_time),
      scheduled_start: clock(row.scheduled_start_at),
      paid_start: clock(row.paid_start_at),
      lunch_started: clock(row.lunch_start_time),
      lunch_planned_end: clock(row.lunch_planned_end_at),
      finish: clock(row.end_work_time),
    },
  };
}

/** The rules and today's lunch window, for clients to display. */
export function rulesView(now: Date, rules: WorkRules, timezone: string) {
  const window = lunchWindow(now, rules, timezone);
  return {
    timezone,
    changing_allowance_minutes: rules.changingAllowanceMinutes,
    lunch_opens_local: rules.lunchOpensAt,
    lunch_latest_start_local: rules.lunchLatestStart,
    lunch_window_opens_at: window.opensAt.toISOString(),
    lunch_window_closes_at: window.closesAt.toISOString(),
    lunch_min_minutes: rules.lunchMinMinutes,
    lunch_max_minutes: rules.lunchMaxMinutes,
    lunch_default_deduction_minutes: rules.lunchDefaultDeductionMinutes,
    max_shift_hours: rules.maxShiftHours,
  };
}
