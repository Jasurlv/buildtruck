import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import LanguagePicker from "../components/LanguagePicker";
import { markOnboardingCompleted } from "../utils/onboarding";

// One icon per intro page; the text is in i18n/locales (onboarding.steps).
const ICONS = ["🏗️", "📍"];
const LAST_STEP = ICONS.length - 1;

type Step = { title: string; body: string; points: string[] };

// Intro pages shown on first launch. They always lead to the Permissions screen,
// which the worker must pass before logging in (Skip only skips the pages).
export default function OnboardingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const steps = t("onboarding.steps", { returnObjects: true }) as Step[];

  const finish = async () => {
    try {
      await markOnboardingCompleted();
    } catch {
      // Storage failed: the intro pages show again next launch, nothing else breaks.
    }
    router.replace("/permissions");
  };

  const current = steps[step];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <LanguagePicker variant="compact" />
        <TouchableOpacity onPress={() => void finish()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>{ICONS[step]}</Text>
        </View>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>
        {current.points.map((point) => (
          <View key={point} style={styles.pointRow}>
            <Text style={styles.pointBullet}>•</Text>
            <Text style={styles.pointText}>{point}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {ICONS.map((icon, index) => (
            <View key={icon} style={[styles.dot, index === step && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => (step < LAST_STEP ? setStep(step + 1) : void finish())}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {step < LAST_STEP ? t("onboarding.next") : t("onboarding.continue")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
});
