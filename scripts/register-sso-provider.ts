/**
 * 註冊一個 OIDC 的 SSO provider（伺服器端專用）。
 *
 * 為什麼是腳本而不是後台頁面：@better-auth/sso 的 POST /sso/register 只掛了
 * sessionMiddleware —— 任何一個登入中的一般使用者都能註冊一個他自己控制的 IdP，
 * 等於把「誰能簽發本站身分」的權力交出去。src/lib/auth.ts 因此用
 * `disabledPaths: ["/sso/register"]` + `sso({ providersLimit: 0 })` 兩層把那條
 * route 封死，註冊只留這一條需要 DATABASE_URL 的路徑。
 *
 * disabledPaths 只在 HTTP router 的 onRequest 生效，所以「封死 HTTP」與「腳本
 * 仍能寫入」並不衝突；本腳本直接走 adapter 寫 ssoProvider，寫進去的欄位與
 * /sso/register 成功時寫的完全一致（見 @better-auth/sso 的 buildOIDCConfig）。
 *
 * 用法（本機，對 dev DB）：
 *   bun scripts/register-sso-provider.ts \
 *     --provider-id acme \
 *     --domain acme.com \
 *     --issuer "$SSO_ISSUER" \
 *     --client-id "$SSO_CLIENT_ID" \
 *     --client-secret "$SSO_CLIENT_SECRET"
 *
 * 每個參數也都能改用環境變數帶（SSO_PROVIDER_ID / SSO_DOMAIN / SSO_ISSUER /
 * SSO_CLIENT_ID / SSO_CLIENT_SECRET）—— client secret 建議走這條，不要留在
 * shell 歷史裡。bun 會自動讀 .env.local。
 *
 * ── Cloudflare Access for SaaS（OIDC）的對應關係 ────────────────────────────
 * 在 Zero Trust → Access → Applications 建一個 SaaS 應用、type 選 OIDC，建完後
 * Cloudflare 會給三個值：
 *
 *   Cloudflare 給的                     這支腳本的參數
 *   ─────────────────────────────────   ──────────────────
 *   Client ID                           --client-id
 *   Client secret                       --client-secret
 *   Issuer / "Public key / OIDC issuer" --issuer
 *
 * issuer 長這樣（<client-id> 就是上面那個 Client ID）：
 *   https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>
 * discovery 文件在 <issuer>/.well-known/openid-configuration，本腳本會去抓它把
 * 各個 endpoint 寫進 DB —— 這樣之後每次登入都不必再連 discovery。
 *
 * 反過來，Cloudflare 那邊的 Redirect URL 要填本站的 SSO callback：
 *   <BETTER_AUTH_URL>/api/auth/sso/callback/<provider-id>
 * 腳本跑完會把這個網址印出來。完整步驟見 docs/sso.md。
 */
import { parseArgs } from "node:util";
import { DiscoveryError, discoverOIDCConfig } from "@better-auth/sso";
import { auth } from "@/lib/auth";

