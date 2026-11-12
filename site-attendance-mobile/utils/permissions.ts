// Reads and requests the permissions the app needs; the decisions are in
// permissionGate.ts. Reading never throws: an unreadable permission counts as not
// granted (and still askable), so the worker is guided instead of the app failing.
import { Linking, Platform } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { ensureNotificationChannel } from "./notificationChannel";
import {
  computeGate,
  type GateState,
  type PermissionReading,
  type PermissionSnapshot,
} from "./permissionGate";
import { isExpoGo } from "./runtime";

const UNKNOWN: PermissionReading = { granted: false, canAskAgain: true, undetermined: true };

function toReading(response: Location.PermissionResponse | null): PermissionReading {
  if (!response) return UNKNOWN;
  return {
    granted: response.granted,
    canAskAgain: response.canAskAgain,
    undetermined: response.status === Location.PermissionStatus.UNDETERMINED,
  };
}

function isPrecise(response: Location.LocationPermissionResponse): boolean {
  if (Platform.OS === "android") return response.android?.accuracy !== "coarse";
  if (Platform.OS === "ios") return response.ios?.accuracy !== "reduced";
  return true;
}

export async function readPermissionSnapshot(): Promise<PermissionSnapshot> {
  const platform =
    Platform.OS === "android" || Platform.OS === "ios" || Platform.OS === "web"
      ? Platform.OS
      : "other";
  const foreground = await Location.getForegroundPermissionsAsync().catch(() => null);
  // Background location is only read once foreground is allowed, and never in Expo Go.
  const background =
    platform !== "web" && !isExpoGo && foreground?.granted
      ? await Location.getBackgroundPermissionsAsync().catch(() => null)
      : null;
  const notifications = await Notifications.getPermissionsAsync().catch(() => null);
  return {
    platform,
    isExpoGo,
    foregroundLocation: {
      ...toReading(foreground),
      precise: foreground ? isPrecise(foreground) : false,
    },
    backgroundLocation: background ? toReading(background) : null,
    notifications: toReading(notifications),
  };
}

export async function checkPermissionGate(): Promise<GateState> {
  return computeGate(await readPermissionSnapshot());
}

// Each request shows the system dialog when the OS still allows it; the caller
// re-reads the statuses afterwards. Failures surface as a thrown error.

export async function requestPreciseLocation(): Promise<void> {
  await Location.requestForegroundPermissionsAsync();
}

/**
 * Android 11+: opens the app's location settings, where the worker must choose
 * "Allow all the time". iOS: the "Change to Always Allow" dialog (shown once).
 */
export async function requestBackgroundLocation(): Promise<void> {
  await Location.requestBackgroundPermissionsAsync();
}

export async function requestNotifications(): Promise<void> {
  // Android 13+ only shows the prompt once the app has a notification channel.
  await ensureNotificationChannel();
  await Notifications.requestPermissionsAsync();
}

/** The app's page in the phone's Settings (permissions, notifications). */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}

/**
 * Android's battery optimization list, where TimeTrack can be set to "Not optimized"
 * / "Unrestricted". Falls back to the app's settings page if the phone has no such
 * screen. Asking for the exemption directly needs a permission Google Play restricts.
 */
export async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
  } catch {
    await Linking.openSettings();
  }
}
