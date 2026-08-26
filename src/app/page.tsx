import type { Metadata } from "next";
import Script from "next/script";
import { getLocale, getTranslations } from "next-intl/server";

import { getSession } from "@/lib/session";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import "./landing-fonts.css";
import { LANDING_CSS, LANDING_HTML, LANDING_SCRIPT } from "./landing-content";
import { LandingNav } from "./landing-nav";
import { escapeHtml, renderLandingTemplate } from "./landing-template";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * 主行動按鈕會依登入狀態換掉：沒登入就請人登入，登入了就直接送進系統 ——
 * 對已經登入的人喊「登入」是沒有意義的按鈕。
 */
function authCta(signedIn: boolean, className: string, label: string): string {
  const href = signedIn ? "/dashboard" : "/login";
  return `<a class="${className}" href="${href}">${escapeHtml(label)}</a>`;
}

/**
 * 公開的 landing page（internal.pathors.com 的根目錄），不需要登入 —— proxy（Next 16 之前叫 middleware）
 * 對 `/` 與 `/landing/*` 直接放行。系統本體在 /dashboard。
 *
 * markup / CSS / script 來自 docs/index.html（見 ./landing-content），除了導覽列以外
 * 刻意不轉成 JSX、不套 Tailwind：
 *  - 字體的 @font-face 走 ./landing-fonts.css。用 import 而不是 <link>，是因為手寫
 *    <link rel="stylesheet"> 會繞過 Next 的 CSS 管線（eslint 的 no-css-tags）。
 *  - <style> 直接寫在 body 內而不是靠 React 的 hoisting，這樣它在文件順序上必定
 *    晚於 head 裡的 globals.css，Tailwind preflight 打平的 h1/p 樣式才會被 landing
 *    自己的規則蓋回來。
 *  - dangerouslySetInnerHTML 不會執行 <script>，所以互動（捲動揭露、demo 的分頁切換）
 *    要靠 next/script 以 afterInteractive 注入。
 *
 * 動態的部分有兩類：
 *  - `{{key}}` 文案佔位符，依 cookie 的語系從字典代入（值會 escape，漏翻會丟例外）。
 *  - `<!--AUTH_*-->` 按鈕佔位符。getSession() 對沒帶 session cookie 的請求會直接回
 *    null，不會為了匿名訪客去查資料庫，所以 landing 的常態流量成本沒有變。
 */
export default async function LandingPage() {
  const signedIn = !!(await getSession());
  const locale = (await getLocale()) as Locale;
  const t = messages[locale].landing;

  const ctaLabel = signedIn ? t.cta.openApp : t.cta.login;
  const html = renderLandingTemplate(LANDING_HTML, t)
    .replaceAll("<!--AUTH_CTA_HERO-->", authCta(signedIn, "btn primary", ctaLabel))
    .replaceAll("<!--AUTH_CTA_FINALE-->", authCta(signedIn, "btn primary", ctaLabel))
    .replaceAll(
      "<!--AUTH_LINK_FOOTER-->",
      `<a href="${signedIn ? "/dashboard" : "/login"}">${escapeHtml(ctaLabel)}</a>`,
    );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <LandingNav signedIn={signedIn} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <Script
        id="landing-behaviour"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: LANDING_SCRIPT }}
      />
    </>
  );
}
