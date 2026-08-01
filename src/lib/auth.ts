import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, mcp, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
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
    organization(),
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
    mcp({ loginPage: "/login" }),
    nextCookies(),
  ],
});
