import { LOCALES, type Locale } from "@/i18n/config";

/**
 * 語系的國旗小圖示。檔案在 public/flags/<國家>.svg，與幣別共用同一套圖
 * （見 src/components/currency-flag.tsx）。
 *
 * className 原封不動傳下去、這裡不塞任何預設樣式：兩個呼叫端活在不同的樣式脈絡裡
 * （側邊欄吃 Tailwind、公開頁吃 .langsw* 那組手刻 CSS），共用的只有檔名規則。
 *
 * alt 一律空字串：旗子旁邊永遠有語言名稱，讀螢幕的人不需要再聽一次「台灣」。
 *
 * 這些圖是**圓形**徽章（畫在 24×24 的透明畫布上），不是方形旗面：呼叫端只要給尺寸，
 * 加圓角或外框反而會在圓的外面描出一個方框。
 */
export function LocaleFlag({
  locale,
  className,
}: Readonly<{ locale: Locale; className?: string }>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${encodeURIComponent(LOCALES[locale].flag)}.svg`}
      alt=""
      className={className}
    />
  );
}
