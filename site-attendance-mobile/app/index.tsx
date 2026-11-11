import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { hasCompletedOnboarding } from "../utils/onboarding";

// Entry point: first launch → onboarding, signed in → Today, otherwise → login.
export default function EntryScreen() {
  const router = useRouter();

  useEffect(() => {
    const route = async () => {
      if (!(await hasCompletedOnboarding())) {
        router.replace("/onboarding");
        return;
      }
      const token = await SecureStore.getItemAsync("worker_token");
      router.replace(token ? "/(tabs)" : "/login");
    };
    void route();
  }, []);

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
