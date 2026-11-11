// User-visible text for breaks, open shifts from an earlier day and automatically
// closed shifts. Kept in one place so it can be translated (English, Russian, Uzbek):
// add a language by providing another object of the same shape.
//
// Older screens still have their text inline; move it here as they are translated.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const minutes = (count: number) => `${count} ${count === 1 ? "minute" : "minutes"}`;
const hours = (count: number) => `${count} ${count === 1 ? "hour" : "hours"}`;

export const strings = {
  /** "2025-06-09" -> "9 June 2025" (the server's calendar date, shown as is). */
  formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.split("-").map(Number);
    const monthName = MONTHS[(month ?? 0) - 1];
    return monthName && day && year ? `${day} ${monthName} ${year}` : isoDate;
  },

  // Breaks
  takeBreak: "Take break",
  resumeWork: "Resume work",
  startingBreak: "Starting break...",
  resumingWork: "Resuming...",
  onBreakSince: (time: string) => `☕ On break since ${time}`,
  breakPaused: "Paid time is paused",
  paidSoFar: (duration: string) => `Paid time so far: ${duration}`,
  breaksToday: (count: number) => `Breaks this shift: ${minutes(count)}`,
  breaksRow: "Breaks",
  minutesShort: (count: number) => `${count} min`,
  breakStartFailed: "Unable to start the break",
  breakEndFailed: "Unable to resume work",
  connectionError: "Server connection error",

  // A shift left open from an earlier day
  staleShiftWarning: (date: string) =>
    `This shift started on ${date} and is still open. If you already finished work, tap Finish Work.`,
  noEstimate: "-",

  // Shift closed by the server after the maximum length
  autoClosedTitle: "Shift closed automatically",
  autoClosedMessage: (closedAfterHours: number) =>
    `Your shift was closed automatically after ${hours(closedAfterHours)}. Your manager will review it.`,
  ok: "OK",
};

export type Strings = typeof strings;
