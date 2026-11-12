import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  AppState,
  Platform,
  SafeAreaView,
  ScrollView,
} from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import LunchModal from "../components/LunchModal";
import i18n from "../i18n";
import { formatDuration, formatLongDate, minutesText } from "../i18n/format";
import { SessionExpiredError, workerFetch } from "../utils/api";
import { errorText, readJson, throwServerError } from "../utils/serverErrors";
import { serverNow } from "../utils/serverClock";
import { ALERTS_CHANNEL_ID, ensureNotificationChannel } from "../utils/notificationChannel";
import {
  computeShiftStatus,
  formatClock,
  formatCountdown,
  lunchAvailability,
  lunchOptions,
  startedOnEarlierDay,
  type ShiftRules,
  type ShiftTimestamps,
} from "../utils/shiftTime";
import {
  startBackgroundGeofenceMonitoring,
  stopBackgroundGeofenceMonitoring,
  type BackgroundStartResult,
} from "../utils/backgroundGeofence";

const LUNCH_REMINDER_MS = 15 * 60 * 1000;

// "Remind me in 15 minutes" is client-only. Kept outside the component so it
// survives leaving and reopening this screen.
let lunchReminder: { shiftId: number | undefined; atMs: number; notificationId: string | null } | null = null;

// The "background location unavailable" notice is shown once per app session,
// not every time this screen opens.
let backgroundNoticeShown = false;

const BACKGROUND_NOTICES = {
  "expo-go": "shift.backgroundExpoGo",
  "permission-denied": "shift.backgroundPermissionDenied",
  failed: "shift.backgroundFailed",
} as const satisfies Partial<Record<BackgroundStartResult, string>>;

function showBackgroundNoticeOnce(result: BackgroundStartResult): void {
  const key = BACKGROUND_NOTICES[result as keyof typeof BACKGROUND_NOTICES];
  if (!key || backgroundNoticeShown) return;
  backgroundNoticeShown = true;
  Alert.alert(i18n.t("shift.backgroundUnavailableTitle"), i18n.t(key));
}

async function clearLunchReminder(): Promise<void> {
  const notificationId = lunchReminder?.notificationId;
  lunchReminder = null;
  if (notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
  }
}

/** The server's "HH:MM" label (sites' timezone), or the phone's rendering as a fallback. */
function label(serverLabel: string | null | undefined, fallback: Date | null): string {
  return serverLabel ?? (fallback ? formatClock(fallback) : "–");
}

