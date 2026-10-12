import { getTranslations } from "next-intl/server";

import { LogoMark } from "@/components/logo";

import { PublicLocaleSwitcher } from "./public-locale-switcher";

/**
 * Landing 的導覽列。整頁只有這一塊是 JSX，其餘仍是 LANDING_HTML 的字串模板 ——
 * 因為只有這裡要放真正的 React 元件（語言切換器、以及依登入狀態變化的主行動按鈕）。
 *
 * ⚠️ class 名稱、`id="nav"` 與 DOM 結構必須跟原本 LANDING_HTML 裡的 <header> 一模一樣：
 * LANDING_SCRIPT 靠 `#nav` 在捲動時加上 `.stuck`（分隔線），LANDING_CSS 的 .nav / .logo /
 * .mark / .hide-s 等選擇器也要繼續命中。
 *
 * wordmark 是品牌名，兩種語言都是 Internal，所以寫死不進字典。標誌直接用系統側欄的
 * LogoMark（同一個 SVG、同一個藍），landing 與產品才不會長得像兩家公司；.mark 只管尺寸。
 */
export async function LandingNav({ signedIn }: { readonly signedIn: boolean }) {
  const t = await getTranslations("landing");

  return (
    <header className="nav" id="nav">
      <div className="wrap">
        <a className="logo" href="#top">
          <LogoMark className="mark" />
          Internal
        </a>
        <nav>
          <a href="#books" className="hide-s">
            {t("nav.howItWorks")}
          </a>
          <a href="#assistant" className="hide-s">
            {t("nav.assistant")}
          </a>
          <a href="#billing" className="hide-s">
            {t("nav.billing")}
          </a>
          <a
            href="https://github.com/pathorsAI/internal"
            className="gh-icon"
            aria-label="GitHub"
            title="GitHub"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <PublicLocaleSwitcher />
          <a className="btn primary sm" href={signedIn ? "/dashboard" : "/login"}>
            {signedIn ? t("cta.openApp") : t("cta.login")}
          </a>
        </nav>
      </div>
    </header>
  );
}
