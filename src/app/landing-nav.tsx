import { getTranslations } from "next-intl/server";

import { LandingLocaleSwitcher } from "./landing-locale-switcher";

/**
 * Landing 的導覽列。整頁只有這一塊是 JSX，其餘仍是 LANDING_HTML 的字串模板 ——
 * 因為只有這裡要放真正的 React 元件（語言切換器、以及依登入狀態變化的主行動按鈕）。
 *
 * ⚠️ class 名稱、`id="nav"` 與 DOM 結構必須跟原本 LANDING_HTML 裡的 <header> 一模一樣：
 * LANDING_SCRIPT 靠 `#nav` 在捲動時加上 `.stuck`（分隔線），LANDING_CSS 的 .nav / .logo /
 * .mark / .hide-s 等選擇器也要繼續命中。
 *
 * wordmark 是品牌名，兩種語言都是 Internal，所以寫死不進字典。
 */
export async function LandingNav({ signedIn }: { readonly signedIn: boolean }) {
  const t = await getTranslations("landing");

  return (
    <header className="nav" id="nav">
      <div className="wrap">
        <a className="logo" href="#top">
          <span className="mark">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="4,17 10,11 14,15 20,6" />
            </svg>
          </span>Internal
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
          <a href="https://github.com/pathorsAI/internal" className="hide-s">
            GitHub
          </a>
          <LandingLocaleSwitcher />
          <a className="btn primary sm" href={signedIn ? "/dashboard" : "/login"}>
            {signedIn ? t("cta.openApp") : t("cta.login")}
          </a>
        </nav>
      </div>
    </header>
  );
}
