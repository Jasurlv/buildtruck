import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import LanguagePicker from "../../components/LanguagePicker";
import { SessionExpiredError, workerFetch } from "../../utils/api";
import { resetOnboarding } from "../../utils/onboarding";
import { stopBackgroundGeofenceMonitoring } from "../../utils/backgroundGeofence";

type WorkerProfile = {
  full_name?: string;
  username?: string;
  hourly_rate?: number | string;
  building_name?: string;
  building_address?: string;
  address?: string;
  radius_meters?: number | string;
};

export default function ProfileScreen() {
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();

  const loadWorkerInfo = useCallback(async (isFocused: () => boolean) => {
    try {
      const data = await SecureStore.getItemAsync("worker_data");
      if (!data) {
        router.replace("/login");
        return;
      }

      const profile: WorkerProfile = JSON.parse(data);
      if (isFocused()) setWorker(profile);
    } catch (err) {
      console.error("Failed to load worker profile:", err);
      if (isFocused()) {
        Alert.alert(t("profile.loadFailedTitle"), t("profile.loadFailed"));
      }
    } finally {
      if (isFocused()) setLoading(false);
    }
  }, [router, t]);

  useFocusEffect(
    useCallback(() => {
      let isFocused = true;
      void loadWorkerInfo(() => isFocused);
      return () => {
        isFocused = false;
      };
    }, [loadWorkerInfo]),
  );

  const handleLogout = () => {
    Alert.alert(t("profile.logOutConfirmTitle"), t("profile.logOutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("profile.logOut"),
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            const response = await workerFetch("/attendance/active");
            if (!response.ok) {
              throw new Error("Unable to verify whether a shift is active.");
            }
            const { activeShift } = await response.json();
            if (activeShift) {
              Alert.alert(t("profile.shiftInProgressTitle"), t("profile.shiftInProgress"));
              return;
            }
            await stopBackgroundGeofenceMonitoring();
            await Promise.all([
              SecureStore.deleteItemAsync("worker_token"),
              SecureStore.deleteItemAsync("worker_data"),
              SecureStore.deleteItemAsync("shift_lunch_paused"),
              SecureStore.deleteItemAsync("geofence_last_result"),
            ]);
            router.replace("/login");
          } catch (err) {
            if (err instanceof SessionExpiredError) return;
            console.error("Failed to clear login data:", err);
            Alert.alert(t("profile.logOutFailedTitle"), t("profile.logOutFailed"));
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      </SafeAreaView>
    );
  }

  const hourlyRate = Number(worker?.hourly_rate);
  const radius = Number(worker?.radius_meters);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.screenHeader}>{t("profile.title")}</Text>
        <Text style={styles.screenSubtitle}>{t("profile.subtitle")}</Text>

        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {worker?.full_name?.trim().charAt(0).toUpperCase() || "W"}
            </Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.workerName}>{worker?.full_name || t("profile.worker")}</Text>
            <Text style={styles.workerUsername}>
              {worker?.username ? `@${worker.username}` : t("profile.workerAccount")}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("profile.accountDetails")}</Text>
          <ProfileRow
            label={t("profile.hourlyRate")}
            value={
              Number.isFinite(hourlyRate)
                ? t("units.perHour", { rate: hourlyRate.toFixed(2) })
                : t("profile.notSet")
            }
          />
          <LanguagePicker variant="row" />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("profile.assignedWorkplace")}</Text>
          <ProfileRow
            label={t("profile.site")}
            value={worker?.building_name || t("profile.unassigned")}
          />
          <ProfileRow
            label={t("profile.address")}
            value={worker?.building_address || worker?.address || t("profile.noAddress")}
          />
          <ProfileRow
            label={t("profile.radius")}
            value={
              Number.isFinite(radius) ? t("units.meters", { count: radius }) : t("profile.notSet")
            }
            last
          />
        </View>

        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>{t("profile.needHelp")}</Text>
          <Text style={styles.helpText}>{t("profile.helpText")}</Text>
          <TouchableOpacity
            style={styles.contactButton}
            onPress={() => router.push("/contact")}
            accessibilityRole="button"
          >
            <Text style={styles.contactButtonText}>✉️ {t("profile.contact")}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>
          {t("profile.version", { version: Constants.expoConfig?.version || "1.0.0" })}
        </Text>

        <TouchableOpacity
          style={[styles.logoutButton, loggingOut && styles.disabledButton]}
          onPress={handleLogout}
          disabled={loggingOut}
          accessibilityRole="button"
        >
          {loggingOut ? (
            <ActivityIndicator color="#dc2626" />
          ) : (
            <Text style={styles.logoutButtonText}>{t("profile.logOut")}</Text>
          )}
        </TouchableOpacity>

        {/* Intro pages, then the Permissions screen, then back into the app (the
            session is kept). */}
        <TouchableOpacity
          onPress={async () => {
            await resetOnboarding().catch(() => {});
            router.replace("/onboarding");
          }}
          accessibilityRole="button"
        >
          <Text style={styles.devLinkText}>{t("profile.showOnboardingAgain")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.lastRow]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f9fafb" },
  container: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  screenHeader: { fontSize: 24, fontWeight: "bold", color: "#111827" },
  screenSubtitle: { color: "#6b7280", fontSize: 14, marginTop: 4, marginBottom: 18 },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eef2ff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4f46e5",
  },
  avatarText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  identityText: { marginLeft: 12, flex: 1 },
  workerName: { color: "#111827", fontSize: 18, fontWeight: "700" },
  workerUsername: { color: "#6b7280", fontSize: 14, marginTop: 3 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  lastRow: { borderBottomWidth: 0, paddingBottom: 2 },
  label: { flex: 1, fontSize: 14, color: "#6b7280" },
  value: { flex: 1, fontSize: 14, fontWeight: "600", color: "#111827", textAlign: "right" },
  helpCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 18,
  },
  helpTitle: { fontSize: 15, fontWeight: "700", color: "#1f2937", marginBottom: 6 },
  helpText: { color: "#6b7280", fontSize: 13, lineHeight: 19 },
  contactButton: {
    marginTop: 12,
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  contactButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  versionText: { textAlign: "center", color: "#9ca3af", fontSize: 12, marginBottom: 14 },
  logoutButton: {
    backgroundColor: "#fee2e2",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  disabledButton: { opacity: 0.6 },
  logoutButtonText: { color: "#dc2626", fontSize: 16, fontWeight: "700" },
  devLinkText: { textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 16 },
});
