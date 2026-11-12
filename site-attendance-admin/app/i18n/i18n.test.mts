// Dashboard translations and API error texts. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Json = string | { [key: string]: Json };
type ApiErrors = typeof import("./apiErrors");
type AppTimezone = typeof import("../utils/appTimezone");

// Node runs these .ts files directly and needs the extension (see reportDates.test.mts).
const { apiErrorText } = (await import(new URL("./apiErrors.ts", import.meta.url).href)) as ApiErrors;
const { formatAppDateTime, formatWorkDate } = (await import(
  new URL("../utils/appTimezone.ts", import.meta.url).href
)) as AppTimezone;

const load = (language: string) =>
  JSON.parse(readFileSync(new URL(`./${language}.json`, import.meta.url), "utf8")) as Json;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value: Json, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof value === "string") out.set(prefix, value);
  else for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{\{\s*(\w+)/g)].map((match) => match[1]))].sort().join(",");

const english = flatten(load("en"));
const russian = flatten(load("ru"));
const pluralBases = new Set([...english.keys()].filter((key) => PLURAL_SUFFIX.test(key)).map((key) => key.replace(PLURAL_SUFFIX, "")));

test("ru: has every English key", () => {
  const missing = [...english.keys()].filter((key) => !PLURAL_SUFFIX.test(key) && !russian.has(key));
  assert.deepEqual(missing, [], "ru.json is missing keys");
});

test("ru: has every Russian plural form (one, few, many, other)", () => {
  const categories = new Intl.PluralRules("ru").resolvedOptions().pluralCategories;
  const missing = [...pluralBases].flatMap((base) =>
    categories.filter((category) => !russian.has(`${base}_${category}`)).map((category) => `${base}_${category}`),
  );
  assert.deepEqual(missing, [], "ru.json is missing plural forms");
});

test("ru: no stale keys, same {{placeholders}}, no empty text", () => {
  const problems: string[] = [];
  for (const [key, text] of russian) {
    const base = key.replace(PLURAL_SUFFIX, "");
    const source = english.get(key) ?? (pluralBases.has(base) ? english.get(`${base}_other`) : undefined);
    if (source === undefined) problems.push(`${key}: not in en.json`);
    else if (placeholders(source) !== placeholders(text)) problems.push(`${key}: placeholders differ`);
    if (!text.trim()) problems.push(`${key}: empty`);
  }
  assert.deepEqual(problems, []);
});

test("every error key the API mapping uses exists in English", () => {
  const samples: [number, unknown][] = [
    [400, { code: "INVALID_RADIUS", error: "x" }],
    [400, { code: "INVALID_BUILDING", error: "x" }],
    [400, { error: "This username is already taken by another worker." }],
    [409, { error: "A building site with this name already exists." }],
    [400, { error: "Full name, username, a valid hourly rate and a start time (HH:MM) are required (password at most 72 characters)." }],
    [400, { error: "Too many rows to export: 5200 match these filters (limit 5000). Narrow the date range or search." }],
    [401, { error: "Invalid admin username or password" }],
    [401, { error: "Invalid or expired token" }],
    [429, { error: "Too many failed login attempts. Try again in 15 minutes." }],
    [500, { error: "Server error creating building" }],
    [502, null],
    [400, { error: "Some new message" }],
  ];
  for (const [status, body] of samples) {
    const { key } = apiErrorText(status, body);
    assert.ok(english.has(key), `${key} (for ${JSON.stringify(body)})`);
  }
});

test("API errors: codes, known messages, then status", () => {
  assert.deepEqual(apiErrorText(400, { code: "INVALID_RADIUS", error: "..." }), {
    key: "errors.invalidRadius",
    values: { min: 50, max: 500 },
  });
  assert.equal(apiErrorText(400, { error: "This username is already taken by another worker." }).key, "errors.usernameTaken");
  assert.deepEqual(
    apiErrorText(400, { error: "Too many rows to export: 5200 match these filters (limit 5000). Narrow the date range or search." }),
    { key: "errors.tooManyRows", values: { count: 5200, limit: 5000 } },
  );
  assert.equal(apiErrorText(401, { error: "Invalid admin username or password" }).key, "errors.invalidCredentials");
  assert.equal(apiErrorText(401, { error: "Invalid or expired token" }).key, "errors.sessionExpired");
  assert.equal(apiErrorText(503, null).key, "errors.server");
  assert.equal(apiErrorText(400, { error: "Something new" }).key, "errors.generic");
});

test("dates: Riga time, labels follow the language, CSV form unchanged", () => {
  // 21:30 UTC on 8 Nov is 23:30 in Riga (UTC+2).
  assert.equal(formatAppDateTime("2026-11-08T21:30:00Z"), "08/11/2026, 23:30");
  assert.equal(formatAppDateTime("2026-11-08T21:30:00Z", "en"), "08/11/2026, 23:30");
  assert.equal(formatAppDateTime("2026-11-08T21:30:00Z", "ru"), "08.11.2026, 23:30");
  assert.equal(formatAppDateTime(null, "ru"), "—");
  assert.equal(formatWorkDate("2026-11-08", "en"), "2026-11-08");
  assert.equal(formatWorkDate("2026-11-08T00:00:00.000Z", "ru"), "08.11.2026");
});
