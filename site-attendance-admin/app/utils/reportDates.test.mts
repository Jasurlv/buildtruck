// Default report dates from a server-corrected clock. Run with: npm test
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

type ServerClock = typeof import("./serverClock");
type AppTimezone = typeof import("./appTimezone");

// Node runs these .ts files directly and needs the extension, which TypeScript
// rejects in a static import. The query string gives each test a fresh offset.
let loadCount = 0;
const loadClock = async () =>
  (await import(new URL(`./serverClock.ts?test=${++loadCount}`, import.meta.url).href)) as ServerClock;
const { defaultDateRange } = (await import(
  new URL("./appTimezone.ts", import.meta.url).href
)) as AppTimezone;

const withDate = (header: string | null) =>
  ({ headers: { get: (name: string) => (name === "date" ? header : null) } }) as unknown as Response;

/** Sets the computer clock, then reads a response whose Date header says `serverIso`. */
async function clockAfterResponse(t: TestContext, computerIso: string, serverIso: string) {
  const computerMs = Date.parse(computerIso);
  t.mock.method(Date, "now", () => computerMs);
  const clock = await loadClock();
  clock.recordServerTime(withDate(new Date(serverIso).toUTCString()), computerMs);
  return clock;
}

test("computer clock a day behind: dates follow the server", async (t) => {
  const clock = await clockAfterResponse(t, "2026-11-07T10:00:00Z", "2026-11-08T10:00:00Z");
  assert.deepEqual(defaultDateRange(clock.serverNow()), { start: "2026-10-10", end: "2026-11-08" });
});

test("computer clock two days ahead: dates follow the server", async (t) => {
  const clock = await clockAfterResponse(t, "2026-11-10T10:00:00Z", "2026-11-08T10:00:00Z");
  assert.equal(defaultDateRange(clock.serverNow()).end, "2026-11-08");
});

test("uses the Riga date, not the UTC date", async (t) => {
  // 22:30 UTC on 8 Nov is already 00:30 on 9 Nov in Riga (UTC+2).
  const clock = await clockAfterResponse(t, "2026-11-01T12:00:00Z", "2026-11-08T22:30:00Z");
  assert.equal(defaultDateRange(clock.serverNow()).end, "2026-11-09");
});

test("no readable Date header: falls back to the computer clock", async (t) => {
  const computerMs = Date.parse("2026-11-08T10:00:00Z");
  t.mock.method(Date, "now", () => computerMs);
  const clock = await loadClock();
  clock.recordServerTime(withDate(null), computerMs);
  assert.equal(clock.serverNow(), computerMs);
  assert.equal(defaultDateRange(clock.serverNow()).end, "2026-11-08");
});

test("an invalid Date header is ignored", async (t) => {
  const computerMs = Date.parse("2026-11-08T10:00:00Z");
  t.mock.method(Date, "now", () => computerMs);
  const clock = await loadClock();
  clock.recordServerTime(withDate("not a date"), computerMs);
  assert.equal(clock.serverNow(), computerMs);
});

test("a later response without the header keeps the known offset", async (t) => {
  const clock = await clockAfterResponse(t, "2026-11-07T10:00:00Z", "2026-11-08T10:00:00Z");
  clock.recordServerTime(withDate(null), Date.now());
  assert.equal(defaultDateRange(clock.serverNow()).end, "2026-11-08");
});
