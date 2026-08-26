"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { setUserLocale } from "@/i18n/actions";
import { locales, localeLabels, type Locale } from "@/i18n/config";

/**
 * Landing 專用的語言切換器：一顆圖示按鈕，按下展開一個小選單。
 *
 * 為什麼不直接用 src/components/locale-switcher.tsx：那支是側邊欄專用的（SidebarMenu +
 * shadcn 的 DropdownMenu），把 Radix 搬進 landing 會讓兩套樣式脈絡打架 —— landing 有
 * 自己一整套 CSS 變數與元件語彙，不吃 Tailwind。所以這裡只用 landing 自己的 class
 * （.langsw*，定義在 LANDING_CSS 末尾），dropdown 手刻。
 *
 * 行為與側邊欄那支一致：setUserLocale() 之後一定要 router.refresh() —— 翻譯後的 markup
 * 是 server component 產生的，不從 server 重新渲染的話畫面不會變。
 */
export function LandingLocaleSwitcher() {
  const t = useTranslations("common.locale");
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  // 點外面關掉、Esc 關掉並把焦點還給觸發鈕。只在展開時掛監聽。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  function select(locale: Locale) {
    close(true);
    if (locale === active) return;
    startTransition(async () => {
      await setUserLocale(locale);
      router.refresh();
    });
  }

  return (
    <div className="langsw" ref={root} data-pending={pending || undefined}>
      <button
        type="button"
        className="langsw-trigger"
        ref={trigger}
        aria-label={t("label")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Languages aria-hidden="true" />
      </button>
      {open && (
        <div className="langsw-menu" role="menu" aria-label={t("label")}>
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              className="langsw-item"
              aria-checked={locale === active}
              lang={locale}
              onClick={() => select(locale)}
            >
              <Check aria-hidden="true" />
              <span>{localeLabels[locale]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
