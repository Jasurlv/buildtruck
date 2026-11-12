import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { hasCompletedOnboarding } from "../utils/onboarding";
import { decideStartRoute } from "../utils/permissionGate";
import { checkPermissionGate } from "../utils/permissions";

const ROUTES = {
  onboarding: "/onboarding",
  permissions: "/permissions",
  login: "/login",
  app: "/(tabs)",
} as const;

// Entry point on every start: intro pages (first launch) → Permissions (until all
// are granted; re-checked every start) → login, or straight into the app when
// signed in. The session is kept while the Permissions screen is shown.
export default function EntryScreen() {
  const router = useRouter();

  useEffect(() => {
    const route = async () => {
      const onboardingDone = await hasCompletedOnboarding();
      const [gate, token] = onboardingDone
        ? await Promise.all([
            checkPermissionGate(),
            SecureStore.getItemAsync("worker_token").catch(() => null),
          ])
        : [null, null];
      const next = decideStartRoute({
        onboardingDone,
        permissionsOk: gate?.canContinue ?? false,
        hasSession: Boolean(token),
      });
      router.replace(ROUTES[next]);
    };
    void route();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4f46e5" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
});
