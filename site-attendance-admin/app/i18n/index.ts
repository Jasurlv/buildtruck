// Dashboard language: English or Russian. The admin's choice is saved in
// localStorage; without one, the browser's language decides (Russian for "ru",
// English otherwise). Text is in ./en.json and ./ru.json (same keys; a missing
// Russian text falls back to English). Plural keys end in _one/_few/_many/_other.
import { useCallback, useSyncExternalStore } from "react";
import en from "./en.json";
import ru from "./ru.json";

export const LANGUAGES = [
  { code: "en", name: "English", short: "EN" },
  { code: "ru", name: "Русский", short: "RU" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

type Messages = { [key: string]: string | Messages };
const MESSAGES: Record<Language, Messages> = { en, ru };

// "nav.title" | "buildings.workers" (for workers_one/_other) | ...
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
type WithoutPlural<K extends string> = K extends `${infer Base}_${"one" | "few" | "many" | "other"}`
  ? Base
  : K;
export type TranslationKey = WithoutPlural<Leaves<typeof en>>;
export type TranslationValues = Record<string, string | number>;

const STORAGE_KEY = "admin_language";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function find(language: Language, key: string, count: unknown): string | undefined {
  const messages = MESSAGES[language];
  if (typeof count === "number") {
    const form = new Intl.PluralRules(language).select(count);
    const plural = lookup(messages, `${key}_${form}`) ?? lookup(messages, `${key}_other`);
    if (plural !== undefined) return plural;
  }
  return lookup(messages, key);
}

/** Text for `key` in `language`, with {{name}} placeholders filled in. */
export function translate(
  language: Language,
  key: TranslationKey,
  values: TranslationValues = {},
): string {
  const template = find(language, key, values.count) ?? find("en", key, values.count) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

// ---- The selected language, shared by every component ----

let current: Language | null = null;
const listeners = new Set<() => void>();

function detectLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage blocked: use the browser's language.
  }
  const browser = (window.navigator.language || "en").toLowerCase().split("-")[0];
  return isLanguage(browser) ? browser : "en";
}

function getSnapshot(): Language {
  if (current === null) {
    current = detectLanguage();
    document.documentElement.lang = current;
  }
  return current;
}

// The server render (and the first client render, for hydration) is English; the
// saved or browser language applies right after.
function getServerSnapshot(): Language {
  return "en";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(language: Language): void {
  current = language;
  document.documentElement.lang = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not saved: the page still switches now.
  }
  listeners.forEach((listener) => listener());
}

/** The selected language and a `t` bound to it; re-renders when it changes. */
export function useTranslation() {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(language, key, values),
    [language],
  );
  return { language, t };
}
