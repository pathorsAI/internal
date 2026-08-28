-- 0020: 企業 SSO（@better-auth/sso plugin）。
--
-- 目的：讓客戶／自架者用自己的 IdP 登入，不必人人都有 Google 帳號。登入頁做的是
-- home realm discovery —— 使用者只填 email，plugin 拿 email 的網域比對下面這張表的
-- `domain` 欄，命中就導去對應的 IdP。所以「支援哪些網域」是資料，不是程式。
--
-- 欄位表照抄 plugin 自己的 schema 宣告（`sso()` 回傳值的 schema.ssoProvider.fields），
-- 沒有多加也沒有少放。plugin 沒有為這個 model 宣告 created_at / updated_at，這裡也就
-- 沒有 —— 加了 better-auth 也不會去寫它。`domain_verified` 只在 plugin 開啟
-- `domainVerification` 時才屬於 schema，本專案沒開，故不建。
--
-- Forward-only, additive. Run AFTER 0019_contract_billing_plan.sql.
-- "user" 是保留字，故加引號（與其他 auth 表一致）。
--
-- ⚠️ 這張表**沒有**對應的 HTTP 寫入口。plugin 的 POST /sso/register 只掛
-- sessionMiddleware，任何登入中的使用者都能註冊 IdP，等於把「誰能簽發本站身分」
-- 交出去，所以 src/lib/auth.ts 用 disabledPaths + providersLimit: 0 兩層把它封死。
-- 註冊一律走 scripts/register-sso-provider.ts（需要 DATABASE_URL）。詳見 docs/sso.md。

CREATE TABLE sso_provider (
  id              text PRIMARY KEY,
  -- IdP 的 OIDC issuer。Cloudflare Access for SaaS 長這樣：
  -- https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>
  issuer          text NOT NULL,
  -- 整包 OIDC 設定（endpoints、clientId、clientSecret、scopes…）序列化成 JSON
  -- 字串存一欄。這是 plugin 的形狀 —— 它自己 JSON.parse 回來用。
  oidc_config     text,
  -- SAML 走同一張表的另一欄。本專案目前只註冊 OIDC provider。
  saml_config     text,
  -- 註冊這個 provider 的人。腳本註冊時填「以誰的名義」，也決定了誰能改／刪它
  -- （plugin 的 update/delete 走 checkProviderAccess，比對的就是這一欄）。
  user_id         text REFERENCES "user"(id) ON DELETE CASCADE,
  -- 對外可見的 provider 代號，也是 callback 路徑的一段：
  -- /api/auth/sso/callback/<provider_id>
  provider_id     text NOT NULL UNIQUE,
  -- 綁定組織（選填）。本次不做組織自動配置，登入後仍走既有的邀請流程。
  organization_id text,
  -- home realm discovery 的鍵：email 的網域比對這一欄。
  domain          text NOT NULL
);

-- 每次 SSO 登入都會用網域查一次；plugin 找不到精確相符時才會全表掃描做子網域比對。
CREATE INDEX idx_sso_provider_domain ON sso_provider(domain);
CREATE INDEX idx_sso_provider_user   ON sso_provider(user_id);
