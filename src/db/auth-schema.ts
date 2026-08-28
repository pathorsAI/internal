// better-auth tables (email/password + organization plugin).
// Hand-maintained to match better-auth's expected schema — do NOT overwrite
// with `db:pull` (that command owns ./schema.ts only).
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").default("member").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  teamId: text("team_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- better-auth `mcp` plugin (OAuth 2.0 / OIDC provider for MCP clients) ----
// Property names mirror the field names better-auth expects; columns are
// snake_case to match the rest of the DB. See migrations/0006_mcp_oauth.sql.

export const oauthApplication = pgTable("oauth_application", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  metadata: text("metadata"),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  redirectUrls: text("redirect_urls").notNull(),
  type: text("type").notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const oauthAccessToken = pgTable("oauth_access_token", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull().unique(),
  refreshToken: text("refresh_token").notNull().unique(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  scopes: text("scopes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const oauthConsent = pgTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  scopes: text("scopes"),
  consentGiven: boolean("consent_given").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---- @better-auth/sso plugin (enterprise SSO / home-realm discovery) ----
// 欄位表照抄 plugin 自己的 schema 宣告（`sso()` 回傳值的
// schema.ssoProvider.fields）：issuer / oidcConfig / samlConfig / userId /
// providerId / organizationId / domain。plugin 沒有為這個 model 宣告
// createdAt / updatedAt，所以這裡也沒有。
//
// `domainVerified` 隨 plugin 的 `domainVerification` 選項存在（auth.ts 有開）。
// 它是 OIDC callback 信任判斷的唯一依據：provider.domainVerified === true 且
// email 網域與 provider.domain 相符，才允許把這次 SSO 登入 link 到既有的同
// email user（better-auth link-account 的 isTrustedProvider）。少了它，已用
// Google 登入過的人走 SSO 會被拒絕連結，整個 callback 以 ?error=UNKNOWN 收場
// —— 2026-08-28 上線當天就踩到。
//
// export 名稱必須正好是 `ssoProvider`：drizzle adapter 用 model 名稱去 schema
// 物件上取表。DB 表名照本專案慣例用 snake_case，見 migrations/0020_sso_provider.sql。
export const ssoProvider = pgTable("sso_provider", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  // 整包 OIDC 設定（含 clientSecret）序列化成 JSON 字串塞一欄 —— 這是 plugin 的
  // 形狀，不是我們的選擇。
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull().unique(),
  organizationId: text("organization_id"),
  // home realm discovery 的鍵：登入時拿 email 的網域來比對這一欄。
  domain: text("domain").notNull(),
  // 我們沒有走 plugin 的 DNS TXT 驗證流程（HTTP 註冊整條封死了）；這欄由
  // scripts/register-sso-provider.ts 在註冊時直接寫 true —— 管理者用腳本註冊
  // 就是驗證。migration: 0021_sso_domain_verified.sql。
  domainVerified: boolean("domain_verified").notNull().default(false),
});
