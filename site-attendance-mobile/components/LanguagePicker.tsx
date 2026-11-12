import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LANGUAGES, currentLanguage, setLanguage, type Language } from "../i18n";

type Variant = "compact" | "row";

/**
 * Language switcher. "compact": a small globe button with the current code (EN/RU/UZ),
 * for the Today header. "row": a full-width row for the Profile screen. Both open
 * the same picker; the app switches language immediately.
 */
export default function LanguagePicker({ variant = "compact" }: { variant?: Variant }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // i18n.language changes re-render this component (useTranslation subscribes).
  const active = LANGUAGES.find((language) => language.code === i18n.language) ?? LANGUAGES[0];

  const choose = (language: Language) => {
    setOpen(false);
    if (language !== currentLanguage()) void setLanguage(language);
  };

  return (
    <>
      {variant === "compact" ? (
        <TouchableOpacity
          style={styles.compactButton}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("language.buttonLabel", { language: active.name })}
          hitSlop={8}
        >
          <Text style={styles.compactText}>🌐 {active.short}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.row}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("language.buttonLabel", { language: active.name })}
        >
          <Text style={styles.rowLabel}>🌐 {t("language.title")}</Text>
          <Text style={styles.rowValue}>{active.name} ›</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityLabel={t("common.close")}
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t("language.choose")}</Text>
            {LANGUAGES.map((language) => {
              const selected = language.code === active.code;
              return (
                <TouchableOpacity
                  key={language.code}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => choose(language.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {language.name}
                  </Text>
                  <Text style={[styles.optionCode, selected && styles.optionTextSelected]}>
                    {selected ? "✓ " : ""}
                    {language.short}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.cancelButton} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compactButton: {
    backgroundColor: "#e0e7ff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  compactText: { color: "#4f46e5", fontWeight: "bold", fontSize: 13 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 14, color: "#6b7280" },
  rowValue: { fontSize: 14, fontWeight: "600", color: "#4f46e5" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.5)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: { backgroundColor: "#ffffff", borderRadius: 20, padding: 20 },
  sheetTitle: { fontSize: 18, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 8,
  },
  optionSelected: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  optionText: { fontSize: 16, color: "#111827", fontWeight: "600" },
  optionCode: { fontSize: 14, color: "#6b7280", fontWeight: "600" },
  optionTextSelected: { color: "#ffffff" },
  cancelButton: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  cancelText: { color: "#6b7280", fontSize: 15, fontWeight: "600" },
});
