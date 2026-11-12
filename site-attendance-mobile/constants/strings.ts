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
  cancel: "Cancel",

  // Intro pages (onboarding), shown before the Permissions screen
  onboarding: {
    skip: "Skip",
    next: "Next",
    continue: "Continue",
    steps: [
      {
        icon: "🏗️",
        title: "Welcome to TimeTrack",
        body: "Record your work day at the building in a few taps.",
        points: [
          "Start work when you arrive at your building",
          "Log your lunch and breaks",
          "Finish work and see your hours and earnings",
        ],
      },
      {
        icon: "📍",
        title: "Why TimeTrack needs your location",
        body: "When you tap Start Work, TimeTrack checks that you are at your assigned building. During a shift it checks that you are still there.",
        points: [
          "Checked when you start work, to confirm you are at your building",
          "During a shift, also when the app is in the background",
          "Never used outside a shift",
        ],
      },
    ],
  },
  showOnboardingAgain: "Show onboarding again",

  // Permissions screen (shown after the intro pages, and whenever a permission is missing)
  permissions: {
    title: "Permissions",
    intro: "TimeTrack needs the three permissions below to record your work time. Allow all of them to continue.",
    disclosureTitle: "How TimeTrack uses your location",
    disclosure: [
      "TimeTrack collects your phone's precise location when you tap Start Work, to confirm you are at your assigned building.",
      "During an active shift it also collects your location in the background (when the app is closed or not in use), to check that you are still at the building.",
      "Location is collected only during an active shift: never before you start work or after you finish.",
      "Your employer sees this information as part of your attendance and pay records. It is not used for anything else.",
    ],
    statusGranted: "Allowed",
    statusMissing: "Not allowed",
    statusWaiting: "Allow location first",
    statusNotAvailable: "Not available in Expo Go",
    location: {
      title: "Precise location",
      reason: "Confirms you are at your building when you start work.",
      button: "Allow location",
    },
    backgroundLocation: {
      title: (platform: string) =>
        platform === "ios" ? "Location: Always" : "Location: Allow all the time",
      reason: "Checks during your shift that you are still at the building, also when the app is in the background.",
      button: (platform: string) =>
        platform === "ios" ? "Allow Always" : "Allow all the time",
      expoGo: "Expo Go cannot use background location. This step is skipped for testing only; the installed app requires it.",
    },
    notifications: {
      title: "Notifications",
      reason: "Lunch reminders, a warning if you leave the building during a shift, and the notice shown while your shift is tracked.",
      button: "Allow notifications",
    },
    // What to do where the system dialog cannot help.
    guides: {
      androidAllTheTime: [
        "Tap the button below. Your phone opens TimeTrack's location settings.",
        "Choose \"Allow all the time\".",
        "Come back to TimeTrack. This screen updates by itself.",
      ],
      iosAlways: [
        "Tap the button below.",
        "In the message, choose \"Change to Always Allow\".",
      ],
      preciseLocation: (platform: string) =>
        platform === "ios"
          ? ["Tap Open settings.", "Tap Location.", "Turn on \"Precise Location\".", "Come back to TimeTrack."]
          : ["Tap the button below.", "Choose \"Precise\" (not \"Approximate\").", "If no question appears: Open settings > Permissions > Location and turn on \"Use precise location\"."],
      settingsLocation: (platform: string) =>
        platform === "ios"
          ? ["Tap Open settings.", "Tap Location.", "Choose \"While Using the App\" and turn on \"Precise Location\".", "Come back to TimeTrack."]
          : ["Tap Open settings.", "Tap Permissions, then Location.", "Choose \"Allow all the time\" and turn on \"Use precise location\".", "Come back to TimeTrack."],
      settingsBackground: (platform: string) =>
        platform === "ios"
          ? ["Tap Open settings.", "Tap Location.", "Choose \"Always\".", "Come back to TimeTrack."]
          : ["Tap Open settings.", "Tap Permissions, then Location.", "Choose \"Allow all the time\".", "Come back to TimeTrack."],
      settingsNotifications: (platform: string) =>
        platform === "ios"
          ? ["Tap Open settings.", "Tap Notifications.", "Turn on \"Allow Notifications\".", "Come back to TimeTrack."]
          : ["Tap Open settings.", "Tap Notifications.", "Turn on \"Show notifications\" (or \"All TimeTrack notifications\").", "Come back to TimeTrack."],
    },
    openSettings: "Open settings",
    continue: "Continue",
    continueToLogin: "Continue to login",
    continueHint: "Allow all the permissions above to continue.",
    requestFailedTitle: "Could not ask for permission",
    requestFailed: "Open settings and allow it there, then come back to TimeTrack.",
    battery: {
      title: "Battery saving (recommended)",
      body: "Some phones stop apps in the background to save battery, which stops shift tracking. Set TimeTrack to \"Unrestricted\" or \"Not optimized\". This step does not block you.",
      tips: [
        "Samsung: Settings > Apps > TimeTrack > Battery > Unrestricted. Also remove TimeTrack from \"Sleeping apps\".",
        "Xiaomi / Redmi / POCO: Settings > Apps > TimeTrack > Battery saver > No restrictions, and turn on Autostart.",
        "Huawei / Honor: Settings > Battery > App launch > TimeTrack > Manage manually, all switches on.",
      ],
      button: "Open battery settings",
    },
    // Tapping Start Work while a permission is missing
    startWorkTitle: "Permissions needed",
    startWorkMessage: "TimeTrack needs location (all the time) and notifications before you can start work.",
    fix: "Fix permissions",
  },
};

export type Strings = typeof strings;
