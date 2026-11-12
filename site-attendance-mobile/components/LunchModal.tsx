import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { minutesText } from "../i18n/format";

type LunchModalProps = {
  options: number[];
  defaultMinutes: number;
  latestStartLabel: string;
  /** Offer "Remind me in 15 minutes" (only while the reminder would land in the window). */
  canRemind: boolean;
  submitting: boolean;
  onConfirm: (minutes: number) => void;
  onRemind: () => void;
  onClose: () => void;
};

// Mount it only while it should be open, so it always starts at the default length.
// It can always be dismissed (Cancel, tapping outside, Android back), even while
// a request is in flight.
export default function LunchModal({
  options,
  defaultMinutes,
  latestStartLabel,
  canRemind,
  submitting,
  onConfirm,
  onRemind,
  onClose,
}: LunchModalProps) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const { t } = useTranslation();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area closes it; it sits behind the sheet, so taps
            inside the sheet never reach it. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        {/* The sheet scrolls when it is taller than the screen (small phones). */}
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} bounces={false}>
            <Text style={styles.title}>{t("lunchModal.title")}</Text>
            <Text style={styles.subtitle}>{t("lunchModal.question")}</Text>

            <View style={styles.options}>
              {options.map((option) => {
                const selected = option === minutes;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => setMinutes(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {option}
                    </Text>
                    <Text style={[styles.optionUnit, selected && styles.optionTextSelected]}>
                      {t("lunchModal.minUnit")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.note}>
              {t("lunchModal.note", { duration: minutesText(minutes) })}
            </Text>

            <TouchableOpacity
              style={[styles.confirmButton, submitting && styles.disabled]}
              onPress={() => onConfirm(minutes)}
              disabled={submitting}
            >
              <Text style={styles.confirmText}>
                {submitting ? t("lunchModal.starting") : t("lunchModal.confirm", { minutes })}
              </Text>
            </TouchableOpacity>

            {canRemind && (
              <TouchableOpacity style={styles.secondaryButton} onPress={onRemind}>
                <Text style={styles.secondaryText}>{t("lunchModal.remind")}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.hint}>{t("lunchModal.hint", { time: latestStartLabel })}</Text>

            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: { backgroundColor: "#ffffff", borderRadius: 20, maxHeight: "100%", overflow: "hidden" },
  sheetContent: { padding: 22 },
  title: { fontSize: 20, fontWeight: "bold", color: "#111827" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4, marginBottom: 16 },
  // Four per row on any phone width (7 options -> 4 + 3), wrapping, never clipped.
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  option: {
    width: "22%",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  optionSelected: { backgroundColor: "#1F2937", borderColor: "#1F2937" },
  optionText: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  optionUnit: { fontSize: 11, color: "#6b7280" },
  optionTextSelected: { color: "#ffffff" },
  note: {
    fontSize: 13,
    color: "#92400e",
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    padding: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  confirmButton: {
    backgroundColor: "#F5A524",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  disabled: { opacity: 0.55 },
  confirmText: { color: "#1F2937", fontSize: 16, fontWeight: "bold" },
  secondaryButton: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  secondaryText: { color: "#374151", fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 10 },
  cancelButton: { marginTop: 6, paddingVertical: 12, alignItems: "center" },
  cancelText: { color: "#6b7280", fontSize: 15, fontWeight: "600" },
});
