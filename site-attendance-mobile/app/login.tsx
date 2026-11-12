import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import LanguagePicker from "../components/LanguagePicker";
import { SESSION_EXPIRED_REASON, getApiBaseUrl, startWorkerSession } from "../utils/api";
import { checkPermissionGate } from "../utils/permissions";
import { errorText, readJson, throwServerError } from "../utils/serverErrors";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const sessionExpired = reason === SESSION_EXPIRED_REASON;

  // Login is also reached by logging out or an expired session: the permissions
  // must still be complete, otherwise the worker fixes them first.
  useEffect(() => {
    void checkPermissionGate().then((gate) => {
      if (!gate.canContinue) router.replace("/permissions");
    });
  }, [router]);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert(t("login.missingTitle"), t("errors.missingCredentials"));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/worker-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await readJson(response);
      if (!response.ok) throwServerError(response, data);

      // Securely store the token and worker details
      await startWorkerSession(data.token, data.worker);

      // Redirect to the main tabs dashboard
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert(t("login.failedTitle"), errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      {/* The worker may not read the phone's language: let them switch before signing in. */}
      <View style={styles.languageRow}>
        <LanguagePicker variant="compact" />
      </View>
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>🏗️</Text>
        </View>
        <Text style={styles.title}>{t("login.title")}</Text>
        <Text style={styles.subtitle}>{t("login.subtitle")}</Text>

        {sessionExpired && (
          <View style={styles.noticeBanner} accessibilityRole="alert">
            <Text style={styles.noticeText}>{t("errors.sessionExpired")}</Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{t("login.username")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("login.usernamePlaceholder")}
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{t("login.password")}</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#9ca3af"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t("login.signIn")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  languageRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  iconContainer: {
    alignSelf: "center",
    backgroundColor: "#e0e7ff",
    padding: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  iconText: {
    fontSize: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  noticeBanner: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  noticeText: {
    color: "#92400e",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    fontSize: 16,
    color: "#1f2937",
  },
  button: {
    backgroundColor: "#4f46e5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#4f46e5",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
