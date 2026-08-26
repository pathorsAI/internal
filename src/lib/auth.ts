import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, mcp, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { publicBaseUrl } from "@/lib/base-url";
import * as authSchema from "@/db/auth-schema";

/** better-auth 的 provider id，用來取日曆的 access token。 */
export const GOOGLE_CALENDAR_PROVIDER_ID = "google-calendar";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Trust the custom domain, the *.workers.dev domain, and localhost (dev) so
  // requests from any of them pass better-auth's CSRF/origin check. (baseURL
  // alone — currently the workers.dev URL — would reject internal.pathors.com.)
  trustedOrigins: [
    "https://internal.pathors.com",
    "https://pathors-internal.pathors.workers.dev",
    "http://localhost:3000",
  ],
  advanced: {
    ipAddress: {
      // better-auth 預設只讀 `x-forwarded-for`，而那個 header 的第一段是**用戶端
      // 送什麼就是什麼** —— 它取 value.split(",")[0]，等於任何人都能自稱任意 IP，
      // 讓 rate limit 形同虛設。在 Cloudflare 前面，`cf-connecting-ip` 是邊緣節點
      // 寫死的、用戶端偽造不了，所以擺第一順位；x-forwarded-for 只當 CF 不在
      // 路徑上（本機 / 其他 proxy）時的退路。
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
  },
  // ---------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------
  // ⚠️ 這裡的效果在 Cloudflare Workers 上是「有限」的，不要把它當成真的防線：
  // storage 是 memory（見下），而 Worker 的 isolate 短命又同時有很多份，計數
  // 不會跨 isolate、跨 colo 共享。實際上它擋得住「同一個人手滑連按」與單機
  // 腳本的暴衝，擋不住刻意分散來源的攻擊。
  //
  // 要變成真的有效，得把 storage 換成共享儲存，兩條路都需要另一個 PR：
  //   (a) storage: "database" —— better-auth 會用 `rateLimit` model（欄位
  //       key / count / lastRequest，見 @better-auth/core db/schema/rate-limit）。
  //       src/db/auth-schema.ts 目前沒有這張表，需要一份 migration；本次刻意
  //       不自己寫 migration（見回報）。另外每個 auth request 會多兩次 Neon
  //       round trip，延遲成本要一起評估。
  //   (b) secondaryStorage 指到 Cloudflare KV —— 效能上最合適，但 wrangler
  //       設定目前沒有 KV binding，而且 secondaryStorage 一旦設了，session 也會
  //       改走它，那是比 rate limit 大得多的行為改變。
  //
  // enabled 沒有明寫：better-auth 預設只在 production 開啟，dev 不擋，正是我們要的。
  rateLimit: {
    // 全站預設維持 better-auth 的預設值（每個 IP × 每個 endpoint，10 秒 100 次），
    // 只是明寫出來。刻意不調嚴：計數是 IP 為單位，客戶端在同一個 NAT 出口後面
    // （辦公室、公司 VPN）會共用一組配額，調太緊會先弄壞正常使用者。
    window: 10,
    max: 100,
    // 路徑是去掉 basePath 後的相對路徑（/api/auth/sign-in/social → /sign-in/social），
    // 支援 `*` 萬用字元。這裡只針對「被濫用會有實際代價」的端點加嚴。
    customRules: {
      // 登入入口。better-auth 內建的特別規則是 10 秒 3 次；換成 60 秒 20 次，
      // 對同一個 IP 的長時間打點更有效，又留得下整間辦公室早上一起登入的空間。
      "/sign-in/*": { window: 60, max: 20 },
      // RFC 7591 動態註冊：不需要任何憑證就能建一筆 oauth_application。這是整個
      // MCP 表面唯一「匿名可寫 DB」的端點，也就是最該限流的一個。正常的 MCP
      // client（ChatGPT / Claude / Codex）一條連線只註冊一次。
      "/mcp/register": { window: 3600, max: 20 },
      // 發邀請會寫 invitation 並把 email 暴露給流程，拿來當帳號探測或洗信箱都
      // 划算。一小時 30 封對真人管理者綽綽有餘。
      "/organization/invite-member": { window: 3600, max: 30 },
    },
  },
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: authSchema,
    // neon-http has no interactive transactions; run ops sequentially.
    transaction: false,
  }),
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Always show Google's account chooser instead of silently reusing the
      // browser's only signed-in session — users may have multiple accounts.
      prompt: "select_account",
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Default a new session's active org to the user's first membership,
        // so server code always has an org to scope by right after login.
        before: async (session) => {
          const db = getDb();
          const rows = await db
            .select({ organizationId: authSchema.member.organizationId })
            .from(authSchema.member)
            .where(eq(authSchema.member.userId, session.userId))
            .limit(1);
          return {
            data: {
              ...session,
              activeOrganizationId: rows[0]?.organizationId ?? null,
            },
          };
        },
      },
    },
  },
  plugins: [
    // 邀請預設只有 48 小時有效，而且過期後 DB 裡的 status 仍然是 pending ——
    // better-auth 從來不會把它改成 expired。結果是管理端與受邀者兩邊都看到一個
    // 「待接受」的邀請，按下去卻只會拿到 INVITATION_NOT_FOUND（訊息長得像找不到
    // 邀請，完全看不出是過期）。內部工具沒必要卡這麼短，拉長到 7 天讓「邀請發出去
    // 隔幾天才被看到」這個常態不再變成故障。
    // cancelPendingInvitationsOnReInvite：重複邀請同一個 email 時，自動把舊的
    // 未過期 pending 標成 canceled，不然同一個人會在列表裡疊出好幾筆邀請，
    // 管理者根本分不出哪一筆才是有效的。
    organization({
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,
    }),
    // Google 日曆授權，刻意與上面的登入用 google provider 分開。
    // 原因：Google 只在 access_type=offline + prompt=consent 時才給 refresh token，
    // 而 prompt 是 provider 層設定、無法單次覆寫 —— 直接改登入那組會害每個人每次
    // 登入都要多按一次「允許」。拆成獨立的 provider 後，只有真的要用日曆的人會看到
    // 同意畫面，登入流程完全不受影響。token 一樣存在 account 表（providerId =
    // 'google-calendar'），refresh 由 better-auth 的 getAccessToken 處理。
    genericOAuth({
      config: [
        {
          providerId: GOOGLE_CALENDAR_PROVIDER_ID,
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          tokenUrl: "https://oauth2.googleapis.com/token",
          userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
          // `profile` 不是為了拿頭像或名字來顯示，是 better-auth 的硬性要求：
          // generic-oauth 在連結帳號前會檢查 userInfo.name，沒有就直接以
          // `?error=name_is_missing` 中止（better-auth generic-oauth/routes）。
          // 而 Google 的 userinfo 端點只在授予 profile 時才回傳 name，少了它
          // 整個授權流程走完最後一步必定失敗。登入用的 google provider 本來
          // 就帶 profile，所以使用者不會多看到任何額外的權限項目。
          scopes: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
          ],
          accessType: "offline",
          prompt: "consent",
          pkce: true,
        },
      ],
    }),
    // OAuth 2.0 / OIDC provider for MCP clients. Adds /api/auth/mcp/* endpoints
    // (authorize, token, register, get-session) + OAuth discovery. Unauthenticated
    // authorize requests are sent to loginPage, which redirects back after sign-in.
    mcp({
      loginPage: "/login",
      // Canonical resource identifier published in the RFC 9728 protected
      // resource metadata. It must be the MCP endpoint itself, not the bare
      // origin: MCP clients (ChatGPT included) echo this exact string back as
      // the `resource` parameter on the authorize + token requests, and it is
      // what the `WWW-Authenticate` challenge from /mcp binds to. Mirrors
      // MCP_RESOURCE in src/lib/mcp/handler.ts.
      resource: `${publicBaseUrl()}/mcp`,
    }),
    nextCookies(),
  ],
});
