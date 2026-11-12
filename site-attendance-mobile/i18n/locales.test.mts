// Translation files: every language has every English key (with the plural forms
// its grammar needs) and the same {{placeholders}}. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { selectPlural } from "./pluralRules.ts";

type Json = string | Json[] | { [key: string]: Json };

const load = (language: string) =>
  JSON.parse(readFileSync(new URL(`./locales/${language}.json`, import.meta.url), "utf8")) as Json;

const LANGUAGES = ["ru", "uz"] as const;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flattens to "a.b.c" -> text; array items become "a.0", "a.1", ... */
function flatten(value: Json, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof value === "string") {
    out.set(prefix, value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, out));
  } else {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** English keys, with plural keys reduced to their base ("units.minutes"). */
function requiredKeys(english: Map<string, string>) {
  const plain = new Set<string>();
  const plural = new Set<string>();
  for (const key of english.keys()) {
    if (PLURAL_SUFFIX.test(key)) plural.add(key.replace(PLURAL_SUFFIX, ""));
    else plain.add(key);
  }
  return { plain, plural };
}

const placeholders = (text: string) => new Set([...text.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]));

const english = flatten(load("en"));
const { plain, plural } = requiredKeys(english);

for (const language of LANGUAGES) {
  const translated = flatten(load(language));
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;

  test(`${language}: has every English key`, () => {
    const missing = [...plain].filter((key) => !translated.has(key));
    assert.deepEqual(missing, [], `${language}.json is missing keys`);
  });

  test(`${language}: has every plural form its grammar needs`, () => {
    const missing: string[] = [];
    for (const base of plural) {
      for (const category of categories) {
        if (!translated.has(`${base}_${category}`)) missing.push(`${base}_${category}`);
      }
    }
    assert.deepEqual(missing, [], `${language}.json is missing plural forms`);
  });

  test(`${language}: no keys that English does not have`, () => {
    const extra = [...translated.keys()].filter((key) => {
      const base = key.replace(PLURAL_SUFFIX, "");
      return !english.has(key) && !(PLURAL_SUFFIX.test(key) && plural.has(base));
    });
    assert.deepEqual(extra, [], `${language}.json has keys English does not have (renamed or stale?)`);
  });

  test(`${language}: same {{placeholders}} and no empty text`, () => {
    const problems: string[] = [];
    for (const [key, text] of translated) {
      if (!text.trim()) problems.push(`${key}: empty`);
      const source = english.get(key) ?? english.get(`${key.replace(PLURAL_SUFFIX, "")}_other`);
      if (source === undefined) continue;
      const expected = [...placeholders(source)].sort().join(",");
      const actual = [...placeholders(text)].sort().join(",");
      if (expected !== actual) problems.push(`${key}: {{${actual}}} instead of {{${expected}}}`);
    }
    assert.deepEqual(problems, []);
  });
}

test("plural fallback matches the engine's Intl.PluralRules", () => {
  for (const language of ["en", "ru", "uz"]) {
    const rules = new Intl.PluralRules(language);
    for (let count = 0; count <= 1000; count++) {
      assert.equal(selectPlural(language, count), rules.select(count), `${language} ${count}`);
    }
  }
});
