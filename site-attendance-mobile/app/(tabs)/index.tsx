import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AppState,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { hoursText } from "../../i18n/format";
import LanguagePicker from "../../components/LanguagePicker";
import { SessionExpiredError, workerFetch } from "../../utils/api";
import { errorText, readJson, throwServerError } from "../../utils/serverErrors";
import type { ShiftRules } from "../../utils/shiftTime";
import { checkPermissionGate } from "../../utils/permissions";
import {
  getLocationPermission,
  openAppSettings,
  requestLocationPermission,
  type LocationPermissionState,
} from "../../utils/locationPermission";

type AutoClosedShift = { id: number; closed_after_hours?: number };

// Shifts whose "closed automatically" notice is showing or was acknowledged in this
// app session, so refocusing the tab does not stack a second alert.
const autoCloseNoticesShown = new Set<number>();

/**
 * Shows the server's one-time notice for a shift it closed after the maximum length,
 * and acknowledges it when the worker taps OK (so it is not shown again anywhere).
 */
function showAutoClosedNotice(data: {
  last_shift_auto_closed?: boolean;
  auto_closed_shift?: AutoClosedShift | null;
  rules?: ShiftRules | null;
}) {
  const closed = data.auto_closed_shift;
  if (!data.last_shift_auto_closed || !closed || autoCloseNoticesShown.has(closed.id)) return;
  const hours = closed.closed_after_hours ?? data.rules?.max_shift_hours;
  if (hours === undefined) return;
  autoCloseNoticesShown.add(closed.id);
  const acknowledge = async () => {
    try {
      const response = await workerFetch(`/attendance/auto-closed/${closed.id}/acknowledge`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      // Not recorded (e.g. offline): show it again next time the status loads.
      autoCloseNoticesShown.delete(closed.id);
    }
  };
  Alert.alert(
    i18n.t("shift.autoClosedTitle"),
    i18n.t("shift.autoClosedMessage", { duration: hoursText(hours) }),
    [{ text: i18n.t("common.ok"), onPress: () => void acknowledge() }],
    { cancelable: false },
  );
}

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

  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const router = useRouter();
  const { t } = useTranslation();
  // Set when no GPS fix has arrived for a while, to show a hint.
  const [gpsSlow, setGpsSlow] = useState(false);
  const waitingForGps = locationPermission === "granted" && currentLocation === null;

  useEffect(() => {
    setGpsSlow(false);
    if (!waitingForGps) return;
    const timer = setTimeout(() => setGpsSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [waitingForGps]);

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
      showAutoClosedNotice(data);

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

    const handleLocation = (location: Location.LocationObject) => {
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
      }
    };

    // Show a distance at once from the phone's last known position, while the
    // watch below waits for a fresh fix. Only a recent, reasonably accurate one:
    // Start Work sends this position, so an old one from elsewhere must not count.
    try {
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 60_000,
        requiredAccuracy: 100,
      });
      if (lastKnown) handleLocation(lastKnown);
    } catch {
      // No cached position: wait for the watch.
    }
    if (!isFocused() || locationSubscription.current) return;

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 3,
      },
      handleLocation,
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
    const message = t("today.locationRequiredMessage", {
      building: worker?.building_name || t("today.yourBuilding"),
    });
    if (locationPermission === "blocked") {
      Alert.alert(
        t("today.locationRequiredTitle"),
        `${message}\n\n${t("today.turnOnInSettings")}`,
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.openSettings"), onPress: () => void openAppSettings() },
        ],
      );
      return;
    }
    Alert.alert(t("today.locationRequiredTitle"), message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("today.allow"),
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

    // Every required permission, checked now: one may have been turned off since
    // the app opened. Say what is wrong instead of failing later.
    const gate = await checkPermissionGate();
    if (!gate.canContinue) {
      Alert.alert(t("permissions.startWorkTitle"), t("permissions.startWorkMessage"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("permissions.fix"),
          onPress: () =>
            router.push({ pathname: "/permissions", params: { returnTo: "back" } }),
        },
      ]);
      return;
    }

    if (locationPermission !== "granted") {
      showLocationRequiredAlert();
      return;
    }

    if (!worker || !currentLocation) {
      Alert.alert(t("today.gpsNotReadyTitle"), t("today.gpsNotReady"));
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

      const data = await readJson(res);
      if (!res.ok) throwServerError(res, data);

      setActiveShift(data.log);
      router.push("/shift-active");
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      Alert.alert(t("today.startFailedTitle"), errorText(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const locationMissing =
    locationPermission !== null && locationPermission !== "granted";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Grid */}
        <View style={styles.headerGrid}>
          <Text style={styles.nameText} numberOfLines={1}>
            {worker?.full_name}
          </Text>
          <LanguagePicker variant="compact" />
        </View>

        {/* Today's Schedule Card */}
        <View style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>{t("today.scheduleTitle")}</Text>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>{t("today.arrive")}</Text>
            <Text style={styles.scheduleTime}>
              {t("today.byTime", { time: schedule?.arrive_by ?? "–" })}
            </Text>
          </View>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>{t("today.workStarts")}</Text>
            <Text style={styles.scheduleTime}>{schedule?.work_start ?? "–"}</Text>
          </View>

          <View style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>
              {rules
                ? t("today.lunch", { min: rules.lunch_min_minutes, max: rules.lunch_max_minutes })
                : t("today.lunchNoRules")}
            </Text>
            <Text style={styles.scheduleTime}>
              {rules ? `${rules.lunch_opens_local}–${rules.lunch_latest_start_local}` : "–"}
            </Text>
          </View>

          <View style={[styles.scheduleRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.scheduleLabel}>{t("today.workEnds")}</Text>
            <Text style={styles.scheduleTime}>18:00</Text>
          </View>
        </View>

        {/* Building Details Card */}
        <View style={styles.buildingCard}>
          <Text style={styles.buildingTitle}>
            {worker?.building_name || t("today.unassignedSite")}
          </Text>
          <Text style={styles.buildingAddress}>
            {worker?.building_address || worker?.address || t("today.noAddress")}
          </Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoBadge}>
              {t("today.radius", { radius: worker?.radius_meters || 30 })}
            </Text>
            <Text
              style={[
                styles.statusBadge,
                { color: isInsideGeofence ? "#059669" : "#dc2626" },
              ]}
            >
              {locationMissing
                ? t("today.statusLocationOff")
                : isInsideGeofence
                  ? t("today.statusOnSite")
                  : distance !== null
                    ? t("today.statusAway", { distance })
                    : t("today.statusLocating")}
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
              ? t("today.bannerLocationRequired")
              : isInsideGeofence
                ? t("today.bannerOnSite")
                : distance !== null
                  ? t("today.bannerFar", { distance })
                  : t("today.bannerCalculating")}
          </Text>
        </View>

        {/* Distance to the building (no map) */}
        <View style={styles.distanceCard}>
          {locationMissing ? (
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapLoadingText}>{t("today.mapLocationOff")}</Text>
              <TouchableOpacity
                onPress={showLocationRequiredAlert}
                style={styles.enableLocationButton}
              >
                <Text style={styles.enableLocationButtonText}>
                  {t("today.turnOnLocation")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : distance !== null ? (
            <View style={styles.mapPlaceholder}>
              <Text style={styles.distanceValue}>{t("units.meters", { count: distance })}</Text>
              <Text style={styles.distanceLabel}>{t("today.distanceFromBuilding")}</Text>
              <Text
                style={[
                  styles.distanceStatus,
                  { color: isInsideGeofence ? "#059669" : "#dc2626" },
                ]}
              >
                {isInsideGeofence ? t("today.insideWorkArea") : t("today.outsideWorkArea")}
              </Text>
            </View>
          ) : currentLocation ? (
            // A fix, but the building has no coordinates to measure against.
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapLoadingText}>{t("today.unassignedSite")}</Text>
            </View>
          ) : (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator color="#4f46e5" />
              <Text style={styles.mapLoadingText}>{t("today.acquiringGps")}</Text>
              {gpsSlow && (
                <Text style={styles.gpsSlowText}>{t("today.acquiringGpsSlow")}</Text>
              )}
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
                {activeShift ? t("today.working") : t("today.startWork")}
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
  nameText: { flex: 1, marginRight: 12, fontSize: 22, fontWeight: "bold", color: "#111827" },
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
  distanceCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  mapPlaceholder: {
    minHeight: 140,
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: "#eef2ff",
    justifyContent: "center",
    alignItems: "center",
  },
  mapLoadingText: { fontSize: 13, color: "#6b7280", marginTop: 8, textAlign: "center" },
  gpsSlowText: {
    fontSize: 13,
    color: "#92400e",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 18,
  },
  distanceValue: { fontSize: 40, fontWeight: "bold", color: "#111827" },
  distanceLabel: { fontSize: 14, color: "#6b7280", marginTop: 2 },
  distanceStatus: { fontSize: 16, fontWeight: "bold", marginTop: 12, textAlign: "center" },
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
