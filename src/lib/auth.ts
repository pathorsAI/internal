import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth, magicLink, mcp, organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { completeSignupEmail, resetPasswordEmail, signInLinkEmail } from "@/lib/auth-emails";
import { publicBaseUrl } from "@/lib/base-url";
import { sendEmail, type EmailMessage } from "@/lib/email";
import { claimEmailCooldown } from "@/lib/email-cooldown";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { isSsoDomain } from "@/lib/sso-domain";
import * as authSchema from "@/db/auth-schema";

/** better-auth 的 provider id，用來取日曆的 access token。 */
export const GOOGLE_CALENDAR_PROVIDER_ID = "google-calendar";

/**
 * email 的網域註冊了 SSO provider，這個人不准自助註冊／自助重設密碼，必須走公司 IdP。
 *
 * message 刻意跟 code 一樣是 `SSO_REQUIRED`，不是一句人話：Google 登入的 OAuth
 * callback 擋下建立 user 時，better-auth 只把 **message**（空白換成底線）接到
 * `?error=` 上（handleOAuthUserInfo 把 APIError 收成 `{ error: e.message }`，
 * callback 再 redirectOnError），code 在那條路上會被丟掉。message 等於 code，
 * 登入頁收到的就是穩定的 `?error=SSO_REQUIRED`，能顯示對應的說明；JSON API
 * （magic link、忘記密碼）則照常帶 `code: "SSO_REQUIRED"`，前端看 code 決定訊息，
 * 不會把 message 秀給使用者。
 */
const SSO_REQUIRED = "SSO_REQUIRED";

function ssoRequiredError() {
  return new APIError("FORBIDDEN", { code: SSO_REQUIRED, message: SSO_REQUIRED });
}

/**
 * 寄出驗證／重設信。失敗只記 log、不往外丟：
 *
 * 重設密碼只對「存在的帳號」呼叫 sendResetPassword，寄信失敗若變成 500，回應
 * 就會因帳號存不存在而不同——等於把帳號探測接回去。magic link 雖然兩種情況都會
 * 呼叫，也一樣吞掉，讓「回應永遠只取決於 email 網域與限流」這件事單純成立。
 * 寄不出去是我們的維運問題（多半是 RESEND_API_KEY 沒設），看 Worker log 會看到。
 */
async function deliver(to: string, message: Omit<EmailMessage, "to">) {
  try {
    await sendEmail({ to, ...message });
  } catch (error) {
    console.error(`[auth-email] failed to send "${message.subject}"`, error);
  }
}

