import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { strings } from "../constants/strings";
import {
  routeAfterPermissions,
  type GateItem,
  type GateState,
  type Guide,
  type PermissionKey,
} from "../utils/permissionGate";
import {
  checkPermissionGate,
  openAppSettings,
  openBatterySettings,
  requestBackgroundLocation,
  requestNotifications,
  requestPreciseLocation,
} from "../utils/permissions";

const t = strings.permissions;
const platform = Platform.OS;

const REQUESTS: Record<PermissionKey, () => Promise<void>> = {
  location: requestPreciseLocation,
  backgroundLocation: requestBackgroundLocation,
  notifications: requestNotifications,
};

function guideSteps(guide: Guide): readonly string[] {
  switch (guide) {
    case "androidAllTheTime":
      return t.guides.androidAllTheTime;
    case "iosAlways":
      return t.guides.iosAlways;
    case "preciseLocation":
      return t.guides.preciseLocation(platform);
    case "settingsLocation":
      return t.guides.settingsLocation(platform);
    case "settingsBackground":
      return t.guides.settingsBackground(platform);
    case "settingsNotifications":
      return t.guides.settingsNotifications(platform);
    default:
      return [];
  }
}

function itemText(key: PermissionKey): { title: string; reason: string; button: string } {
  switch (key) {
    case "location":
      return t.location;
    case "backgroundLocation":
      return {
        title: t.backgroundLocation.title(platform),
        reason: t.backgroundLocation.reason,
        button: t.backgroundLocation.button(platform),
      };
    case "notifications":
      return t.notifications;
  }
}

/**
 * Lists every permission the app needs with its status, the reason and one button
 * each. The worker cannot continue until all required ones are granted. Opened
 * after the intro pages, at start-up when one is missing, and over the app
 * (`returnTo=back`) when one was revoked; it then returns to where the worker was.
 */
