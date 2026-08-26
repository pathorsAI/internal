import type { Metadata } from "next";
import Script from "next/script";

import "./landing-fonts.css";
import { LANDING_CSS, LANDING_HTML, LANDING_SCRIPT } from "./landing-content";

export const metadata: Metadata = {
  title: "Books That Agree",
  description:
    "內外帳一致的記帳系統：一筆交易同時交代兩本帳，對得起來才收工。",
};

/**
 * 公開的 landing page（internal.pathors.com 的根目錄），不需要登入 —— middleware
 * 對 `/` 與 `/landing/*` 直接放行。系統本體在 /dashboard。
 *
 * markup / CSS / script 都原封不動來自 docs/index.html（見 ./landing-content），
 * 所以這裡刻意不轉成 JSX、不套 Tailwind：
 *  - 字體的 @font-face 走 ./landing-fonts.css（原 docs/fonts.css，一字未改）。用
 *    import 而不是 <link>，是因為手寫 <link rel="stylesheet"> 會繞過 Next 的 CSS
 *    管線（eslint 的 no-css-tags 就是在講這件事）。
 *  - <style> 直接寫在 body 內而不是靠 React 的 hoisting，這樣它在文件順序上必定
 *    晚於 head 裡的 globals.css，Tailwind preflight 打平的 h1/p 樣式才會被 landing
 *    自己的規則蓋回來。
 *  - dangerouslySetInnerHTML 不會執行 <script>，所以互動（捲動揭露、主題與語言切換）
 *    要靠 next/script 以 afterInteractive 注入。
 */
export default function LandingPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
      <Script
        id="landing-behaviour"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: LANDING_SCRIPT }}
      />
    </>
  );
}
