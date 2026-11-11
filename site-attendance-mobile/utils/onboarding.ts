import AsyncStorage from "@react-native-async-storage/async-storage";

// Not secret, so AsyncStorage rather than SecureStore. Unlike the iOS Keychain it
// is wiped when the app is deleted, so a reinstall shows the onboarding again.
const ONBOARDING_DONE_KEY = "onboarding_done_v1";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_DONE_KEY)) === "true";
  } catch {
    // If storage is unavailable, don't trap the worker in onboarding.
    return true;
  }
}

export async function markOnboardingCompleted(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_DONE_KEY, "true");
}

/** Development helper so the onboarding can be tested again. */
export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_DONE_KEY);
}
