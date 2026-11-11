import React, { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AppState,
  SafeAreaView,
  ScrollView,
} from "react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useRouter, useFocusEffect } from "expo-router";
import MapView, { Marker, Circle } from "react-native-maps";
import { SessionExpiredError, workerFetch } from "../../utils/api";
import type { ShiftRules } from "../../utils/shiftTime";
import {
  getLocationPermission,
  openAppSettings,
  requestLocationPermission,
  type LocationPermissionState,
} from "../../utils/locationPermission";

export default function AttendanceScreen() {
  const [worker, setWorker] = useState<any>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [isInsideGeofence, setIsInsideGeofence] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  // From the server: this worker's start time and the lunch rules.
  const [schedule, setSchedule] = useState<{ work_start: string; arrive_by: string } | null>(null);
  const [rules, setRules] = useState<ShiftRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [locationPermission, setLocationPermission] =
    useState<LocationPermissionState | null>(null);
  const locationPermissionRef = useRef<LocationPermissionState | null>(null);
  const workerRef = useRef<any>(null);

  const mapRef = useRef<MapView>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const router = useRouter();

  // useFocusEffect runs every time you navigate back to the Today tab
  useFocusEffect(
    useCallback(() => {
      let isFocused = true;
      void loadWorkerData(() => isFocused);

      // Returning from the phone's Settings doesn't refocus the tab, so re-check
      // a missing location permission whenever the app comes back to the foreground.
      const appStateSubscription = AppState.addEventListener("change", (state) => {
        if (
          state === "active" &&
          locationPermissionRef.current !== "granted" &&
          workerRef.current
        ) {
          void startLocationTracking(workerRef.current, () => isFocused, false);
        }
      });

      return () => {
        isFocused = false;
        appStateSubscription.remove();
        locationSubscription.current?.remove();
        locationSubscription.current = null;
      };
    }, []),
  );

  const loadWorkerData = async (isFocused: () => boolean) => {
    try {
      const workerDataString = await SecureStore.getItemAsync("worker_data");
      if (!workerDataString) {
        router.replace("/login");
        return;
      }
      const workerParsed = JSON.parse(workerDataString);
      if (!isFocused()) return;
      setWorker(workerParsed);
      workerRef.current = workerParsed;

      const res = await workerFetch("/attendance/active");
      if (!res.ok) throw new Error("Failed to fetch active shift");
      const data = await res.json();

      if (!isFocused()) return;
      setActiveShift(data.activeShift ?? null);
      setSchedule(data.schedule ?? null);
      setRules(data.rules ?? null);

      await startLocationTracking(workerParsed, isFocused, true);
    } catch (err) {
      // The central handler already opened the login screen.
      if (err instanceof SessionExpiredError) return;
      console.error(err);
    } finally {
      if (isFocused()) setLoading(false);
    }
  };

  const updateLocationPermission = (state: LocationPermissionState) => {
    locationPermissionRef.current = state;
    setLocationPermission(state);
  };

  // Asks for permission only if it was never asked (e.g. the onboarding was
  // skipped) and `mayPrompt` is set. A refusal is shown on screen, not in an alert,
  // so the worker can still use the rest of the app.
  const startLocationTracking = async (
    workerData: any,
    isFocused: () => boolean,
    mayPrompt: boolean,
  ) => {
    let permission = await getLocationPermission();
    if (permission.state === "undetermined" && mayPrompt) {
      permission = await requestLocationPermission();
    }
    if (!isFocused()) return;
    updateLocationPermission(permission.state);
    if (permission.state !== "granted" || locationSubscription.current) return;

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 3,
      },
      (location) => {
        if (!isFocused()) return;
        const { latitude, longitude } = location.coords;
        setCurrentLocation({ latitude, longitude });

        if (workerData && workerData.latitude && workerData.longitude) {
          const siteLat = parseFloat(workerData.latitude);
          const siteLng = parseFloat(workerData.longitude);

          const dist = calculateDistance(latitude, longitude, siteLat, siteLng);
          setDistance(Math.round(dist));

          const allowedRadius = (workerData.radius_meters || 30) + 70;
          const inside = dist <= allowedRadius;
          setIsInsideGeofence(inside);

          if (mapRef.current) {
            mapRef.current.fitToCoordinates(
              [
                { latitude, longitude },
                { latitude: siteLat, longitude: siteLng },
              ],
              {
                edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
                animated: true,
              },
            );
          }
        }
      },
    );

    if (isFocused()) {
      locationSubscription.current = subscription;
    } else {
      subscription.remove();
    }
  };

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const showLocationRequiredAlert = () => {
    const message = `TimeTrack needs your location to confirm you are at ${
      worker?.building_name || "your assigned building"
    } when you start work.`;
    if (locationPermission === "blocked") {
      Alert.alert(
        "Location permission required",
        `${message}\n\nTurn on location for TimeTrack in Settings.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void openAppSettings() },
        ],
      );
      return;
    }
    Alert.alert("Location permission required", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Allow",
        onPress: async () => {
          const permission = await requestLocationPermission();
          updateLocationPermission(permission.state);
          if (permission.state === "granted" && workerRef.current) {
            void startLocationTracking(workerRef.current, () => true, false);
          }
        },
      },
    ]);
  };

  const handleButtonPress = async () => {
    // If a shift is already active, jump straight to the active shift page
    if (activeShift) {
      router.push("/shift-active");
      return;
    }

    if (locationPermission !== "granted") {
      showLocationRequiredAlert();
      return;
    }

    if (!worker || !currentLocation) {
      Alert.alert("Error", "GPS location not acquired yet.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await workerFetch("/attendance/punch-in", {
        method: "POST",
        body: JSON.stringify({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start work");

      setActiveShift(data.log);
      router.push("/shift-active");
    } catch (err: any) {
      if (err instanceof SessionExpiredError) return;
      Alert.alert("Action Failed", err.message || "Server connection error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    if (activeShift) {
      Alert.alert(
        "Shift in progress",
        "Finish your active shift before logging out.",
      );
      return;
    }
    await SecureStore.deleteItemAsync("worker_data");
    await SecureStore.deleteItemAsync("worker_token");
    await SecureStore.deleteItemAsync("shift_lunch_paused");
    locationSubscription.current?.remove();
    locationSubscription.current = null;
    router.replace("/login");
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const siteLat = parseFloat(worker?.latitude || "0");
  const siteLng = parseFloat(worker?.longitude || "0");
  const siteRadius = (worker?.radius_meters || 30) + 70;
  const locationMissing =
    locationPermission !== null && locationPermission !== "granted";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Grid */}
        <View style={styles.headerGrid}>
          <Text style={styles.nameText}>{worker?.full_name}</Text>
          <View style={styles.headerRightContainer}>
            <View style={styles.rateBadge}>
              <Text style={styles.rateText}>
                €{worker?.hourly_rate || "6.25"} / hr
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.logoutButton}
            >
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Today's Schedule Card */}
        <View style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>Today's schedule</Text>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>Arrive, change clothes</Text>
            <Text style={styles.scheduleTime}>by {schedule?.arrive_by ?? "–"}</Text>
          </View>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>Work starts</Text>
            <Text style={styles.scheduleTime}>{schedule?.work_start ?? "–"}</Text>
          </View>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>
              Lunch ({rules ? `${rules.lunch_min_minutes}–${rules.lunch_max_minutes} min` : "–"})
            </Text>
            <Text style={styles.scheduleTime}>
              {rules ? `${rules.lunch_opens_local}–${rules.lunch_latest_start_local}` : "–"}
            </Text>
          </View>

          <View style={[styles.scheduleRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.scheduleLabel}>Work ends</Text>
            <Text style={styles.scheduleTime}>18:00</Text>
          </View>
        </View>

        {/* Building Details Card */}
        <View style={styles.buildingCard}>
          <Text style={styles.buildingTitle}>
            {worker?.building_name || "Unassigned Site"}
          </Text>
          <Text style={styles.buildingAddress}>
            {worker?.building_address ||
              worker?.address ||
              "No location address available"}
          </Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoBadge}>
              Radius: {worker?.radius_meters || 30}m (+70m buffer)
            </Text>
            <Text
              style={[
                styles.statusBadge,
                { color: isInsideGeofence ? "#059669" : "#dc2626" },
              ]}
            >
              {locationMissing
                ? "● Location off"
                : isInsideGeofence
                  ? "● On the place"
                  : `● ${distance !== null ? `${distance}m away` : "Locating..."}`}
            </Text>
          </View>
        </View>

        {/* Distance Status Text Banner */}
        <View
          style={[
            styles.distanceBanner,
            { backgroundColor: isInsideConnectedColor(isInsideGeofence) },
          ]}
        >
          <Text style={styles.distanceBannerText}>
            {locationMissing
              ? "Location permission is required to start work"
              : isInsideGeofence
                ? "You are on the place"
                : `You are far from work ${distance !== null ? `${distance} meters` : "calculating..."}`}
          </Text>
        </View>

        {/* Live Location Map */}
        <View style={styles.mapContainer}>
          {currentLocation && siteLat !== 0 ? (
            <MapView ref={mapRef} style={styles.map} showsUserLocation>
              <Circle
                center={{ latitude: siteLat, longitude: siteLng }}
                radius={siteRadius}
                fillColor="rgba(79, 70, 229, 0.2)"
                strokeColor="rgba(79, 70, 229, 0.8)"
                strokeWidth={2}
              />
              <Marker
                coordinate={{ latitude: siteLat, longitude: siteLng }}
                title={worker?.building_name}
                description={worker?.building_address || worker?.address}
              />
            </MapView>
          ) : locationMissing ? (
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapLoadingText}>Location access is off</Text>
              <TouchableOpacity
                onPress={showLocationRequiredAlert}
                style={styles.enableLocationButton}
              >
                <Text style={styles.enableLocationButtonText}>
                  Turn on location
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator color="#4f46e5" />
              <Text style={styles.mapLoadingText}>
                Acquiring GPS location...
              </Text>
            </View>
          )}
        </View>

        {/* Action Section: Turns Green "WORKING" when activeShift exists */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[
              styles.punchButton,
              {
                backgroundColor: activeShift
                  ? "#059669"
                  : isInsideGeofence
                    ? "#4f46e5"
                    : "#9ca3af",
              },
            ]}
            onPress={handleButtonPress}
            disabled={
              actionLoading ||
              (!activeShift && !isInsideGeofence && !locationMissing)
            }
          >
            {actionLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.punchButtonText}>
                {activeShift ? "WORKING" : "START WORK"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function isInsideConnectedColor(isInside: boolean) {
  return isInside ? "#ecfdf5" : "#fef2f2";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f9fafb" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
  },
  headerGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  nameText: { fontSize: 22, fontWeight: "bold", color: "#111827" },
  headerRightContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  rateBadge: {
    backgroundColor: "#e0e7ff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  rateText: { color: "#4f46e5", fontWeight: "bold", fontSize: 13 },
  logoutButton: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  logoutButtonText: { color: "#dc2626", fontWeight: "bold", fontSize: 12 },
  scheduleCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  scheduleTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 12,
  },
  scheduleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  scheduleLabel: { fontSize: 15, color: "#4b5563", fontWeight: "500" },
  scheduleTime: { fontSize: 16, color: "#111827", fontWeight: "bold" },
  buildingCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  buildingTitle: { fontSize: 18, fontWeight: "bold", color: "#1f2937" },
  buildingAddress: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoBadge: { fontSize: 12, color: "#4b5563", fontWeight: "500" },
  statusBadge: { fontSize: 12, fontWeight: "bold" },
  distanceBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  distanceBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  mapContainer: {
    height: 220,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  map: { width: "100%", height: "100%" },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: "#eef2ff",
    justifyContent: "center",
    alignItems: "center",
  },
  mapLoadingText: { fontSize: 13, color: "#6b7280", marginTop: 8 },
  enableLocationButton: {
    marginTop: 10,
    backgroundColor: "#4f46e5",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  enableLocationButtonText: { color: "#ffffff", fontWeight: "600", fontSize: 13 },
  actionSection: { width: "100%", marginTop: 4 },
  punchButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    elevation: 3,
  },
  punchButtonText: { color: "#ffffff", fontSize: 18, fontWeight: "bold" },
});