export default function ActiveShiftScreen() {
  const [worker, setWorker] = useState<any>(null);
  const [isInsideGeofence, setIsInsideGeofence] = useState(true);
  const [distance, setDistance] = useState(0);

  // The shift and rules from the server; every displayed time is derived from
  // them and `now` (server time), never counted up locally.
  const [shift, setShift] = useState<ShiftTimestamps | null>(null);
  const [rules, setRules] = useState<ShiftRules | null>(null);
  const [now, setNow] = useState(() => serverNow());
  const [finished, setFinished] = useState<FinishedShift | null>(null);
  const [isLunchModalOpen, setIsLunchModalOpen] = useState(false);
  const [isLunchSubmitting, setIsLunchSubmitting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isBreakSubmitting, setIsBreakSubmitting] = useState(false);
  // Today's date at the sites (server), to spot a shift left open from an earlier day.
  const [todayLocal, setTodayLocal] = useState<string | null>(null);

  const router = useRouter();
  const { t } = useTranslation();
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const geofenceInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted = useRef(false);
  // Server time at which the lunch ends; geofence checks pause until then.
  const lunchEndsAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const geofenceStarted = useRef(false);
  const outsideAlertShown = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      locationSubscription.current?.remove();
      locationSubscription.current = null;
      if (geofenceInterval.current) clearInterval(geofenceInterval.current);
      geofenceInterval.current = null;
    };
  }, []);

  const isOnLunchNow = () =>
    lunchEndsAtRef.current !== null && serverNow() < lunchEndsAtRef.current;

  const applyShift = (
    activeShift: ShiftTimestamps,
    nextRules?: ShiftRules | null,
    nextToday?: string | null,
  ) => {
    const lunchEnd = activeShift.lunch_planned_end_at ?? null;
    lunchEndsAtRef.current = lunchEnd ? Date.parse(lunchEnd) : null;
    setShift(activeShift);
    if (nextRules) setRules(nextRules);
    if (nextToday) setTodayLocal(nextToday);
    setNow(serverNow());
    // Read by the background geofence task, which skips checks until this time.
    void SecureStore.setItemAsync("shift_lunch_paused", lunchEnd ?? "false");
  };

  const loadShift = useCallback(async () => {
    try {
      const workerDataString = await SecureStore.getItemAsync("worker_data");
      if (!workerDataString) {
        router.replace("/login");
        return;
      }
      const workerParsed = JSON.parse(workerDataString);

      const activeResponse = await workerFetch("/attendance/active");
      if (!activeResponse.ok) {
        throw new Error("Failed to load active shift");
      }
      const {
        activeShift,
        rules: activeRules,
        today_local: activeToday,
      } = await activeResponse.json();
      if (!isMounted.current || finishedRef.current) return;
      if (!activeShift) {
        // Ended elsewhere (or never started): nothing to show here.
        router.replace("/(tabs)");
        return;
      }

      setWorker(workerParsed);
      applyShift(activeShift, activeRules, activeToday);
      if (!geofenceStarted.current) {
        geofenceStarted.current = true;
        void startGeofenceTracking(workerParsed);
      }
    } catch (err) {
      // The central handler already opened the login screen.
      if (err instanceof SessionExpiredError) return;
      console.error(err);
    }
  }, [router]);

  // Re-read the shift from the server on every focus and whenever the app comes
  // back to the foreground (it may have been closed for hours).
  useFocusEffect(
    useCallback(() => {
      void loadShift();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          setNow(serverNow());
          void loadShift();
        }
      });
      return () => subscription.remove();
    }, [loadShift]),
  );

  // While focused and a shift is running, tick every second: the countdowns need
  // it, and the screen switches phase (changing -> working, lunch -> working)
  // exactly when server time reaches the stored instant.
  const isShiftRunning = shift !== null && finished === null;
  useFocusEffect(
    useCallback(() => {
      if (!isShiftRunning) return;
      setNow(serverNow());
      const timer = setInterval(() => setNow(serverNow()), 1000);
      return () => clearInterval(timer);
    }, [isShiftRunning]),
  );

  const startGeofenceTracking = async (workerData: any) => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(i18n.t("shift.permissionDeniedTitle"), i18n.t("shift.permissionDenied"));
      return;
    }

    if (!isMounted.current) return;
    // Never throws; in Expo Go it does not try to start background location.
    const backgroundResult = await startBackgroundGeofenceMonitoring();
    if (!isMounted.current) return;
    showBackgroundNoticeOnce(backgroundResult);
    checkWorkerPosition(workerData);

    geofenceInterval.current = setInterval(
      () => {
        checkWorkerPosition(workerData);
      },
      5 * 60 * 1000,
    );

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
      },
      (loc) => {
        validateGeofence(loc.coords.latitude, loc.coords.longitude, workerData);
      },
    );
    if (isMounted.current) {
      locationSubscription.current = sub;
    } else {
      sub.remove();
    }
  };

  const checkWorkerPosition = async (workerData: any) => {
    if (!isMounted.current || isOnLunchNow()) return;

    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      validateGeofence(loc.coords.latitude, loc.coords.longitude, workerData);
    } catch (err) {
      console.log("Location check error:", err);
    }
  };

  const validateGeofence = (lat: number, lon: number, workerData: any) => {
    if (!isMounted.current || isOnLunchNow()) return;

    if (!workerData.latitude || !workerData.longitude) return;

    const siteLat = parseFloat(workerData.latitude);
    const siteLng = parseFloat(workerData.longitude);
    const dist = calculateDistance(lat, lon, siteLat, siteLng);
    setDistance(Math.round(dist));

    const allowedRadius = (workerData.radius_meters || 30) + 70;
    const inside = dist <= allowedRadius;
    setIsInsideGeofence(inside);

    if (!inside && !outsideAlertShown.current) {
      outsideAlertShown.current = true;
      Alert.alert(
        i18n.t("shift.outsideTitle"),
        i18n.t("shift.outsideMessage", { distance: Math.round(dist) }),
      );
    } else if (inside) {
      outsideAlertShown.current = false;
    }
  };

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const status = shift ? computeShiftStatus(shift, now) : null;
  const phase = status?.phase ?? null;
  const onLunch = phase === "lunch";
  const hasTakenLunch = status?.hasTakenLunch ?? false;
  const availability = rules ? lunchAvailability(rules, now) : null;
  const canStartLunch = phase === "working" && !hasTakenLunch && availability === "open";
  // The reminder must still land inside the lunch window.
  const canRemind =
    canStartLunch && rules !== null && now + LUNCH_REMINDER_MS < Date.parse(rules.lunch_window_closes_at);
  const hourlyRate = parseFloat(worker?.hourly_rate || "6.25");
  const estimatedEarnings = status
    ? ((hourlyRate * status.workedMs) / 3_600_000).toFixed(2)
    : null;
  const times = shift?.local_times ?? {};

  // A due reminder reopens the lunch dialog if lunch can still be started.
  useEffect(() => {
    if (!lunchReminder || now < lunchReminder.atMs) return;
    const forThisShift = lunchReminder.shiftId === shift?.id;
    lunchReminder = null; // the notification itself has already fired
    if (forThisShift && canStartLunch) setIsLunchModalOpen(true);
  }, [now, shift?.id, canStartLunch]);

  const handleRemindLater = async () => {
    setIsLunchModalOpen(false);
    await clearLunchReminder();
    let notificationId: string | null = null;
    try {
      await ensureNotificationChannel();
      notificationId = await Notifications.scheduleNotificationAsync({
        // Written now, in the language selected now.
        content: {
          title: t("shift.lunchReminderTitle"),
          body: t("shift.lunchReminderBody", { time: rules?.lunch_latest_start_local ?? "–" }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: LUNCH_REMINDER_MS / 1000,
          ...(Platform.OS === "android" ? { channelId: ALERTS_CHANNEL_ID } : {}),
        },
      });
    } catch (err) {
      // The in-app reminder below still works while the app is open.
      console.error("Unable to schedule the lunch reminder notification:", err);
    }
    lunchReminder = { shiftId: shift?.id, atMs: serverNow() + LUNCH_REMINDER_MS, notificationId };
  };

  const handleStartLunch = async (minutes: number) => {
    setIsLunchSubmitting(true);
    try {
      const response = await workerFetch("/attendance/lunch", {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        void loadShift(); // the server's view of the shift wins
        throwServerError(response, data, rules);
      }
      await clearLunchReminder();
      setIsLunchModalOpen(false);
      applyShift(data.log, data.rules, data.today_local);
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setIsLunchModalOpen(false);
      Alert.alert(t("shift.lunchFailedTitle"), errorText(err));
    } finally {
      setIsLunchSubmitting(false);
    }
  };

  // One button: "Take break" while working, "Resume work" while on a break. The
  // server records the break; the screen follows its answer.
  const handleToggleBreak = async () => {
    const resuming = phase === "break";
    const failureTitle = resuming ? t("shift.breakEndFailed") : t("shift.breakStartFailed");
    setIsBreakSubmitting(true);
    try {
      const response = await workerFetch(`/attendance/break/${resuming ? "end" : "start"}`, {
        method: "POST",
      });
      const data = await readJson(response);
      if (!response.ok) {
        void loadShift(); // e.g. already changed on another phone: the server's view wins
        throwServerError(response, data, rules);
      }
      applyShift(data.log, data.rules, data.today_local);
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      Alert.alert(failureTitle, errorText(err));
    } finally {
      setIsBreakSubmitting(false);
    }
  };

  const handleFinishWork = () => {
    Alert.alert(t("shift.finishConfirmTitle"), t("shift.finishConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("shift.finish"),
        onPress: async () => {
          if (!worker?.id) {
            Alert.alert(t("shift.finishFailedTitle"), t("shift.workerMissing"));
            return;
          }
          setIsFinishing(true);
          try {
            const res = await workerFetch("/attendance/end-work", {
              method: "POST",
            });
            const data = await readJson(res);
            if (res.status === 404 && data?.code === "NO_ACTIVE_SHIFT") {
              // Closed meanwhile (e.g. automatically after the maximum length):
              // reloading returns to the home screen, which explains what happened.
              void loadShift();
              return;
            }
            if (!res.ok) throwServerError(res, data, rules);

            locationSubscription.current?.remove();
            locationSubscription.current = null;
            if (geofenceInterval.current) {
              clearInterval(geofenceInterval.current);
            }
            geofenceInterval.current = null;
            finishedRef.current = true;
            setIsLunchModalOpen(false);
            setFinished({
              workedHours: Number(data.summary?.worked_hours ?? 0),
              earned: Number(data.summary?.earned_today ?? 0),
              lunchMinutes: Number(data.summary?.lunch_deducted_minutes ?? 0),
              lunchType: data.summary?.lunch_deduction_type ?? "none",
              breakMinutes: Number(data.summary?.break_minutes ?? 0),
              log: data.log ?? {},
            });
            await clearLunchReminder();
            await SecureStore.deleteItemAsync("shift_lunch_paused");
            await SecureStore.deleteItemAsync("geofence_last_result");
            try {
              await stopBackgroundGeofenceMonitoring();
            } catch (trackingError) {
              console.error(
                "Work was completed, but background tracking did not stop:",
                trackingError,
              );
              Alert.alert(t("shift.finishedTitle"), t("shift.trackingNotStopped"));
            }
          } catch (err) {
            if (err instanceof SessionExpiredError) return;
            Alert.alert(t("shift.finishFailedTitle"), errorText(err));
          } finally {
            setIsFinishing(false);
          }
        },
      },
    ]);
  };

  if (finished) {
    return <FinishedSummary finished={finished} onDone={() => router.replace("/(tabs)")} />;
  }

  const paidStartLabel = label(times.paid_start, status?.paidStartAt ?? null);
  const lunchEndLabel = label(times.lunch_planned_end, status?.lunchPlannedEndAt ?? null);

  // Changing clothes: "N minutes" is the server's allowance, unless the worker
  // arrived early and the wait is longer; then it is the time left until paid start.
  const isChanging = phase === "changing" && status !== null;
  const allowanceMinutes = rules?.changing_allowance_minutes ?? null;
  const arrivalMs = Date.parse(shift?.arrival_at ?? shift?.punch_in_time ?? "");
  const isLongWait =
    isChanging &&
    (allowanceMinutes === null ||
      !Number.isFinite(arrivalMs) ||
      status.paidStartAt.getTime() - arrivalMs > allowanceMinutes * 60_000);
  const minutesLeft = isChanging ? Math.max(1, Math.ceil(status.msUntilPaidStart / 60_000)) : 0;
  const changingMinutes = isLongWait ? minutesLeft : (allowanceMinutes ?? 0);

  // A running shift from an earlier day (sites' calendar, server time): probably a
  // missed Finish tap, so the running estimate would be misleading.
  const isStaleShift = startedOnEarlierDay(shift?.work_date, todayLocal);
  const onBreak = phase === "break";
  // Breaks are possible while working, never while changing clothes or on lunch.
  const showBreakButton = phase === "working" || onBreak;
  const breakMinutesSoFar = status ? Math.floor(status.breakMs / 60_000) : 0;

  let lunchButtonText = t("shift.startLunch");
  if (availability === "before") {
    lunchButtonText = t("shift.lunchAvailableFrom", { time: rules?.lunch_opens_local ?? "–" });
  } else if (availability === "closed") {
    lunchButtonText = t("shift.lunchWindowClosed", {
      duration: minutesText(rules?.lunch_default_deduction_minutes ?? 0),
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Top Header with Back Button */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace("/(tabs)")}
          >
            <Text style={styles.backButtonText}>{t("shift.backHome")}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("shift.title")}</Text>
        </View>

        {isStaleShift && shift?.work_date && (
          <View style={styles.staleBanner} accessibilityRole="alert">
            <Text style={styles.staleBannerText}>
              ⚠️ {t("shift.staleWarning", { date: formatLongDate(shift.work_date) })}
            </Text>
          </View>
        )}

        {isChanging && (
          <View style={styles.changingIntro}>
            <Text style={styles.changingHeading} accessibilityRole="header">
              {isLongWait
                ? t("shift.changingLong", { duration: minutesText(changingMinutes) })
                : t("shift.changingShort", { duration: minutesText(changingMinutes) })}
            </Text>
            <Text style={styles.changingText}>
              {isLongWait
                ? t("shift.changingLongText", { time: paidStartLabel })
                : t("shift.changingShortText")}
            </Text>
          </View>
        )}

        {/* Location Tracking Banner */}
        <View style={[styles.trackingBanner, onLunch && styles.pausedBanner]}>
          <Text style={[styles.trackingText, onLunch && styles.pausedText]}>
            {onLunch ? t("shift.trackingLunch") : t("shift.trackingOn")}
          </Text>
          <Text style={styles.subTrackingText}>
            {onLunch
              ? t("shift.freeToLeave")
              : isInsideGeofence
                ? t("shift.insideZone")
                : t("shift.outsideZone", { distance })}
          </Text>
        </View>

        {/* Time Block: derived from the server timestamps and server time */}
        <View style={styles.timeCard}>
          {!status ? (
            <Text style={styles.timeCardHeader}>{t("shift.loading")}</Text>
          ) : phase === "changing" ? (
            <>
              <Text style={styles.timeCardHeader}>{t("shift.changingClothes")}</Text>
              <Text style={styles.timeCardElapsed}>
                {formatCountdown(status.msUntilPaidStart)}
              </Text>
              <Text style={styles.statusLabel}>
                {t("shift.paidStartsAt", { time: paidStartLabel })}
              </Text>
            </>
          ) : phase === "lunch" ? (
            <>
              <Text style={styles.timeCardHeader}>
                {t("shift.onLunchUntil", { time: lunchEndLabel })}
              </Text>
              <Text style={styles.timeCardElapsed}>
                {formatCountdown(status.msUntilLunchEnd)}
              </Text>
              <Text style={styles.statusLabel}>{t("shift.paidResumes")}</Text>
            </>
          ) : phase === "break" ? (
            <>
              <Text style={styles.timeCardHeader}>
                {t("shift.onBreakSince", {
                  time: label(shift?.open_break?.local_started, status.breakStartedAt),
                })}
              </Text>
              <Text style={styles.timeCardElapsed}>
                {formatCountdown(status.breakElapsedMs)}
              </Text>
              <Text style={styles.statusLabel}>⏸️ {t("shift.breakPaused")}</Text>
              <Text style={styles.pausedSubLabel}>
                {t("shift.paidSoFar", { duration: formatDuration(status.workedMs) })}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.timeCardHeader}>
                {t("shift.paidSince", { time: paidStartLabel })}
              </Text>
              <Text style={styles.timeCardElapsed}>
                {formatDuration(status.workedMs)}
              </Text>
              <Text style={styles.statusLabel}>{t("shift.working")}</Text>
            </>
          )}
        </View>

        {/* Estimated Earnings Block */}
        {phase !== "changing" && (
          <View style={styles.earningsCard}>
            <Text style={styles.earningsTitle}>{t("shift.earnedSoFar")}</Text>
            <Text style={styles.earningsAmount}>
              {isStaleShift
                ? "-"
                : estimatedEarnings !== null
                  ? `€${estimatedEarnings}`
                  : "–"}
            </Text>
            <Text style={styles.rateSubtext}>
              {t("shift.rateNote", { rate: hourlyRate })}
            </Text>
          </View>
        )}

        {/* Lunch: one per shift, chosen length, no early end */}
        {phase === "working" && rules && !hasTakenLunch && availability !== "closed" && (
          <View style={styles.reminderCard}>
            <Text style={styles.reminderTitle}>{t("shift.lunchTitle")}</Text>
            <Text style={styles.reminderText}>
              {t("shift.lunchInfo", {
                from: rules.lunch_opens_local,
                to: rules.lunch_latest_start_local,
                min: rules.lunch_min_minutes,
                max: rules.lunch_max_minutes,
              })}
            </Text>
          </View>
        )}
        {phase === "working" && hasTakenLunch && (
          <Text style={styles.lunchDoneText}>
            {t("shift.lunchTaken", { minutes: shift?.lunch_minutes ?? "?", time: lunchEndLabel })}
          </Text>
        )}
        {phase === "working" && breakMinutesSoFar > 0 && (
          <Text style={styles.lunchDoneText}>
            {t("shift.breaksThisShift", { duration: minutesText(breakMinutesSoFar) })}
          </Text>
        )}

        {/* Control Buttons */}
        <View style={styles.actionsContainer}>
          {phase === "working" && !hasTakenLunch && (
            <TouchableOpacity
              style={[styles.lunchButton, !canStartLunch && styles.disabledButton]}
              onPress={() => setIsLunchModalOpen(true)}
              disabled={!canStartLunch}
            >
              <Text style={styles.lunchButtonText}>{lunchButtonText}</Text>
            </TouchableOpacity>
          )}

          {showBreakButton && (
            <TouchableOpacity
              style={[
                styles.breakButton,
                onBreak && styles.resumeButton,
                isBreakSubmitting && styles.disabledButton,
              ]}
              onPress={() => void handleToggleBreak()}
              disabled={isBreakSubmitting}
              accessibilityState={{ busy: isBreakSubmitting }}
            >
              <Text style={styles.breakButtonText}>
                {isBreakSubmitting
                  ? onBreak
                    ? t("shift.resumingWork")
                    : t("shift.startingBreak")
                  : onBreak
                    ? `▶️ ${t("shift.resumeWork")}`
                    : `☕ ${t("shift.takeBreak")}`}
              </Text>
            </TouchableOpacity>
          )}

          {/* Hidden until the shift is loaded and paid time has started; the
              1-second tick switches the phase without a tap. */}
          {shift !== null && phase !== "changing" && (
            <TouchableOpacity
              style={styles.finishButton}
              onPress={handleFinishWork}
              disabled={isFinishing}
            >
              <Text style={styles.finishButtonText}>
                {isFinishing ? t("shift.finishing") : t("shift.finishWork")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {isLunchModalOpen && canStartLunch && rules && (
        <LunchModal
          options={lunchOptions(rules)}
          defaultMinutes={Math.max(rules.lunch_min_minutes, Math.min(60, rules.lunch_max_minutes))}
          latestStartLabel={rules.lunch_latest_start_local}
          canRemind={canRemind}
          submitting={isLunchSubmitting}
          onConfirm={(minutes) => void handleStartLunch(minutes)}
          onRemind={() => void handleRemindLater()}
          onClose={() => setIsLunchModalOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

type FinishedShift = {
  workedHours: number;
  earned: number;
  lunchMinutes: number;
  lunchType: "recorded" | "elapsed" | "default" | "none";
  breakMinutes: number;
  log: ShiftTimestamps;
};

function lunchNote({ lunchMinutes, lunchType }: FinishedShift): string {
  const duration = minutesText(Math.round(lunchMinutes));
  switch (lunchType) {
    case "default":
      return i18n.t("summary.lunchDefault", { duration });
    case "elapsed":
      return i18n.t("summary.lunchElapsed", { duration });
    case "recorded":
      return i18n.t("summary.lunchRecorded", { duration });
    default:
      return i18n.t("summary.lunchNone");
  }
}

// Shows the times, hours and pay exactly as calculated and stored by the server.
function FinishedSummary({
  finished,
  onDone,
}: {
  finished: FinishedShift;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { log } = finished;
  const times = log.local_times ?? {};
  const at = (value: string | null | undefined) => (value ? new Date(value) : null);
  const rows: [string, string][] = [
    [t("summary.arrival"), label(times.arrival, at(log.arrival_at ?? log.punch_in_time))],
    [t("summary.paidStart"), label(times.paid_start, at(log.paid_start_at))],
    [t("summary.finished"), label(times.finish, at(log.end_work_time))],
    [t("summary.lunch"), t("units.minutesShort", { count: finished.lunchMinutes })],
    [t("summary.breaks"), t("units.minutesShort", { count: Math.round(finished.breakMinutes) })],
    [t("summary.paidHours"), t("units.hoursShort", { value: finished.workedHours.toFixed(2) })],
  ];
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.summaryTitle}>{t("summary.title")}</Text>

        <View style={styles.timeCard}>
          <Text style={styles.timeCardHeader}>{t("summary.paidHours")}</Text>
          <Text style={styles.timeCardElapsed}>
            {formatDuration(finished.workedHours * 3_600_000)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          {rows.map(([name, value]) => (
            <View key={name} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{name}</Text>
              <Text style={styles.summaryValue}>{value}</Text>
            </View>
          ))}
          <Text style={styles.rateSubtext}>{lunchNote(finished)}</Text>
        </View>

        <View style={styles.earningsCard}>
          <Text style={styles.earningsTitle}>{t("summary.earnedToday")}</Text>
          <Text style={styles.earningsAmount}>€{finished.earned.toFixed(2)}</Text>
        </View>

        <TouchableOpacity style={styles.doneButton} onPress={onDone}>
          <Text style={styles.doneButtonText}>{t("summary.done")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f9fafb" },
  container: { padding: 20, paddingBottom: 40 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    justifyContent: "space-between",
  },
  backButton: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backButtonText: { color: "#374151", fontWeight: "bold", fontSize: 13 },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  changingIntro: { marginBottom: 16 },
  changingHeading: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 6,
  },
  changingText: { fontSize: 15, color: "#4b5563", lineHeight: 21 },
  trackingBanner: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#a7f3d0",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    alignItems: "center",
  },
  pausedBanner: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  trackingText: { color: "#047857", fontWeight: "bold", fontSize: 14 },
  pausedText: { color: "#b45309" },
  subTrackingText: { color: "#065f46", fontSize: 12, marginTop: 4 },
  timeCard: {
    backgroundColor: "#1F2937",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
    elevation: 4,
  },
  timeCardHeader: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 8,
    fontWeight: "500",
  },
  timeCardElapsed: {
    color: "#ffffff",
    fontSize: 42,
    fontWeight: "bold",
  },
  statusLabel: {
    color: "#F5A524",
    fontSize: 13,
    marginTop: 8,
    fontWeight: "600",
  },
  earningsCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  earningsTitle: { fontSize: 14, color: "#6b7280", marginBottom: 4 },
  earningsAmount: { fontSize: 32, fontWeight: "bold", color: "#059669" },
  rateSubtext: { fontSize: 12, color: "#9ca3af", marginTop: 4 },
  reminderCard: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  reminderTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#b45309",
    marginBottom: 4,
  },
  reminderText: { fontSize: 13, color: "#92400e", lineHeight: 18 },
  actionsContainer: { gap: 12 },
  lunchButton: {
    backgroundColor: "#F5A524",
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: "center",
    elevation: 2,
  },
  disabledButton: { opacity: 0.55 },
  lunchButtonText: {
    color: "#1F2937",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  lunchDoneText: {
    color: "#6b7280",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
  },
  breakButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: "center",
    elevation: 2,
  },
  resumeButton: { backgroundColor: "#059669" },
  breakButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
  pausedSubLabel: { color: "#d1d5db", fontSize: 13, marginTop: 4 },
  staleBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  staleBannerText: { color: "#991b1b", fontSize: 15, fontWeight: "600", lineHeight: 21 },
  finishButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    elevation: 2,
  },
  finishButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
  summaryTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 20,
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  summaryLabel: { fontSize: 15, color: "#6b7280" },
  summaryValue: { fontSize: 15, fontWeight: "600", color: "#111827" },
  summarySubtitle: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  doneButton: {
    backgroundColor: "#4f46e5",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 4,
  },
  doneButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
});
