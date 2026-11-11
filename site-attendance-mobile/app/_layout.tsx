import "../utils/backgroundGeofence";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Entry: routes to onboarding, login or the tabs */}
      <Stack.Screen name="index" options={{ headerShown: false }} />

      {/* First-launch onboarding (shown once) */}
      <Stack.Screen
        name="onboarding"
        options={{ headerShown: false, gestureEnabled: false }}
      />

      {/* Worker Login Screen */}
      <Stack.Screen name="login" options={{ headerShown: false }} />

      {/* Main Tab Bar Screen */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
