import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { CONTACT } from "../constants/contact";

/** The support email, prefilled with what support needs to help. */
function mailtoUrl(username: string | null): string {
  const t = i18n.t.bind(i18n);
  const body = [
    t("contact.emailIntro"),
    "",
    "",
    "",
    `--- ${t("contact.emailDetails")} ---`,
    `${t("contact.emailUsername")}: ${username ?? "-"}`,
    `${t("contact.emailAppVersion")}: ${Constants.expoConfig?.version ?? "-"}`,
    `${t("contact.emailPlatform")}: ${Platform.OS}`,
    `${t("contact.emailOsVersion")}: ${String(Platform.Version)}`,
  ].join("\n");
  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(CONTACT.emailSubject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Opens the link; if nothing on the phone can open it (no phone app, no email app,
 * no browser), shows a friendly message with the contact details instead.
 * Telegram and WhatsApp links are https: without the app they open in the browser,
 * which offers to install it.
 */
async function openOrExplain(url: string, unavailableMessage: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(i18n.t("contact.unavailableTitle"), unavailableMessage);
  }
}

export default function ContactScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync("worker_data")
      .then((data) => setUsername(data ? (JSON.parse(data).username ?? null) : null))
      .catch(() => setUsername(null));
  }, []);

  const buttons = [
    {
      key: "call",
      icon: "📞",
      label: t("contact.call"),
      detail: CONTACT.phone,
      onPress: () =>
        openOrExplain(
          `tel:${CONTACT.phone.replace(/\s+/g, "")}`,
          t("contact.phoneUnavailable", { phone: CONTACT.phone }),
        ),
    },
    {
      key: "email",
      icon: "✉️",
      label: t("contact.email"),
      detail: CONTACT.email,
      onPress: () =>
        openOrExplain(mailtoUrl(username), t("contact.emailUnavailable", { email: CONTACT.email })),
    },
    {
      key: "telegram",
      icon: "💬",
      label: t("contact.telegram"),
      detail: CONTACT.telegramUrl.replace(/^https:\/\//, ""),
      onPress: () =>
        openOrExplain(
          CONTACT.telegramUrl,
          t("contact.telegramUnavailable", { link: CONTACT.telegramUrl }),
        ),
    },
    {
      key: "whatsapp",
      icon: "🟢",
      label: t("contact.whatsapp"),
      detail: CONTACT.phone,
      onPress: () =>
        openOrExplain(
          CONTACT.whatsappUrl,
          t("contact.whatsappUnavailable", { phone: CONTACT.phone }),
        ),
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
          style={styles.backButton}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>{t("contact.back")}</Text>
        </TouchableOpacity>

        <Text style={styles.title} accessibilityRole="header">
          {t("contact.title")}
        </Text>
        <Text style={styles.intro}>{t("contact.intro")}</Text>

        {buttons.map((button) => (
          <TouchableOpacity
            key={button.key}
            style={styles.button}
            onPress={() => void button.onPress()}
            accessibilityRole="button"
          >
            <Text style={styles.icon}>{button.icon}</Text>
            <View style={styles.buttonText}>
              <Text style={styles.label}>{button.label}</Text>
              <Text style={styles.detail}>{button.detail}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f9fafb" },
  container: { padding: 20, paddingBottom: 40 },
  backButton: { alignSelf: "flex-start", paddingVertical: 6, marginBottom: 12 },
  backText: { color: "#4f46e5", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "bold", color: "#111827" },
  intro: { color: "#4b5563", fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    marginBottom: 12,
  },
  icon: { fontSize: 24, marginRight: 14 },
  buttonText: { flex: 1 },
  label: { fontSize: 16, fontWeight: "700", color: "#111827" },
  detail: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  chevron: { fontSize: 24, color: "#9ca3af", marginLeft: 8 },
});