export default function PermissionsScreen() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [gate, setGate] = useState<GateState | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState<PermissionKey | "continue" | null>(null);

  const refresh = useCallback(async () => {
    const next = await checkPermissionGate();
    setGate(next);
    return next;
  }, []);

  // Re-check on open and whenever the worker comes back from the phone's Settings.
  useEffect(() => {
    void refresh();
    SecureStore.getItemAsync("worker_token")
      .then((token) => setHasSession(Boolean(token)))
      .catch(() => setHasSession(false));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Android back must not skip the gate (or close the app from it).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => subscription.remove();
    }, []),
  );

  const openSettings = () => {
    openAppSettings().catch(() => {});
  };

  const handleItem = async (item: GateItem) => {
    if (item.status === "settings") {
      openSettings();
      return;
    }
    setBusy(item.key);
    try {
      await REQUESTS[item.key]();
    } catch {
      // Expected on some phones (e.g. the OS refuses to show the dialog): guide to Settings.
      Alert.alert(t.requestFailedTitle, t.requestFailed, [
        { text: strings.cancel, style: "cancel" },
        { text: t.openSettings, onPress: openSettings },
      ]);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const handleContinue = async () => {
    setBusy("continue");
    try {
      // Statuses can change without the screen noticing (e.g. a quick toggle).
      const latest = await refresh();
      if (!latest.canContinue) return;
      const token = await SecureStore.getItemAsync("worker_token").catch(() => null);
      const next = routeAfterPermissions({
        openedOverApp: returnTo === "back",
        canGoBack: router.canGoBack(),
        hasSession: Boolean(token),
      });
      if (next === "back") router.back();
      else router.replace(next === "app" ? "/(tabs)" : "/login");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.title}
        </Text>
        <Text style={styles.intro}>{t.intro}</Text>

        <View style={styles.disclosure}>
          <Text style={styles.disclosureTitle}>{t.disclosureTitle}</Text>
          {t.disclosure.map((line) => (
            <View key={line} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.disclosureText}>{line}</Text>
            </View>
          ))}
        </View>

        {!gate ? (
          <ActivityIndicator color="#4f46e5" style={styles.loader} />
        ) : (
          gate.items.map((item) => (
            <PermissionCard
              key={item.key}
              item={item}
              highlighted={gate.nextStep === item.key}
              busy={busy === item.key}
              disabled={busy !== null}
              onPress={() => void handleItem(item)}
            />
          ))
        )}

        {platform === "android" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t.battery.title}</Text>
            <Text style={styles.cardText}>{t.battery.body}</Text>
            {t.battery.tips.map((tip) => (
              <View key={tip} style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.stepText}>{tip}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                openBatterySettings().catch(() => {});
              }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>{t.battery.button}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {gate && !gate.canContinue && <Text style={styles.footerHint}>{t.continueHint}</Text>}
        <TouchableOpacity
          style={[styles.primaryButton, !gate?.canContinue && styles.primaryButtonDisabled]}
          onPress={() => void handleContinue()}
          disabled={!gate?.canContinue || busy !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: !gate?.canContinue }}
        >
          {busy === "continue" ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {hasSession || returnTo === "back" ? t.continue : t.continueToLogin}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function PermissionCard({
  item,
  highlighted,
  busy,
  disabled,
  onPress,
}: {
  item: GateItem;
  highlighted: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const text = itemText(item.key);
  const steps = guideSteps(item.guide);
  const badge =
    item.status === "granted"
      ? { label: t.statusGranted, style: styles.badgeGranted }
      : item.status === "waiting"
        ? { label: t.statusWaiting, style: styles.badgeWaiting }
        : item.status === "notAvailable"
          ? { label: t.statusNotAvailable, style: styles.badgeWaiting }
          : { label: t.statusMissing, style: styles.badgeMissing };
  const showButton = item.status === "ask" || item.status === "settings";

  return (
    <View style={[styles.card, highlighted && styles.cardHighlighted]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{text.title}</Text>
        <Text style={[styles.badge, badge.style]}>{badge.label}</Text>
      </View>
      <Text style={styles.cardText}>{text.reason}</Text>
      {item.status === "notAvailable" && (
        <Text style={styles.noteText}>{t.backgroundLocation.expoGo}</Text>
      )}
      {showButton &&
        steps.map((step, index) => (
          <View key={step} style={styles.bulletRow}>
            <Text style={styles.stepNumber}>{index + 1}.</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      {showButton && (
        <TouchableOpacity
          style={styles.itemButton}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.itemButtonText}>
              {item.status === "settings" ? t.openSettings : text.button}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  content: { padding: 20, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: "bold", color: "#111827", marginTop: 8 },
  intro: { fontSize: 15, color: "#4b5563", lineHeight: 22, marginTop: 6, marginBottom: 16 },
  disclosure: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  disclosureTitle: { fontSize: 16, fontWeight: "bold", color: "#312e81", marginBottom: 8 },
  disclosureText: { flex: 1, fontSize: 14, color: "#312e81", lineHeight: 20 },
  bulletRow: { flexDirection: "row", marginTop: 6 },
  bullet: { width: 16, fontSize: 14, color: "#4f46e5", fontWeight: "bold", lineHeight: 20 },
  loader: { paddingVertical: 24 },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHighlighted: { borderColor: "#4f46e5", borderWidth: 2 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { flexShrink: 1, fontSize: 16, fontWeight: "bold", color: "#111827" },
  cardText: { fontSize: 14, color: "#4b5563", lineHeight: 20, marginTop: 6 },
  noteText: { fontSize: 13, color: "#92400e", lineHeight: 19, marginTop: 8 },
  badge: {
    fontSize: 12,
    fontWeight: "bold",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  badgeGranted: { backgroundColor: "#d1fae5", color: "#065f46" },
  badgeMissing: { backgroundColor: "#fee2e2", color: "#991b1b" },
  badgeWaiting: { backgroundColor: "#f3f4f6", color: "#4b5563" },
  stepNumber: { width: 20, fontSize: 14, fontWeight: "bold", color: "#4f46e5", lineHeight: 20 },
  stepText: { flex: 1, fontSize: 14, color: "#374151", lineHeight: 20 },
  itemButton: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 12,
  },
  itemButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  secondaryButton: {
    backgroundColor: "#eef2ff",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryButtonText: { color: "#4f46e5", fontSize: 15, fontWeight: "600" },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  footerHint: { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 8 },
  primaryButton: {
    backgroundColor: "#4f46e5",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  primaryButtonDisabled: { backgroundColor: "#a5b4fc" },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