const { values } = parseArgs({
  options: {
    "provider-id": { type: "string" },
    domain: { type: "string" },
    issuer: { type: "string" },
    "client-id": { type: "string" },
    "client-secret": { type: "string" },
    // 這個 provider 的擁有者（email）。給了才有人能透過 HTTP 的
    // /sso/update-provider、/sso/delete-provider 管它；不給就是純腳本管理。
    "owner-email": { type: "string" },
    org: { type: "string" },
    scopes: { type: "string", default: "openid,email,profile" },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const providerId = (values["provider-id"] ?? process.env.SSO_PROVIDER_ID)?.trim();
const domain = (values.domain ?? process.env.SSO_DOMAIN)?.trim().toLowerCase();
const issuer = (values.issuer ?? process.env.SSO_ISSUER)?.trim();
const clientId = (values["client-id"] ?? process.env.SSO_CLIENT_ID)?.trim();
const clientSecret = values["client-secret"] ?? process.env.SSO_CLIENT_SECRET;
const ownerEmail = values["owner-email"]?.trim().toLowerCase();
const orgSlug = values.org?.trim();
const scopes = (values.scopes ?? "openid,email,profile")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!providerId) fail("--provider-id (or SSO_PROVIDER_ID) is required");
if (!domain) fail("--domain (or SSO_DOMAIN) is required");
if (!issuer) fail("--issuer (or SSO_ISSUER) is required");
if (!clientId) fail("--client-id (or SSO_CLIENT_ID) is required");
if (!clientSecret) fail("--client-secret (or SSO_CLIENT_SECRET) is required");

let issuerOrigin: string;
try {
  issuerOrigin = new URL(issuer).origin;
} catch {
  fail(`--issuer must be an absolute URL (got "${issuer}")`);
}

const ctx = await auth.$context;

if (await ctx.adapter.findOne({ model: "ssoProvider", where: [{ field: "providerId", value: providerId }] })) {
  fail(`an SSO provider with providerId "${providerId}" already exists`);
}
if (await ctx.adapter.findOne({ model: "ssoProvider", where: [{ field: "domain", value: domain }] })) {
  fail(`an SSO provider is already registered for domain "${domain}"`);
}

let userId: string | null = null;
if (ownerEmail) {
  const found = await ctx.internalAdapter.findUserByEmail(ownerEmail);
  if (!found) fail(`no user with email ${ownerEmail} — have them sign in once first`);
  userId = found.user.id;
}

let organizationId: string | null = null;
if (orgSlug) {
  const org = await ctx.adapter.findOne<{ id: string }>({
    model: "organization",
    where: [{ field: "slug", value: orgSlug }],
  });
  if (!org) fail(`no organization with slug "${orgSlug}"`);
  organizationId = org.id;
}

// 現在就把 discovery 文件抓下來、把 endpoints 存進 DB。這不只是省一次往返：
// @better-auth/sso 只有在存起來的設定缺 endpoint 時才會在登入當下重跑 discovery
// （needsRuntimeDiscovery），而那條路徑會拿本站的 trustedOrigins 去驗 IdP 的網址 ——
// 也就是說沒先水合的話，每加一個 IdP 都得改一次 trustedOrigins 才登得進去。
//
// isTrustedOrigin 這裡只信任 issuer 自己的 origin：discovery 文件是 IdP 給的，
// 不該讓它把 token / jwks endpoint 指到第三方主機（那是一條 SSRF + 憑證外流的路）。
// 操作者親手打進來的 issuer 才是這裡唯一的信任來源。
let discovered;
try {
  discovered = await discoverOIDCConfig({
    issuer,
    isTrustedOrigin: (url) => {
      try {
        return new URL(url).origin === issuerOrigin;
      } catch {
        return false;
      }
    },
  });
} catch (error) {
  if (error instanceof DiscoveryError) {
    fail(`OIDC discovery failed for ${issuer}: ${error.message}`);
  }
  throw error;
}

// 欄位與 /sso/register 成功時寫進去的完全一致（@better-auth/sso 的
// buildOIDCConfig，非 skipDiscovery 分支），plugin 讀回來時才不會少東西。
const oidcConfig = {
  issuer: discovered.issuer,
  clientId,
  clientSecret,
  authorizationEndpoint: discovered.authorizationEndpoint,
  tokenEndpoint: discovered.tokenEndpoint,
  tokenEndpointAuthentication: discovered.tokenEndpointAuthentication,
  jwksEndpoint: discovered.jwksEndpoint,
  userInfoEndpoint: discovered.userInfoEndpoint,
  discoveryEndpoint: discovered.discoveryEndpoint,
  pkce: true,
  scopes,
  overrideUserInfo: false,
};

await ctx.adapter.create({
  model: "ssoProvider",
  data: {
    issuer,
    domain,
    providerId,
    oidcConfig: JSON.stringify(oidcConfig),
    samlConfig: null,
    userId,
    organizationId,
    // 管理者用腳本註冊即視為已驗證網域（我們不用 plugin 的 DNS TXT 流程）。
    // 這是 OIDC callback 肯把 SSO 登入 link 到既有同 email user 的前提，
    // 見 migrations/0021_sso_domain_verified.sql。
    domainVerified: true,
  },
});

console.log(`✓ registered SSO provider "${providerId}" for domain ${domain}`);
console.log(`  issuer:        ${issuer}`);
console.log(`  authorization: ${discovered.authorizationEndpoint}`);
console.log(`  token:         ${discovered.tokenEndpoint}`);
console.log(`  jwks:          ${discovered.jwksEndpoint}`);
console.log(`  scopes:        ${scopes.join(" ")}`);
console.log(`  owner:         ${ownerEmail ?? "(none — script-managed only)"}`);
console.log(`  organization:  ${orgSlug ?? "(none)"}`);
console.log("");
console.log("Set this as the Redirect URL in the IdP:");
console.log(`  ${ctx.baseURL}/sso/callback/${providerId}`);
console.log("");
console.log(`Anyone with an @${domain} email can now use "Continue with SSO" on /login.`);
