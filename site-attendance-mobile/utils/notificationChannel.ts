import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Android channel for the app's own alerts (outside the workplace zone, lunch
 * reminder). The foreground-service notification shown while tracking a shift has
 * its own channel, created by expo-location.
 */
export const ALERTS_CHANNEL_ID = "geofence-alerts";

/**
 * Creates the channel (idempotent; Android only). Android 13+ shows the notification
 * permission prompt only once the app has a channel, so call this before asking.
 */
export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
    name: "Workplace alerts",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Trigger for "show now" on the alerts channel (the channel is ignored on iOS). */
export function immediateAlertTrigger(): Notifications.NotificationTriggerInput {
  return Platform.OS === "android" ? { channelId: ALERTS_CHANNEL_ID } : null;
}
