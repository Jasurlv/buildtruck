"use client";

import { Globe } from "lucide-react";
import { LANGUAGES, setLanguage, useTranslation } from "@/i18n";

/** EN | RU toggle. The choice is saved in this browser and applies immediately. */
export default function LanguageSwitcher() {
  const { language, t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-semibold"
    >
      <Globe size={14} className="mx-1 text-gray-500" aria-hidden />
      {LANGUAGES.map((option) => (
        <button
          key={option.code}
          type="button"
          onClick={() => setLanguage(option.code)}
          aria-pressed={language === option.code}
          title={option.name}
          className={`rounded-lg px-2 py-1 transition-all ${
            language === option.code
              ? "bg-white text-indigo-600 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
