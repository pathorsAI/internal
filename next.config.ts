import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// ---------------------------------------------------------------------------
// 安全性 response header
// ---------------------------------------------------------------------------
//
// 為什麼放在 next.config 而不是 middleware：middleware 的 matcher 刻意排除了
// `/`（landing page）、`/login`、`/api/auth`、`/mcp`、`/.well-known`，而這些正是
// 最需要安全 header 的公開路徑 —— 放進 middleware 等於漏掉一半的站。next.config
// 的 headers() 是在 Next 的路由層貼上去的，頁面、route handler、靜態資產一體適用。

/** 每條路徑都該有的傳輸層 header，不會跟任何 handler 自己設的 header 打架。 */
const TRANSPORT_HEADERS = [
  {
    // 兩年 + 含子網域。刻意不加 preload：進了瀏覽器內建的 preload 清單，等於
    // 承諾 pathors.com 底下每一個子網域（含還沒開的）永遠只走 https，要撤銷得等
    // 好幾個瀏覽器版本，不是加個 header 就能順手決定的事。
    // 本機開發不受影響：瀏覽器只在安全連線上採納 HSTS，http://localhost 收到會直接忽略。
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    // 憑證下載端點會回使用者上傳的檔案，MIME sniffing 是那裡最直接的 XSS 途徑。
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
] as const;

/**
 * 關掉這個站完全用不到的裝置與瀏覽器功能。真正的價值不在我們自己（我們本來就
 * 不呼叫這些 API），而在於萬一有腳本被注入，它連要求鏡頭 / 麥克風 / 定位的權限
 * 都拿不到，而且這個限制會一併套用到所有子框架。
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/**
 * 真正 enforce 的 CSP —— 只放「跟 inline script / style 完全無關」的指令。
 *
 * 這幾條擋的是點擊劫持、<base> 注入改寫所有相對連結、以及把表單 POST 到外部
 * 網域的資料外流。它們不需要 nonce，也不可能弄壞任何現有頁面：站內沒有任何
 * <object>/<embed>、沒有把表單送到第三方、也沒有需要被 iframe 嵌入的頁面。
 */
const CSP_ENFORCED = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

/**
 * 目標 CSP，目前以 Report-Only 發出，**不是** enforce。
 *
 * 為什麼不能 enforce：這份 policy 的重點是 `script-src 'self'`（不含
 * 'unsafe-inline'），而要在 Next 上做到那件事，唯一的辦法是每個 request 產生一個
 * nonce、由 middleware 塞進 request header 再由 Next 注入到它自己的 bootstrap
 * script 上。nonce 天生是 per-request 的，next.config 的 headers() 是靜態的，
 * 這裡生不出來。而現況有三個沒有 nonce 就一定違規的 inline script 來源：
 *   1. Next 自己的 bootstrap / flight data inline script（每一頁都有）
 *   2. src/app/page.tsx 用 next/script 注入的 landing 互動腳本
 *   3. 同一頁用 dangerouslySetInnerHTML 塞的一大段 inline <style>
 * 換句話說，直接 enforce 會把首頁（以及整個 app）打成白畫面。
 *
 * 那為什麼不乾脆寫 `script-src 'self' 'unsafe-inline'` 然後 enforce？因為那是
 * 假的：'unsafe-inline' 一放，CSP 對 XSS 的防護就等於零，只是留一個看起來很像
 * 有做事的 header 給稽核看。寧可誠實地標成 Report-Only。
 *
 * 要改成 enforce，需要先做完這三件事：
 *   (a) 在 src/middleware.ts 產生 per-request nonce，寫進 `x-nonce` request header，
 *       並把 CSP header 改成由 middleware 動態組（含 `'nonce-…' 'strict-dynamic'`）；
 *       middleware 的 matcher 也要放寬到涵蓋 `/` 與 `/login`。
 *   (b) landing 的 inline <script> 改成帶 nonce（next/script 會從 Next 的 nonce
 *       機制取，前提是 (a) 已經做了）。
 *   (c) style-src 的 'unsafe-inline' 大概率得留著 —— React 的 style={{…}} 會產生
 *       inline style 屬性，而 style 屬性只吃 'unsafe-inline'（nonce 對它無效）。
 *       這是可以接受的取捨：CSS 注入的破壞力遠低於 script 注入，但要寫清楚，
 *       不要假裝這是 strict CSP。
 *
 * 沒有設 report-uri / report-to：目前沒有收 report 的端點，違規只會出現在瀏覽器
 * console。這份 policy 的用途因此是「還差多少才能 enforce」的清單，而不是監控。
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 目標狀態：inline script 全部靠 nonce，這裡先不放行任何 inline。
  "script-src 'self'",
  // 見上面 (c)：這條的 'unsafe-inline' 是預期會長期存在的例外。
  "style-src 'self' 'unsafe-inline'",
  // 站內圖片都在 /landing/images/ 與 /api/documents/*，沒有外部圖床；
  // data: 給內嵌的小圖示，blob: 給前端產生的預覽。
  "img-src 'self' data: blob:",
  // .woff2 仍然直接串 fonts.gstatic.com（src/app/landing-fonts.css 的說明）。
  // Google Fonts 的 CSS 本身已經 vendored 進 repo，所以不需要 style-src 放行網域。
  "font-src 'self' https://fonts.gstatic.com",
  // 這個 app 不打任何第三方 API；MCP 的對外呼叫都發生在 Worker 端，不在瀏覽器。
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Production/OpenNext builds use a separate dist dir (NEXT_DIST_DIR=.next-prod)
  // so they never clobber the `.next` that `next dev` is actively using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 憑證上傳走 Server Action，預設 body 上限 1MB，手機拍的發票照常常超過
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        // 全站，但**排除** `/mcp` 與 `/.well-known/*`。那兩塊的 CORS 與快取是由
        // src/lib/mcp/handler.ts 與 src/app/.well-known/metadata.ts 自己精算過的
        // （Access-Control-Allow-Origin 要照 Origin 回填、discovery 文件要能被
        // chatgpt.com 這類外站跨源讀取），所以這裡只給它們下面那組最小的
        // transport header，絕不套 CSP / COOP / X-Frame-Options 之類會影響
        // 跨源取用或框架行為的東西。
        source: String.raw`/((?!mcp$|mcp/|\.well-known/).*)`,
        headers: [
          ...TRANSPORT_HEADERS,
          {
            // 跨站只送 origin、降級到 http 時完全不送。這頁的路徑本身就會洩漏
            // 組織與單據 id（/dashboard/documents/123），不該跟著外連流出去。
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // frame-ancestors 的舊瀏覽器版本。兩個一起送是刻意的：CSP 只在
            // 支援 frame-ancestors 的瀏覽器生效，XFO 補上其餘的。
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // 切斷跟被我們開啟 / 開啟我們的跨源視窗之間的 window.opener 關係，
            // 擋掉 tabnabbing 與跨源視窗探測。登入走的是整頁 redirect（不是
            // popup，見 src/app/login/page.tsx），所以 same-origin 不會弄壞 OAuth。
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          { key: "Content-Security-Policy", value: CSP_ENFORCED },
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
      {
        // MCP 端點與 OAuth discovery 文件。這些是給機器讀的 JSON，必須能被
        // 外部 origin 跨源取用，所以只加不影響取用方式的 header。
        // 特別注意這裡沒有 Cross-Origin-Resource-Policy —— 設了會直接擋掉
        // chatgpt.com / claude.ai 從瀏覽器端讀 discovery 文件。
        source: String.raw`/(mcp|\.well-known/.*)`,
        headers: [
          ...TRANSPORT_HEADERS,
          // 這些 URL 只會被程式抓取，沒有「上一頁」可言；一律不送 referrer。
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

// Enables Cloudflare bindings (env, KV, etc.) during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
