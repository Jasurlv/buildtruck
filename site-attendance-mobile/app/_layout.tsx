import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
// Initialises the app language before any screen renders.
import "../i18n";
import { hasCompletedOnboarding } from "../utils/onboarding";
import { isGateExemptRoute, shouldOpenPermissionGate } from "../utils/permissionGate";
import { checkPermissionGate } from "../utils/permissions";

// The background geofence task is defined in the app's entry file (index.ts), so it
// exists even when Android starts the app in the background without any screen.

/**
 * Re-checks the permissions whenever the app returns to the foreground. If one was
 * revoked (e.g. in the phone's Settings), the Permissions screen opens over the
 * current screen; the session is kept and Continue returns here. App start is
 * checked by the entry screen (app/index.tsx).
 */
function PermissionWatcher() {
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef<readonly string[]>(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking || isGateExemptRoute(segmentsRef.current)) return;
      checking = true;
      try {
        if (!(await hasCompletedOnboarding())) return;
        const gate = await checkPermissionGate();
        if (shouldOpenPermissionGate(segmentsRef.current, gate)) {
          router.push({ pathname: "/permissions", params: { returnTo: "back" } });
        }
      } finally {
        checking = false;
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  return (
    <>
      <PermissionWatcher />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Entry: routes to onboarding, permissions, login or the tabs */}
        <Stack.Screen name="index" options={{ headerShown: false }} />

        {/* First-launch intro pages (shown once) */}
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />

        {/* Permission gate: required before login, re-opened when one is revoked */}
        <Stack.Screen
          name="permissions"
          options={{ headerShown: false, gestureEnabled: false }}
        />

        {/* Worker Login Screen */}
        <Stack.Screen name="login" options={{ headerShown: false }} />

        {/* Main Tab Bar Screen */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Contact / Report a problem (from the Profile screen) */}
        <Stack.Screen name="contact" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
