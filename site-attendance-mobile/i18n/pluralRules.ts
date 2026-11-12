// Plural rules for the app's languages, used only when the JavaScript engine has no
// Intl.PluralRules (i18next needs it to choose "1 минута / 2 минуты / 5 минут").
// Some Hermes builds ship Intl without PluralRules; a real implementation is
// never replaced. The rules match CLDR for whole numbers, which is all the app passes.

type Category = "one" | "few" | "many" | "other";

const CATEGORIES: Record<string, Category[]> = {
  en: ["one", "other"],
  ru: ["one", "few", "many", "other"],
  uz: ["one", "other"],
};

export function selectPlural(language: string, count: number): Category {
  const n = Math.abs(count);
  if (language === "ru") {
    if (!Number.isInteger(n)) return "other";
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    return "many";
  }
  // English: "1" only (not "1.0"); Uzbek: any 1.
  if (language === "en") return n === 1 && Number.isInteger(count) ? "one" : "other";
  return n === 1 ? "one" : "other";
}

class SimplePluralRules {
  private readonly language: string;
  constructor(locales?: string | string[]) {
    const first = (Array.isArray(locales) ? locales[0] : locales) ?? "en";
    const language = first.toLowerCase().split(/[-_]/)[0];
    this.language = language in CATEGORIES ? language : "en";
  }
  select(count: number): Category {
    return selectPlural(this.language, count);
  }
  resolvedOptions() {
    return {
      locale: this.language,
      type: "cardinal" as const,
      pluralCategories: [...CATEGORIES[this.language]],
    };
  }
  static supportedLocalesOf(locales: string | string[]): string[] {
    return (Array.isArray(locales) ? locales : [locales]).filter((locale) =>
      locale.toLowerCase().split(/[-_]/)[0] in CATEGORIES,
    );
  }
}

export function installPluralRulesIfMissing(): void {
  const intl = (globalThis as { Intl?: Record<string, unknown> }).Intl;
  if (intl && typeof intl.PluralRules === "function") return;
  if (intl) {
    intl.PluralRules = SimplePluralRules;
  } else {
    (globalThis as Record<string, unknown>).Intl = { PluralRules: SimplePluralRules };
  }
}
