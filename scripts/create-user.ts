/**
 * 建立一個 email + 密碼帳號（伺服器端專用）。
 *
 * 為什麼需要這支腳本：src/lib/auth.ts 把 `emailAndPassword.disableSignUp` 設成
 * true，也就是 HTTP 上的 POST /api/auth/sign-up/email 一律拒絕。理由寫在那裡
 * ——公開的密碼註冊會開出帳號預劫持的路。所以密碼帳號只能由能拿到 DATABASE_URL
 * 的人在伺服器端開，也就是這支腳本。
 *
 * 它為什麼繞得過 disableSignUp：那個開關只在 /sign-up/email 這條 route 裡被檢查，
 * 不在資料層。這支腳本走的是 `auth.$context` 底下的 internalAdapter —— 與
 * better-auth 官方 admin plugin 的 createUser 完全同一條路徑（見
 * better-auth/dist/plugins/admin/routes.mjs：createUser → password.hash →
 * linkAccount，providerId "credential"），只是少了 HTTP 那一層。
 *
 * 用法（本機，對 dev DB）：
 *   bun scripts/create-user.ts --email reviewer@example.com \
 *     --password 'a-long-passphrase' --name 'Directory Reviewer'
 *
 *   加上 --org 讓他直接成為某個組織的成員（不必再走邀請流程）：
 *   bun scripts/create-user.ts --email reviewer@example.com \
 *     --password 'a-long-passphrase' --name 'Directory Reviewer' \
 *     --org my-org-slug --role admin
 *
 * bun 會自動讀取 .env.local，所以 DATABASE_URL / BETTER_AUTH_SECRET 不必另外帶。
 * 要指定別的環境檔就用 `bun --env-file=.dev.vars scripts/create-user.ts …`。
 *
 * ⚠️ 密碼會出現在 shell 歷史裡。正式用途請改用 `--password "$(read -rs …)"`
 * 之類的方式，或把它放進環境變數 CREATE_USER_PASSWORD（本腳本也讀這個）。
 */
import { parseArgs } from "node:util";
import { auth } from "@/lib/auth";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
    org: { type: "string" },
    role: { type: "string", default: "member" },
  },
});

const email = values.email?.trim().toLowerCase();
const password = values.password ?? process.env.CREATE_USER_PASSWORD;
const name = values.name?.trim();
const orgSlug = values.org?.trim();
const role = values.role ?? "member";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!email) fail("--email is required");
if (!password) fail("--password (or CREATE_USER_PASSWORD) is required");
if (!name) fail("--name is required");
if (!["owner", "admin", "member"].includes(role)) {
  fail(`--role must be one of owner | admin | member (got "${role}")`);
}

const ctx = await auth.$context;

// 長度限制從 auth 設定本身讀，不要在這裡再寫一個數字 —— 兩邊各寫一份，遲早會不一致，
// 而且不一致的方向會是「腳本開得出登入頁拒絕的帳號」。
const minLength = ctx.password.config.minPasswordLength;
if (password.length < minLength) {
  fail(`password must be at least ${minLength} characters (got ${password.length})`);
}

if (await ctx.internalAdapter.findUserByEmail(email)) {
  fail(`a user with email ${email} already exists`);
}

// 先找組織，再建 user：找不到組織就早一點失敗，不要留下一個半成品帳號。
let organizationId: string | null = null;
if (orgSlug) {
  const org = await ctx.adapter.findOne<{ id: string; name: string }>({
    model: "organization",
    where: [{ field: "slug", value: orgSlug }],
  });
  if (!org) fail(`no organization with slug "${orgSlug}"`);
  organizationId = org.id;
}

const user = await ctx.internalAdapter.createUser({
  email,
  name,
  // 這個帳號是人工開的，email 由開帳號的人背書 —— 系統裡不該留下一個「永遠等不到
  // 驗證信」的未驗證狀態。也讓之後同一個人改用 Google 登入時能正常連到同一個 user。
  emailVerified: true,
});

// providerId 必須正好是 "credential"：better-auth 的密碼登入就是照這個字串去
// account 表找那一列的 password 欄。accountId 用 user.id，與 admin plugin 一致。
await ctx.internalAdapter.linkAccount({
  accountId: user.id,
  providerId: "credential",
  userId: user.id,
  password: await ctx.password.hash(password),
});

console.log(`✓ created user ${user.email} (id ${user.id}, name "${user.name}")`);
console.log("  sign-in method: email + password (account.provider_id = 'credential')");

if (organizationId) {
  await ctx.adapter.create({
    model: "member",
    data: {
      organizationId,
      userId: user.id,
      role,
      createdAt: new Date(),
    },
  });
  console.log(`✓ added as "${role}" of organization ${orgSlug} (id ${organizationId})`);
} else {
  console.log("  no --org given: they will land on /onboarding until they join an org");
}
