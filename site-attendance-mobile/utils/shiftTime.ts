// Shift state derived from what the server stores and calculates, so it is
// correct after navigation, backgrounding or restarting the app. `nowMs` must
// come from serverNow(): the phone's clock is never trusted.

export type ShiftLocalTimes = {
  arrival: string | null;
  scheduled_start: string | null;
  paid_start: string | null;
  lunch_started: string | null;
  lunch_planned_end: string | null;
  finish: string | null;
};

export type ShiftTimestamps = {
  id?: number;
  punch_in_time?: string | null;
  arrival_at?: string | null;
  scheduled_start_at?: string | null;
  paid_start_at?: string | null;
  lunch_start_time?: string | null;
  lunch_started_at?: string | null;
  lunch_minutes?: number | null;
  lunch_planned_end_at?: string | null;
  lunch_end_time?: string | null;
  end_work_time?: string | null;
  /** "HH:MM" labels in the sites' timezone, formatted by the server. */
  local_times?: Partial<ShiftLocalTimes>;
};

/** The server's attendance rules and today's lunch window. */
export type ShiftRules = {
  timezone: string;
  changing_allowance_minutes: number;
  lunch_opens_local: string;
  lunch_latest_start_local: string;
  lunch_window_opens_at: string;
  /** First instant the window is closed (the 12:30 minute still counts). */
  lunch_window_closes_at: string;
  lunch_min_minutes: number;
  lunch_max_minutes: number;
  lunch_default_deduction_minutes: number;
};

export type ShiftPhase = "changing" | "working" | "lunch";

export type ShiftStatus = {
  phase: ShiftPhase;
  paidStartAt: Date;
  msUntilPaidStart: number;
  lunchPlannedEndAt: Date | null;
  msUntilLunchEnd: number;
  hasTakenLunch: boolean;
  /** Paid time so far, less lunch. The default lunch deduction is applied only at finish. */
  workedMs: number;
};

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Returns null when the shift has no valid arrival time. */
export function computeShiftStatus(shift: ShiftTimestamps, nowMs: number): ShiftStatus | null {
  const arrivalMs = toMs(shift.arrival_at ?? shift.punch_in_time);
  if (arrivalMs === null) return null;
  const paidStartMs = toMs(shift.paid_start_at) ?? arrivalMs;
  const lunchStartMs = toMs(shift.lunch_started_at ?? shift.lunch_start_time);
  const lunchEndMs = toMs(shift.lunch_planned_end_at ?? shift.lunch_end_time);
  const untilMs = toMs(shift.end_work_time) ?? nowMs;

  let phase: ShiftPhase = "working";
  if (untilMs < paidStartMs) {
    phase = "changing";
  } else if (lunchStartMs !== null && untilMs >= lunchStartMs && (lunchEndMs === null || untilMs < lunchEndMs)) {
    phase = "lunch";
  }

  let workedMs = Math.max(0, untilMs - paidStartMs);
  if (lunchStartMs !== null) {
    workedMs -= Math.max(0, Math.min(untilMs, lunchEndMs ?? untilMs) - lunchStartMs);
  }

  return {
    phase,
    paidStartAt: new Date(paidStartMs),
    msUntilPaidStart: Math.max(0, paidStartMs - nowMs),
    lunchPlannedEndAt: lunchEndMs === null ? null : new Date(lunchEndMs),
    msUntilLunchEnd: lunchEndMs === null ? 0 : Math.max(0, lunchEndMs - nowMs),
    hasTakenLunch: lunchStartMs !== null,
    workedMs: Math.max(0, workedMs),
  };
}

export type LunchAvailability = "before" | "open" | "closed";

/** Mirrors the server's check; the server still decides when the lunch is requested. */
export function lunchAvailability(rules: ShiftRules, nowMs: number): LunchAvailability {
  if (nowMs < Date.parse(rules.lunch_window_opens_at)) return "before";
  if (nowMs >= Date.parse(rules.lunch_window_closes_at)) return "closed";
  return "open";
}

/** Lunch lengths to offer: the allowed range in 5-minute steps, always including the maximum. */
export function lunchOptions(rules: ShiftRules): number[] {
  const options: number[] = [];
  for (let minutes = rules.lunch_min_minutes; minutes < rules.lunch_max_minutes; minutes += 5) {
    options.push(minutes);
  }
  options.push(rules.lunch_max_minutes);
  return options;
}

/** "7h 5m" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/** Countdown: "14:05" (mm:ss), or "1:02:03" from an hour up. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** "HH:MM" in the phone's time zone; only a fallback for the server's local_times labels. */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
