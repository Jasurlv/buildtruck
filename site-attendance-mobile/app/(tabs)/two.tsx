import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Directory, File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { formatDateTime } from "../../i18n/format";
import { SessionExpiredError, workerFetch } from "../../utils/api";
import { ServerError, errorText, readJson, throwServerError } from "../../utils/serverErrors";

type ShiftRecord = {
  id: number;
  full_name: string;
  punch_in_time: string;
  lunch_start_time: string | null;
  lunch_end_time: string | null;
  end_work_time: string;
  total_worked_hours: number | string | null;
  daily_earned: number | string | null;
};

type WorkerData = {
  id: number | string;
};

type ExportAction = "download" | "share" | null;

// Labels are looked up when shown, so they follow the selected language.
const columns = [
  { key: "history.colName", width: 130 },
  { key: "history.colWorkStarted", width: 160 },
  { key: "history.colLunchStarted", width: 150 },
  { key: "history.colLunchEnded", width: 150 },
  { key: "history.colWorkFinished", width: 160 },
  { key: "history.colWorkedHours", width: 120 },
  { key: "history.colEarned", width: 120 },
] as const;

export default function HistoryScreen() {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportAction, setExportAction] = useState<ExportAction>(null);
  const router = useRouter();
  const { t } = useTranslation();

  const loadHistory = useCallback(async (isFocused: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const workerDataString = await SecureStore.getItemAsync("worker_data");
      if (!workerDataString) {
        router.replace("/login");
        return;
      }

      const worker: WorkerData = JSON.parse(workerDataString);
      const response = await workerFetch("/attendance/history");
      const data = await readJson(response);
      if (!response.ok) throwServerError(response, data);

      if (isFocused()) setShifts(data.shifts || []);
    } catch (err) {
      // The central handler already opened the login screen.
      if (err instanceof SessionExpiredError) return;
      console.error(err);
      if (isFocused()) {
        setError(
          err instanceof ServerError
            ? `${i18n.t("history.loadFailed")} ${err.message}`
            : errorText(err),
        );
      }
    } finally {
      if (isFocused()) setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      let isFocused = true;
      void loadHistory(() => isFocused);
      return () => {
        isFocused = false;
      };
    }, [loadHistory]),
  );

  const totalHours = shifts.reduce(
    (total, shift) => total + Number(shift.total_worked_hours || 0),
    0,
  );
  const totalEarned = shifts.reduce(
    (total, shift) => total + Number(shift.daily_earned || 0),
    0,
  );

  const handleExport = async (action: Exclude<ExportAction, null>) => {
    if (shifts.length === 0) return;
    setExportAction(action);
    try {
      const html = buildReportHtml(shifts, totalHours, totalEarned);
      if (Platform.OS === "web") {
        if (action === "share") {
          throw new Error(i18n.t("history.webShareUnavailable"));
        }
        await Print.printAsync({
          html,
          width: 842,
          height: 595,
          orientation: "landscape",
        });
        return;
      }

      const { uri } = await Print.printToFileAsync({
        html,
        width: 842,
        height: 595,
      });

      if (action === "share") {
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error(i18n.t("history.sharingUnavailable"));
        }
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: i18n.t("history.shareDialogTitle"),
          UTI: ".pdf",
        });
      } else {
        const directory = await Directory.pickDirectoryAsync();
        const fileName = createReportFileName();
        const destination = directory.createFile(fileName, "application/pdf");
        await new File(uri).copy(destination, { overwrite: true });
        Alert.alert(i18n.t("history.savedTitle"), i18n.t("history.saved", { folder: directory.name }));
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("cancelled by the user")
      ) {
        return;
      }
      console.error(err);
      Alert.alert(
        action === "download" ? i18n.t("history.saveFailedTitle") : i18n.t("history.shareFailedTitle"),
        err instanceof Error && err.message ? err.message : i18n.t("errors.generic"),
      );
    } finally {
      setExportAction(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t("history.title")}</Text>
            <Text style={styles.subtitle}>{t("history.subtitle")}</Text>
          </View>
          <TouchableOpacity
            onPress={() => void loadHistory(() => true)}
            style={styles.refreshButton}
            accessibilityRole="button"
          >
            <Text style={styles.refreshText}>{t("common.refresh")}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t("history.periods")}</Text>
            <Text style={styles.summaryValue}>{shifts.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t("history.totalHours")}</Text>
            <Text style={styles.summaryValue}>{totalHours.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t("history.totalEarned")}</Text>
            <Text style={[styles.summaryValue, styles.earnedValue]}>
              €{totalEarned.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[
              styles.exportButton,
              styles.downloadButton,
              (shifts.length === 0 || exportAction !== null) &&
                styles.disabledButton,
            ]}
            onPress={() => void handleExport("download")}
            disabled={shifts.length === 0 || exportAction !== null}
            accessibilityRole="button"
          >
            {exportAction === "download" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.exportButtonText}>{t("history.downloadPdf")}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.exportButton,
              styles.shareButton,
              (shifts.length === 0 || exportAction !== null) &&
                styles.disabledButton,
            ]}
            onPress={() => void handleExport("share")}
            disabled={shifts.length === 0 || exportAction !== null}
            accessibilityRole="button"
          >
            {exportAction === "share" ? (
              <ActivityIndicator color="#4f46e5" />
            ) : (
              <Text style={styles.shareButtonText}>{t("history.sharePdf")}</Text>
            )}
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.messageContainer}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.messageText}>{t("history.loading")}</Text>
          </View>
        ) : error ? (
          <View style={styles.messageContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              onPress={() => void loadHistory(() => true)}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>{t("common.tryAgain")}</Text>
            </TouchableOpacity>
          </View>
        ) : shifts.length === 0 ? (
          <View style={styles.messageContainer}>
            <Text style={styles.messageText}>{t("history.empty")}</Text>
          </View>
        ) : (
          <View style={styles.tableCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                <View style={styles.tableRow}>
                  {columns.map((column) => (
                    <Text
                      key={column.key}
                      style={[styles.headerCell, { width: column.width }]}
                    >
                      {t(column.key)}
                    </Text>
                  ))}
                </View>
                {shifts.map((shift) => (
                  <View key={shift.id} style={styles.tableRow}>
                    <Text style={[styles.cell, styles.nameCell, { width: columns[0].width }]}>
                      {shift.full_name}
                    </Text>
                    <Text style={[styles.cell, { width: columns[1].width }]}>
                      {formatDateTime(shift.punch_in_time)}
                    </Text>
                    <Text style={[styles.cell, { width: columns[2].width }]}>
                      {formatDateTime(shift.lunch_start_time)}
                    </Text>
                    <Text style={[styles.cell, { width: columns[3].width }]}>
                      {formatDateTime(shift.lunch_end_time)}
                    </Text>
                    <Text style={[styles.cell, { width: columns[4].width }]}>
                      {formatDateTime(shift.end_work_time)}
                    </Text>
                    <Text style={[styles.cell, { width: columns[5].width }]}>
                      {Number(shift.total_worked_hours || 0).toFixed(2)}
                    </Text>
                    <Text style={[styles.cell, styles.moneyCell, { width: columns[6].width }]}>
                      €{Number(shift.daily_earned || 0).toFixed(2)}
                    </Text>
                  </View>
                ))}
                <View style={[styles.tableRow, styles.totalRow]}>
                  <Text style={[styles.totalCell, { width: columns[0].width + columns[1].width + columns[2].width + columns[3].width + columns[4].width }]}>
                    {t("history.total")}
                  </Text>
                  <Text style={[styles.totalCell, { width: columns[5].width }]}>
                    {totalHours.toFixed(2)}
                  </Text>
                  <Text style={[styles.totalCell, styles.moneyCell, { width: columns[6].width }]}>
                    €{totalEarned.toFixed(2)}
                  </Text>
                </View>
              </View>
            </ScrollView>
            <Text style={styles.tableHint}>{t("history.scrollHint")}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createReportFileName() {
  return `work-report-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportHtml(
  records: ShiftRecord[],
  totalHours: number,
  totalEarned: number,
) {
  const rows = records
    .map(
      (shift) => `
        <tr>
          <td>${escapeHtml(shift.full_name)}</td>
          <td>${escapeHtml(formatDateTime(shift.punch_in_time))}</td>
          <td>${escapeHtml(formatDateTime(shift.lunch_start_time))}</td>
          <td>${escapeHtml(formatDateTime(shift.lunch_end_time))}</td>
          <td>${escapeHtml(formatDateTime(shift.end_work_time))}</td>
          <td>${Number(shift.total_worked_hours || 0).toFixed(2)}</td>
          <td>€${Number(shift.daily_earned || 0).toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  return `
    <!doctype html>
    <html lang="${i18n.language}">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page { size: A4 landscape; margin: 24px; }
          body { font-family: Arial, sans-serif; color: #111827; }
          h1 { margin: 0 0 6px; font-size: 22px; }
          p { margin: 0 0 18px; color: #4b5563; }
          table { border-collapse: collapse; width: 100%; font-size: 10px; }
          th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
          th { background: #eef2ff; }
          tfoot td { background: #f3f4f6; font-weight: bold; }
          tr { page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(i18n.t("history.reportTitle"))}</h1>
        <p>${escapeHtml(i18n.t("history.generated", { date: formatDateTime(new Date().toISOString()) }))}</p>
        <table>
          <thead>
            <tr>
              ${columns.map((column) => `<th>${escapeHtml(i18n.t(column.key))}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="5">${escapeHtml(i18n.t("history.total"))}</td>
              <td>${totalHours.toFixed(2)}</td>
              <td>€${totalEarned.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f9fafb" },
  container: { padding: 18, paddingBottom: 32 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: { fontSize: 24, fontWeight: "bold", color: "#111827" },
  subtitle: { marginTop: 4, color: "#6b7280", fontSize: 13 },
  refreshButton: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "#e0e7ff",
    borderRadius: 10,
  },
  refreshText: { color: "#4338ca", fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  summaryCard: {
    flex: 1,
    minHeight: 76,
    padding: 11,
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  summaryLabel: { fontSize: 11, color: "#6b7280", marginBottom: 5 },
  summaryValue: { fontSize: 17, fontWeight: "bold", color: "#111827" },
  earnedValue: { color: "#059669" },
  exportRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  exportButton: {
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  downloadButton: { backgroundColor: "#4f46e5" },
  shareButton: { backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#c7d2fe" },
  disabledButton: { opacity: 0.5 },
  exportButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  shareButtonText: { color: "#4338ca", fontWeight: "700", fontSize: 14 },
  messageContainer: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 20,
  },
  messageText: { color: "#6b7280", marginTop: 10, textAlign: "center" },
  errorText: { color: "#b91c1c", textAlign: "center" },
  retryButton: {
    marginTop: 14,
    backgroundColor: "#4f46e5",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: { color: "#fff", fontWeight: "700" },
  tableCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 10,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e5e7eb" },
  headerCell: {
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    fontSize: 12,
    fontWeight: "700",
  },
  cell: {
    paddingHorizontal: 8,
    paddingVertical: 12,
    color: "#374151",
    fontSize: 12,
  },
  nameCell: { fontWeight: "600", color: "#111827" },
  moneyCell: { fontWeight: "700", color: "#047857" },
  totalRow: { backgroundColor: "#f3f4f6", borderBottomWidth: 0 },
  totalCell: {
    paddingHorizontal: 8,
    paddingVertical: 13,
    fontWeight: "700",
    color: "#111827",
  },
  tableHint: { color: "#9ca3af", fontSize: 11, marginTop: 9 },
});
