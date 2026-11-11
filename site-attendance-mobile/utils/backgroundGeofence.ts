import { Platform } from "react-native";
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

export async function startBackgroundGeofenceMonitoring(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const permission = await Location.requestBackgroundPermissionsAsync();
  if (permission.status !== "granted") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("geofence-alerts", {
      name: "Workplace geofence",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await Notifications.requestPermissionsAsync();
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
  return true;
}

export async function stopBackgroundGeofenceMonitoring(): Promise<void> {
  await SecureStore.setItemAsync("background_shift_active", "false");
  if (Platform.OS === "web") return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
