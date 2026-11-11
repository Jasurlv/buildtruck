import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

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

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        {/* Taps inside the sheet must not close it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Start lunch</Text>
          <Text style={styles.subtitle}>How long will your lunch be?</Text>

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
                  <Text style={[styles.optionUnit, selected && styles.optionTextSelected]}>min</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.note}>
            A shorter lunch means more paid time. Once you confirm, the lunch cannot be
            shortened or ended early: paid time resumes automatically after {minutes} minutes.
          </Text>

          <TouchableOpacity
            style={[styles.confirmButton, submitting && styles.disabled]}
            onPress={() => onConfirm(minutes)}
            disabled={submitting}
          >
            <Text style={styles.confirmText}>
              {submitting ? "Starting..." : `Start ${minutes}-minute lunch`}
            </Text>
          </TouchableOpacity>

          {canRemind && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onRemind}>
              <Text style={styles.secondaryText}>Remind me in 15 minutes</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.hint}>Lunch can be started until {latestStartLabel}.</Text>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
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
  sheet: { backgroundColor: "#ffffff", borderRadius: 20, padding: 22 },
  title: { fontSize: 20, fontWeight: "bold", color: "#111827" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4, marginBottom: 16 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  option: {
    minWidth: 56,
    paddingVertical: 12,
    paddingHorizontal: 10,
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
