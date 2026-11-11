import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { serverNow } from "./serverClock";

const LOCATION_TASK = "buildtruck-active-shift-geofence";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

type WorkerLocation = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  radius_meters?: number | string | null;
};

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadius = 6371000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lon2 - lon1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error("Background location task failed:", error);
      return;
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("locations" in data) ||
      !Array.isArray(data.locations)
    ) {
      return;
    }

    try {
      const active = await SecureStore.getItemAsync("background_shift_active");
      // While on lunch this holds the lunch's planned end (ISO), otherwise "false".
      const lunchUntil = await SecureStore.getItemAsync("shift_lunch_paused");
      const onLunch = lunchUntil !== null && Date.parse(lunchUntil) > serverNow();
      if (active !== "true" || onLunch) return;

      const latest = data.locations[data.locations.length - 1] as
        | Location.LocationObject
        | undefined;
      if (!latest) return;

      const workerData = await SecureStore.getItemAsync("worker_data");
      if (!workerData) return;
      const worker = JSON.parse(workerData) as WorkerLocation;
      const latitude = Number(worker.latitude);
      const longitude = Number(worker.longitude);
      const radius = Number(worker.radius_meters);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(radius)
      ) {
        console.error("Background geofence skipped: workplace coordinates are invalid.");
        return;
      }

      const distance = calculateDistance(
        latest.coords.latitude,
        latest.coords.longitude,
        latitude,
        longitude,
      );
      const inside = distance <= radius + 70;
      const checkedAt = new Date(latest.timestamp).toISOString();
      const previousRaw = await SecureStore.getItemAsync("geofence_last_result");
      const previous = previousRaw ? JSON.parse(previousRaw) : null;
      await SecureStore.setItemAsync(
        "geofence_last_result",
        JSON.stringify({
          inside,
          distance: Math.round(distance),
          checkedAt,
        }),
      );

      if (!inside && previous?.inside !== false) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Workplace location check",
            body: `You appear to be outside the workplace zone (${Math.round(distance)} m away).`,
            ...(Platform.OS === "android" ? { channelId: "geofence-alerts" } : {}),
          },
          trigger: null,
        });
      }
    } catch (taskError) {
      console.error("Unable to process background location:", taskError);
    }
  });
}

/**
 * Expo Go cannot run background location (iOS rejects it for missing
 * NSLocation*UsageDescription keys, which only an installed build has), so the
 * background task is never started there.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * - "started": the background task is running (or already was).
 * - "expo-go": running in Expo Go; checks happen only while the app is open.
 * - "permission-denied": the worker did not allow background location.
 * - "failed": the OS refused to start it; checks happen only while the app is open.
 * - "unsupported": web.
 */
export type BackgroundStartResult = "started" | "expo-go" | "permission-denied" | "failed" | "unsupported";

let expoGoLogged = false;

async function prepareNotifications(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("geofence-alerts", {
      name: "Workplace geofence",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await Notifications.requestPermissionsAsync();
}

/** Never throws: a background-location failure must not break the shift screen. */
export async function startBackgroundGeofenceMonitoring(): Promise<BackgroundStartResult> {
  if (Platform.OS === "web") return "unsupported";

  if (isExpoGo) {
    if (!expoGoLogged) {
      expoGoLogged = true;
      console.log("Expo Go: background location is not available; location is checked while the app is open.");
    }
    // The lunch reminder still needs notification permission and the Android channel.
    await prepareNotifications().catch(() => {});
    return "expo-go";
  }

  try {
    const permission = await Location.requestBackgroundPermissionsAsync();
    if (permission.status !== "granted") return "permission-denied";

    await prepareNotifications();
    await SecureStore.setItemAsync("background_shift_active", "true");

    const alreadyStarted =
      await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: CHECK_INTERVAL_MS,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService:
          Platform.OS === "android"
            ? {
                notificationTitle: "TimeTrack shift tracking",
                notificationBody: "Checking your workplace location during your active shift.",
                killServiceOnDestroy: false,
              }
            : undefined,
      });
    }
    return "started";
  } catch (err) {
    console.log("Background location could not be started; checking only while the app is open.", err);
    return "failed";
  }
}

export async function stopBackgroundGeofenceMonitoring(): Promise<void> {
  await SecureStore.setItemAsync("background_shift_active", "false");
  // Nothing was started in Expo Go (see startBackgroundGeofenceMonitoring).
  if (Platform.OS === "web" || isExpoGo) return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
