import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { markOnboardingCompleted } from "../utils/onboarding";
import {
  getLocationPermission,
  openAppSettings,
  requestLocationPermission,
  type LocationPermission,
} from "../utils/locationPermission";

const STEPS = [
  {
    icon: "🏗️",
    title: "Welcome to TimeTrack",
    body: "Record your work day at the building in a few taps.",
    points: [
      "Start work when you arrive at your building",
      "Log your lunch break",
      "Finish work and see your hours and earnings",
    ],
  },
  {
    icon: "📍",
    title: "Why TimeTrack needs your location",
    body: "When you tap Start Work, TimeTrack checks that you are at your assigned building. This needs your precise location.",
    points: [
      "Checked when you start work, to confirm you are at your building",
      "During a shift, the app checks that you are still at the building",
      "Not used to track you outside work: your location is only sent when you tap Start Work",
    ],
  },
  {
    icon: "✅",
    title: "Allow location access",
    body: "TimeTrack only uses your location while the app is open. You can change this later in your phone's Settings.",
    points: [],
  },
] as const;

const PERMISSION_STEP = STEPS.length - 1;

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [requesting, setRequesting] = useState(false);

  const refreshPermission = useCallback(async () => {
    setPermission(await getLocationPermission());
  }, []);

  // On the permission step, re-check whenever the app returns to the foreground,
  // e.g. after the worker changed the setting in the phone's Settings.
  useEffect(() => {
    if (step !== PERMISSION_STEP) return;
    void refreshPermission();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => subscription.remove();
  }, [step, refreshPermission]);

  const finish = async () => {
    try {
      await markOnboardingCompleted();
    } catch (error) {
      console.error("Unable to save onboarding state:", error);
    }
    const token = await SecureStore.getItemAsync("worker_token");
    router.replace(token ? "/(tabs)" : "/login");
  };

  const handleRequestPermission = async () => {
    setRequesting(true);
    try {
      setPermission(await requestLocationPermission());
    } catch (error) {
      console.error("Location permission request failed:", error);
    } finally {
      setRequesting(false);
    }
  };

  const current = STEPS[step];
  const isPermissionStep = step === PERMISSION_STEP;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={finish} hitSlop={12} accessibilityRole="button">
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>{current.icon}</Text>
        </View>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>
        {current.points.map((point) => (
          <View key={point} style={styles.pointRow}>
            <Text style={styles.pointBullet}>•</Text>
            <Text style={styles.pointText}>{point}</Text>
          </View>
        ))}
        {isPermissionStep && permission && <PermissionStatus permission={permission} />}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((s, index) => (
            <View
              key={s.title}
              style={[styles.dot, index === step && styles.dotActive]}
            />
          ))}
        </View>

        {!isPermissionStep ? (
          <PrimaryButton label="Next" onPress={() => setStep(step + 1)} />
        ) : !permission ? (
          <ActivityIndicator color="#4f46e5" style={styles.loader} />
        ) : permission.state === "granted" ? (
          <>
            {permission.isReducedAccuracy && (
              <SecondaryButton label="Open Settings" onPress={openAppSettings} />
            )}
            <PrimaryButton label="Continue" onPress={finish} />
          </>
        ) : permission.state === "blocked" ? (
          <>
            <PrimaryButton label="Open Settings" onPress={openAppSettings} />
            <SecondaryButton label="Continue without location" onPress={finish} />
          </>
        ) : (
          <>
            <PrimaryButton
              label={permission.state === "denied" ? "Try again" : "Allow location access"}
              onPress={handleRequestPermission}
              loading={requesting}
            />
            {permission.state === "denied" && (
              <SecondaryButton label="Continue without location" onPress={finish} />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function PermissionStatus({ permission }: { permission: LocationPermission }) {
  if (permission.state === "undetermined") return null;

  if (permission.state === "granted") {
    return permission.isReducedAccuracy ? (
      <View style={[styles.statusCard, styles.statusWarning]}>
        <Text style={styles.statusTitle}>Precise Location is off</Text>
        <Text style={styles.statusText}>
          TimeTrack may not be able to confirm you are at the building. In Settings, open
          Location and turn on Precise Location.
        </Text>
      </View>
    ) : (
      <View style={[styles.statusCard, styles.statusSuccess]}>
        <Text style={styles.statusTitle}>Location access allowed</Text>
        <Text style={styles.statusText}>You are ready to start work at your building.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.statusCard, styles.statusError]}>
      <Text style={styles.statusTitle}>Location access is off</Text>
      <Text style={styles.statusText}>
        {permission.state === "blocked"
          ? "You can still log in, but you can't start work until you allow location. In Settings, open Location and choose \"While Using the App\"."
          : "You can still log in, but you can't start work until you allow location."}
      </Text>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.primaryButton}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.secondaryButton} onPress={onPress} accessibilityRole="button">
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 24,
    paddingTop: 8,
    minHeight: 32,
  },
  skipText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6b7280",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  iconContainer: {
    alignSelf: "center",
    backgroundColor: "#e0e7ff",
    padding: 24,
    borderRadius: 28,
    marginBottom: 24,
  },
  iconText: {
    fontSize: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#111827",
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 20,
  },
  pointRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  pointBullet: {
    fontSize: 16,
    color: "#4f46e5",
    fontWeight: "bold",
    marginRight: 10,
    lineHeight: 22,
  },
  pointText: {
    flex: 1,
    fontSize: 15,
    color: "#374151",
    lineHeight: 22,
  },
  statusCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  statusSuccess: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  statusWarning: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  statusError: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  statusTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 10,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d1d5db",
  },
  dotActive: {
    width: 24,
    backgroundColor: "#4f46e5",
  },
  loader: {
    paddingVertical: 16,
  },
  primaryButton: {
    backgroundColor: "#4f46e5",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#eef2ff",
  },
  secondaryButtonText: {
    color: "#4f46e5",
    fontSize: 15,
    fontWeight: "600",
  },
});
