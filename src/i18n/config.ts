/** The locales this app ships translations for. `zh-TW` is the source of truth. */
export const locales = ["zh-TW", "en"] as const;

export type Locale = (typeof locales)[number];

export type LocaleMeta = {
  /** 選單上的語言名稱，一律寫該語言自己的說法（不是翻譯過的）。 */
  label: string;
  /** BCP-47 tag for the <html lang> attribute. */
  htmlLang: string;
  /** public/flags 內的國旗檔名，與幣別共用同一套圖（見 src/lib/currency.ts）。 */
  flag: string;
};

/**
 * 語系的中繼資料放同一張表。之前 label 與 htmlLang 是兩個各自獨立的 Record，
 * 新增語系得記得每個都補；併成一張表之後漏欄位是型別錯誤，不是上線後才看到的空白。
 */
export const LOCALES: Record<Locale, LocaleMeta> = {
  "zh-TW": { label: "繁體中文", htmlLang: "zh-Hant-TW", flag: "Taiwan" },
  en: { label: "English", htmlLang: "en", flag: "United States" },
};

export const defaultLocale: Locale = "zh-TW";

/** Cookie holding the reader's locale choice. There is no locale in the URL. */
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
