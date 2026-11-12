// The permission gate as pure functions: permission readings in, what the
// Permissions screen shows and where the app may go out. No React Native imports,
// so it is unit-tested with Node (utils/permissionGate.test.mts). The readings come
// from utils/permissions.ts.

/** One permission as the operating system reports it. */
export type PermissionReading = {
  granted: boolean;
  /** The system dialog can still be shown; false means only Settings can change it. */
  canAskAgain: boolean;
  /** Never asked yet. */
  undetermined: boolean;
};

export type LocationReading = PermissionReading & {
  /** Exact location (Android "Precise", iOS "Precise Location"); approximate is not enough. */
  precise: boolean;
};

export type PermissionSnapshot = {
  platform: "android" | "ios" | "web" | "other";
  isExpoGo: boolean;
  foregroundLocation: LocationReading;
  /** Null when not read: in Expo Go, or before foreground location is allowed. */
  backgroundLocation: PermissionReading | null;
  notifications: PermissionReading;
};

export type PermissionKey = "location" | "backgroundLocation" | "notifications";

/**
 * - granted: done.
 * - ask: the system dialog can grant it (one button).
 * - settings: only the phone's Settings can (step-by-step guide + Open settings).
 * - waiting: the step before it must be done first.
 * - notAvailable: cannot work here (background location in Expo Go); not required.
 */
export type ItemStatus = "granted" | "ask" | "settings" | "waiting" | "notAvailable";

/** Extra instructions the screen shows for an item. */
export type Guide =
  | "androidAllTheTime" // the next screen is Settings: choose "Allow all the time"
  | "iosAlways" // the next dialog: choose "Change to Always Allow"
  | "preciseLocation" // approximate location is on: turn on precise
  | "settingsLocation" // refused for good: Settings > Location
  | "settingsBackground" // refused for good: Settings > Location > All the time / Always
  | "settingsNotifications" // refused for good: Settings > Notifications
  | null;

export type GateItem = {
  key: PermissionKey;
  status: ItemStatus;
  guide: Guide;
  /** Must be granted before the worker can continue. */
  required: boolean;
};

export type GateState = {
  items: GateItem[];
  /** Every required permission is granted. */
  canContinue: boolean;
  /** The first item still to do, to highlight; null when nothing is left. */
  nextStep: PermissionKey | null;
};

function locationItem(location: LocationReading, platform: PermissionSnapshot["platform"]): GateItem {
  const base = { key: "location" as const, required: true };
  if (location.granted && location.precise) return { ...base, status: "granted", guide: null };
  if (location.granted) {
    // Approximate only. Android 12+ offers "Precise" again in its dialog; iOS only in Settings.
    const askable = platform === "android" && location.canAskAgain;
    return { ...base, status: askable ? "ask" : "settings", guide: "preciseLocation" };
  }
  if (location.undetermined || location.canAskAgain) return { ...base, status: "ask", guide: null };
  return { ...base, status: "settings", guide: "settingsLocation" };
}

function backgroundItem(snapshot: PermissionSnapshot): GateItem {
  const base = { key: "backgroundLocation" as const, required: true };
  if (snapshot.isExpoGo) return { ...base, status: "notAvailable", guide: null, required: false };
  if (!snapshot.foregroundLocation.granted) return { ...base, status: "waiting", guide: null };
  const background = snapshot.backgroundLocation;
  if (background?.granted) return { ...base, status: "granted", guide: null };
  if (background && !background.undetermined && !background.canAskAgain) {
    return { ...base, status: "settings", guide: "settingsBackground" };
  }
  // Android 11+ cannot grant "all the time" in a dialog: requesting opens the app's
  // location settings, so the worker needs to know what to pick there.
  return {
    ...base,
    status: "ask",
    guide: snapshot.platform === "ios" ? "iosAlways" : "androidAllTheTime",
  };
}

function notificationsItem(notifications: PermissionReading): GateItem {
  const base = { key: "notifications" as const, required: true };
  if (notifications.granted) return { ...base, status: "granted", guide: null };
  if (notifications.undetermined || notifications.canAskAgain) {
    return { ...base, status: "ask", guide: null };
  }
  return { ...base, status: "settings", guide: "settingsNotifications" };
}

export function computeGate(snapshot: PermissionSnapshot): GateState {
  if (snapshot.platform === "web" || snapshot.platform === "other") {
    // No gate outside the phone apps (the web build is not used by workers).
    return { items: [], canContinue: true, nextStep: null };
  }
  const items = [
    locationItem(snapshot.foregroundLocation, snapshot.platform),
    backgroundItem(snapshot),
    notificationsItem(snapshot.notifications),
  ];
  const open = items.filter((item) => item.required && item.status !== "granted");
  return { items, canContinue: open.length === 0, nextStep: open[0]?.key ?? null };
}

export type StartRoute = "onboarding" | "permissions" | "login" | "app";

/** Where the app opens: intro pages, then permissions, then login or the app. */
export function decideStartRoute(input: {
  onboardingDone: boolean;
  permissionsOk: boolean;
  hasSession: boolean;
}): StartRoute {
  if (!input.onboardingDone) return "onboarding";
  if (!input.permissionsOk) return "permissions";
  return input.hasSession ? "app" : "login";
}

/**
 * After the Permissions screen: back to where the worker was when it was opened over
 * the app (a permission was revoked), otherwise into the app or to the login screen.
 */
export function routeAfterPermissions(input: {
  openedOverApp: boolean;
  canGoBack: boolean;
  hasSession: boolean;
}): "back" | "app" | "login" {
  if (input.openedOverApp && input.canGoBack) return "back";
  return input.hasSession ? "app" : "login";
}

/**
 * Screens that run before the gate is passed (entry, intro pages, the gate itself):
 * the foreground re-check must not open the Permissions screen over them.
 * `segments` is expo-router's useSegments(): [] for the entry screen.
 */
export function isGateExemptRoute(segments: readonly string[]): boolean {
  return segments.length === 0 || segments[0] === "onboarding" || segments[0] === "permissions";
}

/** The foreground re-check: open the Permissions screen over the current one? */
export function shouldOpenPermissionGate(segments: readonly string[], gate: GateState): boolean {
  return !gate.canContinue && !isGateExemptRoute(segments);
}
