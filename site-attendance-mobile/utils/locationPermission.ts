import { Linking } from "react-native";
import * as Location from "expo-location";

/**
 * Foreground location permission, simplified for the UI:
 * - "denied": refused, but the app may ask again (Android).
 * - "blocked": refused permanently; only the phone's Settings can change it
 *   (on iOS this is the case right after the first refusal).
 */
export type LocationPermissionState = "granted" | "undetermined" | "denied" | "blocked";

export type LocationPermission = {
  state: LocationPermissionState;
  // iOS "Precise Location" switched off: the geofence check may fail.
  isReducedAccuracy: boolean;
};

function toPermission(response: Location.LocationPermissionResponse): LocationPermission {
  const isReducedAccuracy = response.ios?.accuracy === "reduced";
  if (response.granted) return { state: "granted", isReducedAccuracy };
  if (response.status === Location.PermissionStatus.UNDETERMINED) {
    return { state: "undetermined", isReducedAccuracy };
  }
  return { state: response.canAskAgain ? "denied" : "blocked", isReducedAccuracy };
}

export async function getLocationPermission(): Promise<LocationPermission> {
  return toPermission(await Location.getForegroundPermissionsAsync());
}

/** Shows the system prompt when the OS still allows it; otherwise returns the current state. */
export async function requestLocationPermission(): Promise<LocationPermission> {
  return toPermission(await Location.requestForegroundPermissionsAsync());
}

export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
