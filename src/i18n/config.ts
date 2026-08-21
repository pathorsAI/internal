/** The locales this app ships translations for. `zh-TW` is the source of truth. */
export const locales = ["zh-TW", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-TW";

/** Cookie holding the reader's locale choice. There is no locale in the URL. */
export const LOCALE_COOKIE = "locale";

export const localeLabels: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** BCP-47 tag for the <html lang> attribute. */
export const htmlLang: Record<Locale, string> = {
  "zh-TW": "zh-Hant-TW",
  en: "en",
};
