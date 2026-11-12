// Unit tests for the permission gate: npm test (node --test, Node 22.6+ type stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeGate,
  decideStartRoute,
  isGateExemptRoute,
  routeAfterPermissions,
  shouldOpenPermissionGate,
  type PermissionReading,
  type PermissionSnapshot,
} from "./permissionGate.ts";

const GRANTED: PermissionReading = { granted: true, canAskAgain: true, undetermined: false };
const NEVER_ASKED: PermissionReading = { granted: false, canAskAgain: true, undetermined: true };
const DENIED: PermissionReading = { granted: false, canAskAgain: true, undetermined: false };
const DENIED_FOR_GOOD: PermissionReading = { granted: false, canAskAgain: false, undetermined: false };

function snapshot(overrides: Partial<PermissionSnapshot> = {}): PermissionSnapshot {
  return {
    platform: "android",
    isExpoGo: false,
    foregroundLocation: { ...GRANTED, precise: true },
    backgroundLocation: GRANTED,
    notifications: GRANTED,
    ...overrides,
  };
}

const statusOf = (gate: ReturnType<typeof computeGate>, key: string) =>
  gate.items.find((item) => item.key === key);

test("all granted: continue, into the app or to login", () => {
  const gate = computeGate(snapshot());
  assert.equal(gate.canContinue, true);
  assert.equal(gate.nextStep, null);
  assert.ok(gate.items.every((item) => item.status === "granted"));
  assert.equal(decideStartRoute({ onboardingDone: true, permissionsOk: true, hasSession: false }), "login");
  assert.equal(decideStartRoute({ onboardingDone: true, permissionsOk: true, hasSession: true }), "app");
});

test("first launch: onboarding first, then permissions", () => {
  assert.equal(decideStartRoute({ onboardingDone: false, permissionsOk: false, hasSession: false }), "onboarding");
  assert.equal(decideStartRoute({ onboardingDone: true, permissionsOk: false, hasSession: false }), "permissions");
  const gate = computeGate(snapshot({ foregroundLocation: { ...NEVER_ASKED, precise: false }, backgroundLocation: null, notifications: NEVER_ASKED }));
  assert.equal(gate.canContinue, false);
  assert.equal(gate.nextStep, "location");
  assert.equal(statusOf(gate, "location")?.status, "ask");
  // Background location only after foreground location.
  assert.equal(statusOf(gate, "backgroundLocation")?.status, "waiting");
  assert.equal(statusOf(gate, "notifications")?.status, "ask");
});

test("background missing on Android 11+: blocked, guided to 'Allow all the time'", () => {
  const gate = computeGate(snapshot({ backgroundLocation: NEVER_ASKED }));
  assert.equal(gate.canContinue, false);
  assert.equal(gate.nextStep, "backgroundLocation");
  assert.deepEqual(statusOf(gate, "backgroundLocation"), {
    key: "backgroundLocation", status: "ask", guide: "androidAllTheTime", required: true,
  });
  // Came back from Settings without choosing it, and Android stops offering it.
  const forGood = computeGate(snapshot({ backgroundLocation: DENIED_FOR_GOOD }));
  assert.equal(statusOf(forGood, "backgroundLocation")?.status, "settings");
  assert.equal(statusOf(forGood, "backgroundLocation")?.guide, "settingsBackground");
});

test("iOS: While Using first, then Always", () => {
  const whileUsing = computeGate(snapshot({ platform: "ios", backgroundLocation: NEVER_ASKED }));
  assert.equal(statusOf(whileUsing, "backgroundLocation")?.guide, "iosAlways");
  assert.equal(statusOf(whileUsing, "backgroundLocation")?.status, "ask");
  const refused = computeGate(snapshot({ platform: "ios", backgroundLocation: DENIED_FOR_GOOD }));
  assert.equal(statusOf(refused, "backgroundLocation")?.status, "settings");
});

test("notifications denied: blocked; denied for good -> Settings guide", () => {
  const denied = computeGate(snapshot({ notifications: DENIED }));
  assert.equal(denied.canContinue, false);
  assert.equal(statusOf(denied, "notifications")?.status, "ask");
  const forGood = computeGate(snapshot({ notifications: DENIED_FOR_GOOD }));
  assert.equal(forGood.canContinue, false);
  assert.deepEqual(statusOf(forGood, "notifications"), {
    key: "notifications", status: "settings", guide: "settingsNotifications", required: true,
  });
});

test("location permanently denied: Settings guide, background waits", () => {
  const gate = computeGate(snapshot({ foregroundLocation: { ...DENIED_FOR_GOOD, precise: false }, backgroundLocation: null }));
  assert.equal(gate.canContinue, false);
  assert.equal(statusOf(gate, "location")?.status, "settings");
  assert.equal(statusOf(gate, "location")?.guide, "settingsLocation");
  assert.equal(statusOf(gate, "backgroundLocation")?.status, "waiting");
});

test("approximate location is not enough", () => {
  const android = computeGate(snapshot({ foregroundLocation: { ...GRANTED, precise: false } }));
  assert.equal(android.canContinue, false);
  assert.equal(statusOf(android, "location")?.status, "ask");
  assert.equal(statusOf(android, "location")?.guide, "preciseLocation");
  const ios = computeGate(snapshot({ platform: "ios", foregroundLocation: { ...GRANTED, precise: false } }));
  assert.equal(statusOf(ios, "location")?.status, "settings");
});

test("revoked after login: the gate opens over the app and returns there", () => {
  const revoked = computeGate(snapshot({ backgroundLocation: DENIED }));
  // App start with a session.
  assert.equal(decideStartRoute({ onboardingDone: true, permissionsOk: revoked.canContinue, hasSession: true }), "permissions");
  // Return to the foreground on the Today tab or the shift screen.
  assert.equal(shouldOpenPermissionGate(["(tabs)"], revoked), true);
  assert.equal(shouldOpenPermissionGate(["shift-active"], revoked), true);
  // Not over the entry screen, the intro pages or itself.
  assert.equal(shouldOpenPermissionGate([], revoked), false);
  assert.equal(shouldOpenPermissionGate(["permissions"], revoked), false);
  assert.equal(shouldOpenPermissionGate(["onboarding"], revoked), false);
  assert.equal(shouldOpenPermissionGate(["(tabs)"], computeGate(snapshot())), false);
  // Fixed: back to where the worker was; the session is kept.
  assert.equal(routeAfterPermissions({ openedOverApp: true, canGoBack: true, hasSession: true }), "back");
  assert.equal(routeAfterPermissions({ openedOverApp: false, canGoBack: false, hasSession: true }), "app");
  assert.equal(routeAfterPermissions({ openedOverApp: false, canGoBack: false, hasSession: false }), "login");
  assert.equal(routeAfterPermissions({ openedOverApp: true, canGoBack: false, hasSession: true }), "app");
});

test("Expo Go: background location not available and not blocking", () => {
  const gate = computeGate(snapshot({ isExpoGo: true, backgroundLocation: null }));
  assert.equal(gate.canContinue, true);
  assert.deepEqual(statusOf(gate, "backgroundLocation"), {
    key: "backgroundLocation", status: "notAvailable", guide: null, required: false,
  });
  // The other two still count in Expo Go.
  assert.equal(computeGate(snapshot({ isExpoGo: true, backgroundLocation: null, notifications: DENIED })).canContinue, false);
});

test("web: no gate", () => {
  const gate = computeGate(snapshot({ platform: "web", foregroundLocation: { ...NEVER_ASKED, precise: false } }));
  assert.equal(gate.canContinue, true);
  assert.equal(isGateExemptRoute([]), true);
});
