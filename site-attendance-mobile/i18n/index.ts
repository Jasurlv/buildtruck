// App language: English, Russian, Uzbek (Latin). The first launch follows the
// phone's language (English when it is none of these); the worker's choice is saved
// on the phone and wins afterwards. Text lives in i18n/locales/*.json (same keys
// in every file; a missing key falls back to English).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { installPluralRulesIfMissing } from "./pluralRules";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uz from "./locales/uz.json";

export const LANGUAGES = [
  { code: "en", name: "English", short: "EN" },
  { code: "ru", name: "Русский", short: "RU" },
  { code: "uz", name: "Oʻzbekcha", short: "UZ" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "app_language";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

/** The phone's language if the app has it, otherwise English. */
export function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return isLanguage(code) ? code : "en";
  } catch {
    return "en";
  }
}

installPluralRulesIfMissing();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    uz: { translation: uz },
  },
  lng: deviceLanguage(),
  fallbackLng: "en",
  supportedLngs: LANGUAGES.map((language) => language.code),
  // Resources are bundled: initialise synchronously, so text is ready on first render.
  initAsync: false,
  // React escapes text itself; Alert and notifications show plain text.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * Resolves once the saved choice (if any) is applied. The entry screen and the
 * background location task wait for it, so nothing is shown in the wrong language.
 */
export const languageReady: Promise<void> = AsyncStorage.getItem(STORAGE_KEY)
  .then(async (saved) => {
    if (isLanguage(saved) && saved !== i18n.language) await i18n.changeLanguage(saved);
  })
  .catch(() => {
    // Storage unavailable: keep the phone's language.
  });

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : "en";
}

/** Switches the whole app at once (no restart) and remembers the choice. */
export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not saved: the app still switches now; the next start uses the phone's language.
  }
}

export default i18n;