async function userExists(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

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
    //
    // ⚠️ 規則的先後順序（better-auth api/rate-limiter 的 resolveRateLimitConfig）：
    //   1. 內建特別規則：/sign-in*、/sign-up* 10 秒 3 次；/request-password-reset
    //      60 秒 3 次。
    //   2. plugin 自帶的 rateLimit 蓋掉 1。magic-link plugin 對 /sign-in/magic-link
    //      與 /magic-link/verify 是 60 秒 5 次。
    //   3. 這裡的 customRules 最後套用、蓋掉前兩者——但它取的是**物件裡第一個
    //      符合的 key**（Object.keys().find()），精確路徑與萬用字元一視同仁、
    //      按寫入順序比。所以 "/sign-in/magic-link" 一定要寫在 "/sign-in/*" 前面，
    //      不然 magic link 會被萬用字元那條吃掉，拿到的是 60 秒 20 次。
    // 計數的 key 是 IP × 路徑，各端點的配額互不相干。
    customRules: {
      // 公開註冊的寄信入口：每送一次就寄一封信到使用者填的地址。一小時 10 次對
      // 「寄錯地址再寄一次」很夠；擋單一來源拿它大量寄信。單一收件人的轟炸由
      // src/lib/email-cooldown.ts 另外擋（那個跨 isolate）。
      "/sign-in/magic-link": { window: 3600, max: 10 },
      // 登入入口。better-auth 內建的特別規則是 10 秒 3 次；換成 60 秒 20 次，
      // 對同一個 IP 的長時間打點更有效，又留得下整間辦公室早上一起登入的空間。
      "/sign-in/*": { window: 60, max: 20 },
      // 點信裡的連結。token 是 32 字元隨機字串、單次有效，暴力猜不實際；放寬是
      // 因為公司信箱的連結掃描器（Outlook Safe Links 之類）也會打這支。
      "/magic-link/verify": { window: 60, max: 20 },
      // 忘記密碼：跟 magic link 一樣是「填一個地址就寄一封信」。
      "/request-password-reset": { window: 3600, max: 10 },
      // 送出新密碼。token 是 24 字元隨機字串；限流擋的是對 token 的盲猜。
      "/reset-password": { window: 3600, max: 20 },
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
  // ---------------------------------------------------------------------
  // Email + password
  // ---------------------------------------------------------------------
  // 開著是為了三種人：目錄審核用的測試帳號（審核者沒有我們的 Google 網域）、
  // 自架這套系統不想接 Google 的人，以及從 /signup 自助註冊的外部使用者。
  //
  // ⚠️ disableSignUp 必須維持 true——即使現在有公開註冊。公開註冊走的是
  // 「先驗證 email、再設密碼」：/signup 寄 magic link（下面 plugins 的 magicLink），
  // 點了信裡的連結才會建 user，接著在 /signup/password 用 setPassword 補上密碼。
  // 所以系統裡**永遠不會出現一個 email 沒驗證過的密碼帳號**，這正是要的性質：
  //
  // - 帳號預劫持（account pre-hijacking）：better-auth 的帳號連結以 email 為鍵。
  //   若開放先設密碼的註冊，攻擊者可以先用 victim@company.com 註冊密碼帳號，
  //   等真正的擁有者之後用 Google 登入，provider 已驗證的身分就被連到攻擊者早就
  //   建好的 user 上，攻擊者的密碼從此能登進對方的帳號。
  // - email 佔位（squatting）：better-auth 1.6.14 的 accountLinking.requireLocalEmailVerified
  //   預設 true（oauth2/link-account），本機 user 沒驗證過 email 時拒絕連結 Google。
  //   上面的劫持因此被擋下，但換來另一個問題：攻擊者先註冊一個不驗證的密碼帳號，
  //   真正的主人就**永遠用不了 Google 登入**（callback 回 account_not_linked）。
  //
  // 先驗證再設密碼，兩條路都不存在。伺服器端開帳號（scripts/create-user.ts）
  // 不經過 HTTP，不受這個開關影響。
  //
  // minPasswordLength 12：better-auth 的預設 8 對一個能看到全部帳務的後台太短。
  // 數字放在 src/lib/password-policy.ts，表單的即時檢查用同一個常數。
  //
  // sendResetPassword：忘記密碼（/forgot-password → /reset-password）。
  // ⚠️ 只有 Google 登入、從沒設過密碼的人也能走這條：better-auth 的 resetPassword
  // 找不到 credential account 時會直接**建一個**（api/routes/password 的
  // resetPassword：findAccounts 沒有 providerId "credential" 就 createAccount），
  // 而不是報錯。這是我們要的——能收到那個信箱的信，就是那個帳號的主人，等於
  // 「替 Google 帳號加一組密碼」——但要知道它會發生。SSO 網域的人在 hooks 那裡
  // 就被擋掉，不會走到這裡。
  //
  // revokeSessionsOnPasswordReset：重設密碼最常見的理由是「懷疑密碼外流」，
  // 這時候所有既有 session 都該作廢，不然改了密碼，對方手上的 session 照樣能用。
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      if (!(await claimEmailCooldown("reset-password", user.email))) return;
      await deliver(user.email, resetPasswordEmail(url));
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Always show Google's account chooser instead of silently reusing the
      // browser's only signed-in session — users may have multiple accounts.
      prompt: "select_account",
      // 每次登入都把 Google 的 name / image 寫回 user 表。
      //
      // 不開的話，better-auth 只在「這筆 user 是 Google 建的」那一刻寫過一次
      // profile：先用密碼帳號（scripts/create-user.ts）開出來、之後才接上 Google
      // 的人，user.image 會永遠是 null——側邊欄因此只剩名字首字母，看起來像頭像
      // 壞掉。開了之後那些帳號會在下一次登入自動補上，換過大頭貼的人也跟著更新。
      //
      // 覆蓋的範圍只有 provider 回傳的欄位：email 是配對用的鍵、不會被改寫，
      // emailVerified 只會從 false 升成 true（better-auth oauth2/link-account）。
      // name 一定有值（登入用的 scope 本來就含 profile），而站內沒有任何地方能改
      // 自己的 name / image，所以這裡不會蓋掉使用者自己設定過的東西。
      //
      // 刻意只對 Google 開：SSO 那邊的同一個開關是存在 sso_provider 的 oidc_config
      // 裡（plugin 的 defaultOverrideUserInfo 只在註冊當下生效，動不到已註冊的
      // provider），而且任意 IdP 少給 name 時 better-auth 會用空字串覆蓋，
      // 反而會把名字洗掉。要對某個 SSO provider 開，改那筆 provider 的設定。
      overrideUserInfoOnSignIn: true,
    },
  },
  // ---------------------------------------------------------------------
  // SSO 網域：禁止自助註冊、禁止自助重設密碼
  // ---------------------------------------------------------------------
  // email 網域有（已驗證的）SSO provider 的人，帳號生命週期歸客戶的 IdP 管：
  // 離職的人在 IdP 被停權，就該進不來。讓他們自己用 email 註冊或重設出一組密碼，
  // 等於在 IdP 之外開了一扇 IdP 關不掉的門。
  //
  // 這裡擋「發信」那一步（JSON API，前端看 error.code 顯示「請改用公司 SSO」）。
  // 一般流程裡註冊頁會先做 SSO 查詢、直接導去 IdP，根本不會打到這兩支；這層是給
  // 直接打 API、或 SSO 查詢那一下剛好失敗的情況。建立 user 那一步另外在
  // databaseHooks.user.create 擋（涵蓋 Google 第一次登入）。
  //
  // hooks.before 在 endpoint 的 body 驗證之前跑，ctx.body.email 可能不是字串，
  // isSsoDomain 自己會處理。
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/magic-link" && ctx.path !== "/request-password-reset") return;
      if (await isSsoDomain(ctx.body?.email)) throw ssoRequiredError();
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // 建立 user 的最後一道關卡：SSO 網域的人只能由 SSO 建立。
        //
        // 擋到的路徑：Google 第一次登入（/callback/:id）與 magic link 註冊
        // （/magic-link/verify；正常情況在發信時就被上面的 hooks 擋了，這裡是
        // 「信寄出後網域才註冊 SSO」的情況）。Google 被擋時，瀏覽器會被導回
        // 登入頁的 errorCallbackURL 並帶 ?error=SSO_REQUIRED（見 SSO_REQUIRED 的註解），
        // 登入頁顯示「請改用公司 SSO」。magic link 被擋時是 /magic-link/verify
        // 直接回 403 JSON——那條路只在上述的時間差裡才會發生，不另外做畫面。
        //
        // 放行的情況：
        // - 沒有 endpoint context：伺服器端直接呼叫 internalAdapter，例如
        //   scripts/create-user.ts。能跑那支腳本的人本來就能直接寫 DB。
        // - ctx.path 以 /sso/ 開頭：SSO 的 OIDC callback（/sso/callback/:providerId）
        //   與 SAML ACS 本身，就是我們要他們走的那條路。
        //
        // ⚠️ 只擋「新建」，不動既有帳號：已經用 Google 或密碼登入過的 SSO 網域使用者
        // 照樣能用原本的方式登入。要把既有帳號也強制導去 SSO（擋 /sign-in/email、
        // Google callback 的既有 user）是刻意留到之後的另一件事——那會直接把現在
        // 正在用的人關在門外，需要先跟客戶對好切換時間。
        before: async (user, ctx) => {
          if (!ctx || ctx.path.startsWith("/sso/")) return;
          if (await isSsoDomain(user.email)) throw ssoRequiredError();
        },
      },
    },
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
    // 企業 SSO（OIDC）。登入頁做的是 home realm discovery：使用者只填 email，
    // plugin 用 email 的網域去對 sso_provider.domain，找到就導去該 IdP。
    // 沒有任何網域寫死在程式裡 —— 要支援哪個客戶／哪個 IdP 全看 DB 裡註冊了什麼。
    //
    // providersLimit: 0 是 plugin 內建的關閉開關（見 @better-auth/sso 的
    // registerSSOProvider：limit 為 0 時直接 403）。它與下面的 disabledPaths
    // 是兩層互相獨立的防線，理由見 disabledPaths 的註解。
    //
    // 刻意不設 organizationProvisioning：第一次 SSO 登入會自動建 user
    // （implicit signup，這是我們要的），但要進哪個組織仍走既有的邀請流程。
    // domainVerification 是 OIDC callback 的信任開關：開了之後 plugin 會讀
    // sso_provider.domain_verified，「已驗證網域的 provider + email 網域相符」
    // 才算 trusted provider，better-auth 才肯把 SSO 登入 link 到既有的同 email
    // user（例如先用 Google 登入過的員工）。不開的話 link 一律被拒，走 SSO 的
    // 老用戶會拿到 ?error=UNKNOWN（2026-08-28 實際發生過）。我們不用它附帶的
    // DNS TXT 驗證流程 —— 註冊走腳本、domain_verified 由腳本直接寫 true。
    sso({ providersLimit: 0, domainVerification: { enabled: true } }),
    // 公開註冊（/signup）：email 先驗證、再設密碼。理由見上面 emailAndPassword 的註解。
    //
    // 不設 disableSignUp：magic link 點下去時 email 不存在就建 user，這**就是**
    // 公開註冊。註冊頁送出 newUserCallbackURL=/signup/password，新 user 會被帶去
    // 設密碼；既有 user 走 callbackURL 直接登入。
    //
    // storeToken "hashed"：verification 表裡只存 token 的 SHA-256，DB 外流或被
    // 唯讀查到時，拿到的值點不開任何人的帳號。
    //
    // sendMagicLink 依「這個 email 有沒有帳號」挑信的內容：註冊頁對兩種情況一律
    // 顯示同一個「請去收信」畫面（不洩漏帳號存在與否），所以「你已經有帳號了，這個
    // 連結會直接登入」只能寫在信裡。冷卻中（同地址 60 秒內）就默默不寄。
    magicLink({
      expiresIn: 15 * 60,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        if (!(await claimEmailCooldown("magic-link", email))) return;
        const message = (await userExists(email)) ? signInLinkEmail(url) : completeSignupEmail(url);
        await deliver(email, message);
      },
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
  // ---------------------------------------------------------------------
  // SSO provider 註冊：從 HTTP 一律封死
  // ---------------------------------------------------------------------
  // @better-auth/sso 的 /sso/register 只掛了 sessionMiddleware —— 也就是說
  // **任何一個登入中的一般使用者**都能註冊一個 IdP。那等於把「誰可以簽發本站身分」
  // 的權力交給每個員工：註冊一個自己控制的 IdP、宣告 domain 是某個還沒有人用過的
  // 網域，就能用它變出新帳號。organizationId 那段的 owner/admin 檢查只在有帶
  // organizationId 時才跑，不帶就完全繞過。
  //
  // disabledPaths 在 router 的 onRequest 生效（better-auth/dist/api：命中就直接
  // 回 404），**只擋 HTTP**；伺服器端直接呼叫 endpoint 函式不經過 router，所以
  // 這不影響部署流程。註冊一律走 scripts/register-sso-provider.ts，那支只有能拿到
  // DATABASE_URL 的人跑得動。
  //
  // 為什麼與 sso({ providersLimit: 0 }) 兩層都要：providersLimit 擋的是 handler
  // 內部（連伺服器端呼叫也一起擋），disabledPaths 擋的是路由層。任何一邊被未來的
  // 版本改掉或不小心拿掉，另一邊還在。
  //
  // update / delete 沒有列進來：那兩支走 checkProviderAccess，只有 provider 的
  // 擁有者（或該組織的 owner/admin）過得去，而擁有者只可能由上面那支腳本產生。
  disabledPaths: ["/sso/register"],
});
