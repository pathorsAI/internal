/**
 * 建立一個「資料齊全的示範工作區」，給目錄審核員（OpenAI Plugin Directory /
 * Anthropic connector directory）用。
 *
 * 為什麼需要這支腳本：兩邊的送審規則都要求附上一組審核帳號，而且那個帳號背後
 * 必須是一個「fully populated / fully featured demo account with sample data」的
 * 工作區 —— 空的工作區會讓 68 支 MCC 工具裡的大半回傳空陣列，審核員無從判斷這個
 * connector 到底能做什麼。這支腳本一次把每一個工具域都鋪上資料。
 *
 * 用法（先用 create-user.ts 開好審核帳號，再把他掛成新 org 的 owner）：
 *   bun scripts/create-user.ts --email reviewer@example.com \
 *     --password 'a-long-passphrase' --name 'Directory Reviewer'
 *   bun scripts/seed-demo-org.ts --owner-email reviewer@example.com --org-slug demo
 *
 * bun 會自動讀取 .env.local，所以 DATABASE_URL 不必另外帶。要指定別的環境檔就用
 * `bun --env-file=.dev.vars scripts/seed-demo-org.ts …`。
 *
 * 安全性質（刻意的設計，不要拿掉）：
 *   - 只會**新增**資料，而且每一列都帶著新建立的 organization_id。腳本從頭到尾
 *     不對既有資料下 UPDATE / DELETE。
 *   - 目標 slug 已經有 org 就直接中止，不會往既有的示範 org 裡再倒一份資料
 *     （那會讓看板出現兩倍的列，比空的還糟）。要再產一份就加 --force，它會改用
 *     demo-2 / demo-3 這種尾綴，仍然不碰既有的那一個。
 *
 * ⚠️ neon-http 沒有互動式交易（見 src/db/index.ts 與 auth.ts 的 transaction:false），
 * 所以中途失敗會留下一個半成品 org。錯誤訊息會印出它的 id 與 slug，砍掉重來即可。
 *
 * 資料一律是虛構的：公司名沿用 landing 頁的示範家族（Morningside Creative /
 * Verdant Biosciences …），統一編號用 DEMO0001 這種不可能與真實統編相撞的字串，
 * 身分證字號與薪轉帳號都是明顯的假值，金額取整數。
 */
import { parseArgs } from "node:util";
import { addDays, addMonths, format, startOfMonth } from "date-fns";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { splitGross } from "@/lib/vat";
import { organization } from "@/db/auth-schema";
import {
  accountReconciliations,
  activityLog,
  bankAccounts,
  billingItems,
  categories,
  contracts,
  documents,
  employees,
  invoices,
  parties,
  payrollItemTypes,
  payrollRuns,
  payslipItems,
  payslips,
  projects,
  subscriptionPeriods,
  subscriptions,
  transactions,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    "owner-email": { type: "string" },
    "org-slug": { type: "string", default: "demo" },
    "org-name": { type: "string", default: "Meridian Software Ltd. (Demo)" },
    force: { type: "boolean", default: false },
  },
});

const ownerEmail = values["owner-email"]?.trim().toLowerCase();
const requestedSlug = (values["org-slug"] ?? "demo").trim();
const orgName = (values["org-name"] ?? "").trim();
const force = values.force === true;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!ownerEmail) fail("--owner-email is required");
if (!requestedSlug) fail("--org-slug must not be empty");
if (!orgName) fail("--org-name must not be empty");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");

/**
 * 每一段都包一層，失敗時把「在做哪一段」帶進錯誤訊息 —— 這支腳本插入的表超過
 * 二十張，光看 Postgres 的 "violates foreign key constraint" 完全不知道是誰。
 */
async function section<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`while seeding ${label}: ${detail}`, { cause: e });
  }
}

// ---------------------------------------------------------------------------
// 日期工具：全部相對於「今天」算，讓示範資料永遠是「最近半年」而不會過期。
// ---------------------------------------------------------------------------

const TODAY = new Date();
const iso = (d: Date) => format(d, "yyyy-MM-dd");
/** n 天前 / 後（負數為前） */
const day = (n: number) => iso(addDays(TODAY, n));
/** 第 k 個月（0 = 本月）的 1 號 */
const monthStart = (k: number) => iso(startOfMonth(addMonths(TODAY, k)));
/** 第 k 個月的第 d 天 */
const monthDay = (k: number, d: number) => iso(addDays(startOfMonth(addMonths(TODAY, k)), d - 1));
/**
 * 第 k 個月的第 d 天，但絕不晚於今天。月初（1~4 號）跑這支腳本時，本月的固定支出
 * 若照原本的日子排會落在未來 —— 一筆「已經付掉」卻標著未來日期的交易看起來就是壞的。
 */
const pastMonthDay = (k: number, d: number) => {
  const target = monthDay(k, d);
  const today = iso(TODAY);
  if (target > today) return today;
  return target;
};
/** 日期字串 + n 天 */
const plus = (base: string, n: number) => iso(addDays(new Date(`${base}T00:00:00`), n));
/** numeric 欄位一律以字串寫入（drizzle 的 numeric 對應 string）。 */
const dec = (n: number) => n.toFixed(2);
const stamp = (n: number) => addDays(TODAY, n).toISOString();

// ---------------------------------------------------------------------------
// 名稱 → id 的查表：多列 INSERT ... RETURNING 的順序在 Postgres 上雖然與輸入
// 一致，但這裡刻意改用「回傳的名稱」對回去，之後有人插入中間一列也不會錯位。
// ---------------------------------------------------------------------------

type NamedRow = { id: number; name: string };
const byName = (rows: NamedRow[]) => new Map(rows.map((r) => [r.name, r.id]));

function pick(map: Map<string, number>, key: string): number {
  const id = map.get(key);
  if (id === undefined) throw new Error(`internal: seeded row "${key}" was not returned`);
  return id;
}

// ---------------------------------------------------------------------------
// 1. 找出審核帳號 + 建立 organization
// ---------------------------------------------------------------------------

const ctx = await auth.$context;
const db = getDb();

const owner = await ctx.internalAdapter.findUserByEmail(ownerEmail);
if (!owner) {
  fail(
    `no user with email ${ownerEmail}. Create the reviewer account first:\n` +
      `    bun scripts/create-user.ts --email ${ownerEmail} --password '<passphrase>' --name 'Directory Reviewer'`,
  );
}
const ownerUser = owner.user;

async function freeSlug(base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [taken] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  throw new Error(`could not find a free slug based on "${base}" after 99 tries`);
}

const [clash] = await db
  .select({ id: organization.id, name: organization.name })
  .from(organization)
  .where(eq(organization.slug, requestedSlug))
  .limit(1);

if (clash && !force) {
  fail(
    `an organization with slug "${requestedSlug}" already exists ("${clash.name}", id ${clash.id}).\n` +
      `  Refusing to seed into it — a second pass would double every row on the billing board.\n` +
      `  Re-run with --force to create a fresh org under a suffixed slug instead, or delete that org first.`,
  );
}

const slug = clash ? await freeSlug(requestedSlug) : requestedSlug;

const org = await section("organization", async () => {
  const created = await ctx.adapter.create<
    { name: string; slug: string; createdAt: Date; metadata: string },
    { id: string; name: string; slug: string }
  >({
    model: "organization",
    data: {
      name: orgName,
      slug,
      createdAt: new Date(),
      metadata: JSON.stringify({ demo: true, seededBy: "scripts/seed-demo-org.ts" }),
    },
  });
  return created;
});
const ORG = org.id;

await section("owner membership", async () => {
  await ctx.adapter.create({
    model: "member",
    data: { organizationId: ORG, userId: ownerUser.id, role: "owner", createdAt: new Date() },
  });
});

// 這之後每一列都帶 organizationId: ORG。
const scoped = { organizationId: ORG };

// ---------------------------------------------------------------------------
// 2. 會計科目 —— 「薪資費用」的名稱是硬條件：pay_employee_salary 與
//    mutations.ts 都靠這個字串找發薪科目，改名就會變成未分類支出。
// ---------------------------------------------------------------------------

const CATEGORY_DEFS: { name: string; kind: string }[] = [
  { name: "專案服務收入", kind: "income" },
  { name: "訂閱收入", kind: "income" },
  { name: "顧問收入", kind: "income" },
  { name: "外包成本", kind: "cogs" },
  { name: "雲端服務成本", kind: "cogs" },
  { name: "薪資費用", kind: "expense" },
  { name: "辦公室租金", kind: "expense" },
  { name: "軟體訂閱", kind: "expense" },
  { name: "差旅交通", kind: "expense" },
  { name: "行銷推廣", kind: "expense" },
  { name: "專業服務費", kind: "expense" },
  { name: "雜項支出", kind: "expense" },
  { name: "利息收入", kind: "non_operating" },
  { name: "匯兌損益", kind: "non_operating" },
  { name: "帳戶互轉", kind: "transfer" },
  { name: "股東往來", kind: "equity" },
];

const cat = await section("categories", async () =>
  byName(
    await db
      .insert(categories)
      .values(CATEGORY_DEFS.map((c) => ({ ...scoped, name: c.name, kind: c.kind, isActive: true })))
      .returning({ id: categories.id, name: categories.name }),
  ),
);

// ---------------------------------------------------------------------------
// 3. 銀行帳戶（混幣別；帳號尾碼是假的遮罩樣式，schema 沒有帳號欄位所以寫在名稱裡）
// ---------------------------------------------------------------------------

const ACCT_TWD = "Northgate Bank 台幣營運帳戶 (****4821)";
const ACCT_USD = "Northgate Bank 美金帳戶 (****7390)";
const ACCT_CASH = "零用金 Petty Cash";

const acct = await section("bank accounts", async () =>
  byName(
    await db
      .insert(bankAccounts)
      .values([
        { ...scoped, name: ACCT_TWD, kind: "bank", currency: "TWD", openingBalance: dec(1_250_000) },
        { ...scoped, name: ACCT_USD, kind: "bank", currency: "USD", openingBalance: dec(18_000) },
        { ...scoped, name: ACCT_CASH, kind: "cash", currency: "TWD", openingBalance: dec(20_000) },
      ])
      .returning({ id: bankAccounts.id, name: bankAccounts.name }),
  ),
);
const twdAcct = pick(acct, ACCT_TWD);
const usdAcct = pick(acct, ACCT_USD);
const cashAcct = pick(acct, ACCT_CASH);

// ---------------------------------------------------------------------------
// 4. 往來對象（客戶 / 廠商 / 政府機關）
//    統編一律用 DEMO000n —— 八碼但含字母，不可能撞到真實的統一編號。
//    聯絡信箱用 .example（RFC 2606 保留網域），不會寄到任何真實信箱。
// ---------------------------------------------------------------------------

type PartyDef = {
  name: string;
  label: string;
  taxId: string | null;
  currency: string;
  account: number | null;
  contact: string | null;
  typical: number | null;
};

const PARTY_DEFS: PartyDef[] = [
  { name: "Morningside Creative", label: "customer", taxId: "DEMO0001", currency: "TWD", account: twdAcct, contact: "ap@morningside.example", typical: 60_000 },
  { name: "Verdant Biosciences", label: "customer", taxId: "DEMO0002", currency: "TWD", account: twdAcct, contact: "finance@verdant.example", typical: 260_000 },
  { name: "Harborline Logistics", label: "customer", taxId: "DEMO0003", currency: "TWD", account: twdAcct, contact: "ap@harborline.example", typical: 480_000 },
  { name: "Cobalt Analytics Inc.", label: "customer", taxId: "DEMO0004", currency: "USD", account: usdAcct, contact: "billing@cobalt-analytics.example", typical: 15_000 },
  { name: "Lantern Health Co.", label: "customer", taxId: "DEMO0005", currency: "TWD", account: twdAcct, contact: "accounts@lanternhealth.example", typical: 45_000 },
  { name: "Kestrel Robotics", label: "customer", taxId: "DEMO0006", currency: "TWD", account: twdAcct, contact: "ap@kestrelrobotics.example", typical: 360_000 },
  { name: "Northgate Cloud Services", label: "vendor", taxId: "DEMO0007", currency: "USD", account: usdAcct, contact: "billing@northgatecloud.example", typical: 1_200 },
  { name: "Pinecrest Office Park", label: "vendor", taxId: "DEMO0008", currency: "TWD", account: twdAcct, contact: "leasing@pinecrest.example", typical: 45_000 },
  { name: "Fairweather CPA Office", label: "vendor", taxId: "DEMO0009", currency: "TWD", account: twdAcct, contact: "hello@fairweather-cpa.example", typical: 15_000 },
  { name: "Skyline Travel Agency", label: "vendor", taxId: "DEMO0010", currency: "TWD", account: twdAcct, contact: "corp@skylinetravel.example", typical: 6_000 },
  { name: "Brightfold Studio", label: "vendor", taxId: "DEMO0011", currency: "TWD", account: twdAcct, contact: "studio@brightfold.example", typical: 120_000 },
  { name: "Halcyon Supplies Co.", label: "vendor", taxId: "DEMO0012", currency: "TWD", account: cashAcct, contact: "orders@halcyonsupplies.example", typical: 3_500 },
  { name: "示範市稅捐稽徵處 (Demo City Tax Bureau)", label: "gov", taxId: null, currency: "TWD", account: null, contact: null, typical: null },
];

const party = await section("parties", async () =>
  byName(
    await db
      .insert(parties)
      .values(
        PARTY_DEFS.map((p) => ({
          ...scoped,
          name: p.name,
          label: p.label,
          taxId: p.taxId,
          defaultCurrency: p.currency,
          defaultAccountId: p.account,
          typicalAmount: p.typical == null ? null : dec(p.typical),
          contact: p.contact,
          note: "示範資料（fictional demo data）",
          isActive: true,
        })),
      )
      .returning({ id: parties.id, name: parties.name }),
  ),
);

const morningside = pick(party, "Morningside Creative");
const verdant = pick(party, "Verdant Biosciences");
const harborline = pick(party, "Harborline Logistics");
const cobalt = pick(party, "Cobalt Analytics Inc.");
const lantern = pick(party, "Lantern Health Co.");
const kestrel = pick(party, "Kestrel Robotics");
const northgateCloud = pick(party, "Northgate Cloud Services");
const pinecrest = pick(party, "Pinecrest Office Park");
const fairweather = pick(party, "Fairweather CPA Office");
const skyline = pick(party, "Skyline Travel Agency");
const brightfold = pick(party, "Brightfold Studio");
const halcyon = pick(party, "Halcyon Supplies Co.");

// ---------------------------------------------------------------------------
// 5. 專案
// ---------------------------------------------------------------------------

const PROJECT_DEFS = [
  { name: "Morningside 品牌官網改版", client: morningside, status: "active", description: "形象官網重新設計與前端實作。" },
  { name: "Verdant 數據儀表板", client: verdant, status: "active", description: "實驗數據儀表板與 API 串接。" },
  { name: "Harborline 排程系統導入", client: harborline, status: "active", description: "倉儲排程系統導入與教育訓練。" },
  { name: "Cobalt Analytics 平台整合", client: cobalt, status: "active", description: "跨區資料平台整合（USD 計價）。" },
  { name: "Lantern Health 試辦計畫", client: lantern, status: "archived", description: "已結案的三個月試辦計畫。" },
];

const project = await section("projects", async () =>
  byName(
    await db
      .insert(projects)
      .values(PROJECT_DEFS.map((p) => ({ ...scoped, name: p.name, clientPartyId: p.client, status: p.status, description: p.description })))
      .returning({ id: projects.id, name: projects.name }),
  ),
);

const projMorningside = pick(project, "Morningside 品牌官網改版");
const projVerdant = pick(project, "Verdant 數據儀表板");
const projHarborline = pick(project, "Harborline 排程系統導入");
const projCobalt = pick(project, "Cobalt Analytics 平台整合");
const projLantern = pick(project, "Lantern Health 試辦計畫");

// ---------------------------------------------------------------------------
// 6. 合約（狀態涵蓋 draft / active / completed；請款計畫涵蓋 single / installments）
// ---------------------------------------------------------------------------

type ContractDef = {
  title: string;
  customer: number;
  project: number | null;
  amount: number;
  currency: string;
  signed: string;
  start: string;
  end: string | null;
  terms: number | null;
  status: string;
  plan: string;
  count: number | null;
  split: string | null;
  interval: number;
};

const CONTRACT_DEFS: ContractDef[] = [
  { title: "品牌官網改版合約", customer: morningside, project: projMorningside, amount: 900_000, currency: "TWD", signed: day(-80), start: day(-75), end: day(45), terms: 30, status: "active", plan: "installments", count: 3, split: "30,40,30", interval: 2 },
  { title: "數據儀表板建置合約", customer: verdant, project: projVerdant, amount: 1_200_000, currency: "TWD", signed: day(-65), start: day(-60), end: day(60), terms: 45, status: "active", plan: "installments", count: 2, split: "50,50", interval: 2 },
  { title: "排程系統導入合約", customer: harborline, project: projHarborline, amount: 480_000, currency: "TWD", signed: day(-20), start: day(-12), end: day(90), terms: 45, status: "active", plan: "single", count: 1, split: null, interval: 1 },
  { title: "Analytics Platform Integration", customer: cobalt, project: projCobalt, amount: 60_000, currency: "USD", signed: day(-110), start: day(-100), end: day(200), terms: 30, status: "active", plan: "installments", count: 4, split: "25,25,25,25", interval: 3 },
  { title: "Lantern Health 試辦服務合約", customer: lantern, project: projLantern, amount: 150_000, currency: "TWD", signed: day(-160), start: day(-155), end: day(-70), terms: 30, status: "completed", plan: "single", count: 1, split: null, interval: 1 },
  { title: "Kestrel 平台導入合約（草稿）", customer: kestrel, project: null, amount: 750_000, currency: "TWD", signed: day(-4), start: day(20), end: day(200), terms: 30, status: "draft", plan: "installments", count: 3, split: "30,40,30", interval: 2 },
];

const contract = await section("contracts", async () => {
  const rows = await db
    .insert(contracts)
    .values(
      CONTRACT_DEFS.map((c) => ({
        ...scoped,
        customerPartyId: c.customer,
        projectId: c.project,
        title: c.title,
        amount: dec(c.amount),
        currency: c.currency,
        startDate: c.start,
        endDate: c.end,
        signedDate: c.signed,
        paymentTermsDays: c.terms,
        status: c.status,
        note: "示範資料（fictional demo data）",
        billingPlan: c.plan,
        installmentCount: c.count,
        installmentSplit: c.split,
        billingIntervalMonths: c.interval,
        dueRule: "signed_date",
        dueDay: null,
      })),
    )
    .returning({ id: contracts.id, title: contracts.title });
  return new Map(rows.map((r) => [r.title, r.id]));
});

const ctMorningside = pick(contract, "品牌官網改版合約");
const ctVerdant = pick(contract, "數據儀表板建置合約");
const ctHarborline = pick(contract, "排程系統導入合約");
const ctCobalt = pick(contract, "Analytics Platform Integration");
const ctLantern = pick(contract, "Lantern Health 試辦服務合約");

// ---------------------------------------------------------------------------
// 7. 請款項目（billing_items）
//
// 狀態不是存欄位、是 deriveBillingStatus() 由日期與已收金額推導出來的，所以這裡
// 的日期組合就是「看板上會看到什麼」的唯一控制點。刻意每一種狀態都湊出至少一列：
//   paid      應請款日在 90 天內且已收齊（更久以前的已收齊會被看板濾掉）
//   overdue   已請款且「請款日 + 月結天數」已過（合約 A 期中款：-40 + 30 = -10）
//   upcoming  應請款日還沒到
//   partial   收了一部分
//   due       應請款日已到但還沒請款
//   billed    已請款、期限未到
//   cancelled 不進看板，但 list_billing_status 之外的工具看得到
// ---------------------------------------------------------------------------

type BillingDef = {
  title: string;
  customer: number;
  contract: number | null;
  project: number | null;
  amount: number;
  currency: string;
  due: string | null;
  billed: string | null;
  paid: string | null;
  invoiced: string | null;
  needsInvoice: boolean;
  status: string;
  note: string | null;
};

const BILLING_DEFS: BillingDef[] = [
  { title: "官網改版 — 簽約金", customer: morningside, contract: ctMorningside, project: projMorningside, amount: 270_000, currency: "TWD", due: day(-75), billed: day(-75), paid: day(-64), invoiced: day(-74), needsInvoice: true, status: "paid", note: "已收齊" },
  { title: "官網改版 — 期中款", customer: morningside, contract: ctMorningside, project: projMorningside, amount: 360_000, currency: "TWD", due: day(-40), billed: day(-40), paid: null, invoiced: day(-39), needsInvoice: true, status: "billed", note: "月結 30 天已過期，待催收" },
  { title: "官網改版 — 尾款", customer: morningside, contract: ctMorningside, project: projMorningside, amount: 270_000, currency: "TWD", due: day(35), billed: null, paid: null, invoiced: null, needsInvoice: true, status: "scheduled", note: null },
  { title: "數據儀表板 — 首期款", customer: verdant, contract: ctVerdant, project: projVerdant, amount: 600_000, currency: "TWD", due: day(-60), billed: day(-58), paid: null, invoiced: day(-57), needsInvoice: true, status: "billed", note: "客戶分兩次匯款" },
  { title: "數據儀表板 — 尾款", customer: verdant, contract: ctVerdant, project: projVerdant, amount: 600_000, currency: "TWD", due: day(-3), billed: null, paid: null, invoiced: null, needsInvoice: true, status: "scheduled", note: "驗收完成，該請款了" },
  { title: "排程系統導入 — 全額", customer: harborline, contract: ctHarborline, project: projHarborline, amount: 480_000, currency: "TWD", due: day(-12), billed: day(-10), paid: null, invoiced: null, needsInvoice: true, status: "billed", note: "月結 45 天" },
  { title: "Analytics Platform — Q1", customer: cobalt, contract: ctCobalt, project: projCobalt, amount: 15_000, currency: "USD", due: day(-100), billed: day(-100), paid: day(-88), invoiced: day(-99), needsInvoice: true, status: "paid", note: null },
  { title: "Analytics Platform — Q2", customer: cobalt, contract: ctCobalt, project: projCobalt, amount: 15_000, currency: "USD", due: day(-8), billed: day(-6), paid: null, invoiced: day(-6), needsInvoice: true, status: "billed", note: null },
  { title: "Analytics Platform — Q3", customer: cobalt, contract: ctCobalt, project: projCobalt, amount: 15_000, currency: "USD", due: day(82), billed: null, paid: null, invoiced: null, needsInvoice: true, status: "scheduled", note: null },
  { title: "Analytics Platform — Q4", customer: cobalt, contract: ctCobalt, project: projCobalt, amount: 15_000, currency: "USD", due: day(174), billed: null, paid: null, invoiced: null, needsInvoice: true, status: "scheduled", note: null },
  { title: "試辦服務 — 全額", customer: lantern, contract: ctLantern, project: projLantern, amount: 150_000, currency: "TWD", due: day(-150), billed: day(-150), paid: day(-140), invoiced: day(-149), needsInvoice: true, status: "paid", note: "試辦計畫結案" },
  { title: "臨時請款 — 內容授權費", customer: lantern, contract: null, project: null, amount: 45_000, currency: "TWD", due: day(-20), billed: day(-18), paid: null, invoiced: day(-18), needsInvoice: true, status: "billed", note: "無合約的單筆請款" },
  { title: "臨時請款 — 教育訓練（已取消）", customer: kestrel, contract: null, project: null, amount: 30_000, currency: "TWD", due: day(20), billed: null, paid: null, invoiced: null, needsInvoice: false, status: "cancelled", note: "客戶延後，改期再開" },
];

const billing = await section("billing items", async () => {
  const rows = await db
    .insert(billingItems)
    .values(
      BILLING_DEFS.map((b) => ({
        ...scoped,
        customerPartyId: b.customer,
        contractId: b.contract,
        projectId: b.project,
        title: b.title,
        amount: dec(b.amount),
        currency: b.currency,
        dueDate: b.due,
        billedOn: b.billed,
        paidOn: b.paid,
        invoicedOn: b.invoiced,
        needsInvoice: b.needsInvoice,
        status: b.status,
        note: b.note,
      })),
    )
    .returning({ id: billingItems.id, title: billingItems.title });
  return new Map(rows.map((r) => [r.title, r.id]));
});

const biMorningsideSigning = pick(billing, "官網改版 — 簽約金");
const biVerdantFirst = pick(billing, "數據儀表板 — 首期款");
const biCobaltQ1 = pick(billing, "Analytics Platform — Q1");
const biLanternFull = pick(billing, "試辦服務 — 全額");
const biHarborlineFull = pick(billing, "排程系統導入 — 全額");

// ---------------------------------------------------------------------------
// 8. 訂閱 + 期別覆寫
//
// 訂閱的期別是即時算出來的（computeSubscriptionSchedule），不落地成資料列；
// subscription_periods 只記「人做了什麼」——覆寫金額、實際請款日、開票日。
// ---------------------------------------------------------------------------

const SUB_VERDANT = "Verdant 數據儀表板維運";
const SUB_KESTREL = "Kestrel Robotics 平台年費";
const SUB_COBALT = "Cobalt Analytics 平台訂閱";
const SUB_LANTERN = "Lantern Health 試用方案";
const SUB_MORNINGSIDE = "Morningside 網站維運";

const sub = await section("subscriptions", async () =>
  byName(
    await db
      .insert(subscriptions)
      .values([
        { ...scoped, customerPartyId: verdant, projectId: projVerdant, name: SUB_VERDANT, amount: dec(45_000), currency: "TWD", intervalMonths: 1, startDate: monthStart(-6), endDate: null, status: "active", note: "月繳維運合約" },
        { ...scoped, customerPartyId: kestrel, projectId: null, name: SUB_KESTREL, amount: dec(360_000), currency: "TWD", intervalMonths: 12, startDate: monthStart(-2), endDate: null, status: "active", note: "年繳平台授權" },
        { ...scoped, customerPartyId: cobalt, projectId: projCobalt, name: SUB_COBALT, amount: dec(2_500), currency: "USD", intervalMonths: 1, startDate: monthStart(-4), endDate: null, status: "active", note: "USD 月繳" },
        { ...scoped, customerPartyId: lantern, projectId: projLantern, name: SUB_LANTERN, amount: dec(12_000), currency: "TWD", intervalMonths: 1, startDate: monthStart(-9), endDate: monthStart(-6), status: "ended", note: "試用結束未續約" },
        { ...scoped, customerPartyId: morningside, projectId: projMorningside, name: SUB_MORNINGSIDE, amount: dec(18_000), currency: "TWD", intervalMonths: 3, startDate: monthStart(-5), endDate: null, status: "paused", note: "客戶要求暫停一季" },
      ])
      .returning({ id: subscriptions.id, name: subscriptions.name }),
  ),
);

const subVerdant = pick(sub, SUB_VERDANT);
const subKestrel = pick(sub, SUB_KESTREL);
const subCobalt = pick(sub, SUB_COBALT);
const subMorningside = pick(sub, SUB_MORNINGSIDE);

const subPeriodCount = await section("subscription periods", async () => {
  const rows = await db
    .insert(subscriptionPeriods)
    .values([
      // 過渡期只收半個月：expectedAmount 覆寫，對應的收款交易也只有 22,500。
      { ...scoped, subscriptionId: subVerdant, periodStart: monthStart(-5), expectedAmount: dec(22_500), dueDate: monthDay(-5, 10), billedOn: monthDay(-5, 3), invoicedOn: monthDay(-5, 3), note: "過渡期只收半個月" },
      // 上個月已請款、已開票，但錢還沒進來 → 看板上是 overdue。
      { ...scoped, subscriptionId: subVerdant, periodStart: monthStart(-1), expectedAmount: null, dueDate: monthDay(-1, 10), billedOn: monthDay(-1, 3), invoicedOn: monthDay(-1, 3), note: null },
      // 年費：已請款、期限還沒到 → 看板上是 billed。
      { ...scoped, subscriptionId: subKestrel, periodStart: monthStart(-2), expectedAmount: null, dueDate: day(15), billedOn: day(-2), invoicedOn: null, note: "年費請款單已寄出" },
      // 本期只記應請款日，不覆寫金額。
      { ...scoped, subscriptionId: subCobalt, periodStart: monthStart(0), expectedAmount: null, dueDate: monthDay(0, 10), billedOn: null, invoicedOn: null, note: null },
    ])
    .returning({ id: subscriptionPeriods.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 9. 員工（身分證字號與薪轉帳號都是明顯的假值；MCP 回傳前還會再遮罩一次）
// ---------------------------------------------------------------------------

type EmployeeDef = {
  name: string;
  type: string;
  nationalId: string;
  base: number;
  account: string;
  start: string;
  end: string | null;
  active: boolean;
  pension: boolean;
  email: string;
  phone: string;
};

const EMPLOYEE_DEFS: EmployeeDef[] = [
  { name: "陳品妤 (Chen Pin-Yu)", type: "full_time", nationalId: "A299000011", base: 68_000, account: "00000000010011", start: day(-780), end: null, active: true, pension: true, email: "pinyu@meridian-demo.example", phone: "02-0000-0011" },
  { name: "林承澔 (Lin Cheng-Hao)", type: "full_time", nationalId: "A199000022", base: 82_000, account: "00000000010022", start: day(-1100), end: null, active: true, pension: true, email: "chenghao@meridian-demo.example", phone: "02-0000-0022" },
  { name: "宋子昀 (Avery Sung)", type: "full_time", nationalId: "A299000033", base: 95_000, account: "00000000010033", start: day(-430), end: null, active: true, pension: true, email: "avery@meridian-demo.example", phone: "02-0000-0033" },
  { name: "黃思羽 (Huang Si-Yu)", type: "part_time", nationalId: "A299000044", base: 32_000, account: "00000000010044", start: day(-200), end: null, active: true, pension: false, email: "siyu@meridian-demo.example", phone: "02-0000-0044" },
  { name: "吳冠廷 (Wu Kuan-Ting)", type: "contractor", nationalId: "A199000055", base: 55_000, account: "00000000010055", start: day(-600), end: day(-60), active: false, pension: false, email: "kuanting@meridian-demo.example", phone: "02-0000-0055" },
];

const employee = await section("employees", async () =>
  byName(
    await db
      .insert(employees)
      .values(
        EMPLOYEE_DEFS.map((e) => ({
          ...scoped,
          name: e.name,
          nationalId: e.nationalId,
          employmentType: e.type,
          hasLaborInsurance: e.active,
          hasHealthInsurance: e.active,
          hasPension: e.pension,
          baseSalary: dec(e.base),
          laborInsuredSalary: dec(e.base),
          healthInsuredSalary: dec(e.base),
          salaryAccount: e.account,
          startDate: e.start,
          endDate: e.end,
          isActive: e.active,
          workEmail: e.email,
          personalEmail: null,
          phone: e.phone,
          note: "示範資料（fictional demo data）",
          userId: null,
        })),
      )
      .returning({ id: employees.id, name: employees.name }),
  ),
);

const PAYROLL_EMPLOYEES = EMPLOYEE_DEFS.filter((e) => e.active);

// ---------------------------------------------------------------------------
// 10. 發票（開立 / 取得 × valid / void / allowance × Simpany 各種同步狀態）
// ---------------------------------------------------------------------------

type InvoiceDef = {
  number: string;
  direction: string;
  date: string;
  party: number;
  partyName: string;
  taxId: string | null;
  gross: number;
  currency: string;
  status: string;
  external: string;
  externalRef: string | null;
  contract: number | null;
  billingItem: number | null;
  note: string | null;
};

const INVOICE_DEFS: InvoiceDef[] = [
  { number: "DM-2001", direction: "issued", date: day(-74), party: morningside, partyName: "Morningside Creative", taxId: "DEMO0001", gross: 270_000, currency: "TWD", status: "valid", external: "issued", externalRef: "SIM-DEMO-2001", contract: ctMorningside, billingItem: biMorningsideSigning, note: "簽約金發票" },
  { number: "DM-2002", direction: "issued", date: day(-57), party: verdant, partyName: "Verdant Biosciences", taxId: "DEMO0002", gross: 600_000, currency: "TWD", status: "valid", external: "issued", externalRef: "SIM-DEMO-2002", contract: ctVerdant, billingItem: biVerdantFirst, note: "首期款發票" },
  { number: "DM-2003", direction: "issued", date: day(-2), party: harborline, partyName: "Harborline Logistics", taxId: "DEMO0003", gross: 480_000, currency: "TWD", status: "valid", external: "pending", externalRef: null, contract: ctHarborline, billingItem: biHarborlineFull, note: "尚未在外部發票系統開立" },
  { number: "DM-2004", direction: "issued", date: day(-35), party: verdant, partyName: "Verdant Biosciences", taxId: "DEMO0002", gross: 45_000, currency: "TWD", status: "void", external: "void", externalRef: "SIM-DEMO-2004", contract: null, billingItem: null, note: "統編key錯，作廢重開" },
  { number: "DM-2005", direction: "issued", date: day(-25), party: morningside, partyName: "Morningside Creative", taxId: "DEMO0001", gross: 15_000, currency: "TWD", status: "allowance", external: "issued", externalRef: "SIM-DEMO-2005", contract: null, billingItem: null, note: "折讓單（範圍縮減）" },
  { number: "DM-2006", direction: "issued", date: day(-140), party: lantern, partyName: "Lantern Health Co.", taxId: "DEMO0005", gross: 150_000, currency: "TWD", status: "valid", external: "issued", externalRef: "SIM-DEMO-2006", contract: ctLantern, billingItem: biLanternFull, note: "試辦計畫結案發票" },
  { number: "DM-7001", direction: "received", date: day(-30), party: pinecrest, partyName: "Pinecrest Office Park", taxId: "DEMO0008", gross: 45_000, currency: "TWD", status: "valid", external: "n_a", externalRef: null, contract: null, billingItem: null, note: "辦公室租金進項" },
  { number: "DM-7002", direction: "received", date: day(-20), party: northgateCloud, partyName: "Northgate Cloud Services", taxId: "DEMO0007", gross: 1_200, currency: "USD", status: "valid", external: "n_a", externalRef: null, contract: null, billingItem: null, note: "境外雲端服務，無進項稅額" },
];

const invoice = await section("invoices", async () => {
  const rows = await db
    .insert(invoices)
    .values(
      INVOICE_DEFS.map((v) => {
        // 台灣營業稅 5%；外幣進項沒有可扣抵稅額，稅額記 0。
        const { net, tax } = v.currency === "TWD" ? splitGross(v.gross) : { net: v.gross, tax: 0 };
        return {
          ...scoped,
          direction: v.direction,
          invoiceNumber: v.number,
          invoiceDate: v.date,
          counterpartyName: v.partyName,
          counterpartyTaxId: v.taxId,
          amountNet: dec(net),
          tax: dec(tax),
          amountGross: dec(v.gross),
          currency: v.currency,
          status: v.status,
          note: v.note,
          partyId: v.party,
          contractId: v.contract,
          billingItemId: v.billingItem,
          externalStatus: v.external,
          externalRef: v.externalRef,
        };
      }),
    )
    .returning({ id: invoices.id, number: invoices.invoiceNumber });
  return new Map(rows.map((r) => [r.number ?? "", r.id]));
});

const invMorningsideSigning = pick(invoice, "DM-2001");
const invVerdantFirst = pick(invoice, "DM-2002");
const invRent = pick(invoice, "DM-7001");
const invCloud = pick(invoice, "DM-7002");

// ---------------------------------------------------------------------------
// 11. 交易
//
// 兩批：第一批是不需要回頭引用 id 的「帳本噪音」，第二批（下面）是要被
// payslips / documents / 撥款還代墊 指回來的少數幾筆，用不重複的 description 對回 id。
//
// 不變式（照 src/lib/account-currency.ts）：交易幣別必須等於它掛的銀行帳戶幣別。
// income → toAccountId；expense → fromAccountId；advance → 不掛帳戶；transfer → 兩腳。
// amount_twd 只在 TWD 時填，比照 create_transaction 與 mutations.ts 的行為。
// ---------------------------------------------------------------------------

type TxnDef = {
  type: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  category: string | null;
  party: number | null;
  from: number | null;
  to: number | null;
  book: string;
  project?: number | null;
  contract?: number | null;
  subscription?: number | null;
  period?: string | null;
  billingItem?: number | null;
  invoice?: number | null;
  employee?: number | null;
  related?: number | null;
  vat?: boolean;
};

function txnValues(t: TxnDef) {
  return {
    ...scoped,
    txnDate: t.date,
    description: t.description,
    categoryId: t.category == null ? null : pick(cat, t.category),
    amount: dec(t.amount),
    currency: t.currency,
    amountTwd: t.currency === "TWD" ? dec(t.amount) : null,
    fromAccountId: t.from,
    toAccountId: t.to,
    book: t.book,
    invoiceId: t.invoice ?? null,
    billedToCompanyTaxId: t.vat ?? false,
    partyId: t.party,
    settleEmployeeId: t.employee ?? null,
    relatedToId: t.related ?? null,
    type: t.type,
    projectId: t.project ?? null,
    contractId: t.contract ?? null,
    subscriptionId: t.subscription ?? null,
    subscriptionPeriod: t.period ?? null,
    billingItemId: t.billingItem ?? null,
  };
}

const bulkTxns: TxnDef[] = [
  // ---- 合約收款 ----
  { type: "income", date: day(-64), amount: 270_000, currency: "TWD", description: "官網改版簽約金", category: "專案服務收入", party: morningside, from: null, to: twdAcct, book: "both", project: projMorningside, contract: ctMorningside, billingItem: biMorningsideSigning, invoice: invMorningsideSigning },
  { type: "income", date: day(-45), amount: 250_000, currency: "TWD", description: "數據儀表板首期款（部分入帳）", category: "專案服務收入", party: verdant, from: null, to: twdAcct, book: "both", project: projVerdant, contract: ctVerdant, billingItem: biVerdantFirst, invoice: invVerdantFirst },
  { type: "income", date: day(-88), amount: 15_000, currency: "USD", description: "Analytics Platform Q1 payment", category: "專案服務收入", party: cobalt, from: null, to: usdAcct, book: "both", project: projCobalt, contract: ctCobalt, billingItem: biCobaltQ1 },
  { type: "income", date: day(-140), amount: 150_000, currency: "TWD", description: "Lantern Health 試辦計畫結案款", category: "專案服務收入", party: lantern, from: null, to: twdAcct, book: "both", project: projLantern, contract: ctLantern, billingItem: biLanternFull },

  // ---- 訂閱收款（掛到各自的期別）----
  ...[-6, -5, -4, -3, -2].map((k) => ({
    type: "income",
    date: monthDay(k, 8),
    amount: k === -5 ? 22_500 : 45_000,
    currency: "TWD",
    description: `${SUB_VERDANT} ${monthStart(k).slice(0, 7)} 月費`,
    category: "訂閱收入",
    party: verdant,
    from: null,
    to: twdAcct,
    book: "both",
    project: projVerdant,
    subscription: subVerdant,
    period: monthStart(k),
  })),
  ...[-4, -3, -2].map((k) => ({
    type: "income",
    date: monthDay(k, 6),
    amount: 2_500,
    currency: "USD",
    description: `${SUB_COBALT} ${monthStart(k).slice(0, 7)}`,
    category: "訂閱收入",
    party: cobalt,
    from: null,
    to: usdAcct,
    book: "both",
    project: projCobalt,
    subscription: subCobalt,
    period: monthStart(k),
  })),
  ...[-5, -2].map((k) => ({
    type: "income",
    date: monthDay(k, 12),
    amount: 18_000,
    currency: "TWD",
    description: `${SUB_MORNINGSIDE} ${monthStart(k).slice(0, 7)} 季費`,
    category: "訂閱收入",
    party: morningside,
    from: null,
    to: twdAcct,
    book: "both",
    project: projMorningside,
    subscription: subMorningside,
    period: monthStart(k),
  })),

  // ---- 其他收入（book=internal：只進內帳，沒有上外帳）----
  { type: "income", date: day(-30), amount: 60_000, currency: "TWD", description: "Harborline 顧問時數（未開發票）", category: "顧問收入", party: harborline, from: null, to: twdAcct, book: "internal", project: projHarborline },
  { type: "income", date: day(-15), amount: 850, currency: "TWD", description: "活存利息", category: "利息收入", party: null, from: null, to: twdAcct, book: "both" },

  // ---- 固定支出：房租（6 個月）----
  ...[-5, -4, -3, -2, -1, 0].map((k) => ({
    type: "expense",
    date: pastMonthDay(k, 5),
    amount: 45_000,
    currency: "TWD",
    description: `${monthStart(k).slice(0, 7)} 辦公室租金`,
    category: "辦公室租金",
    party: pinecrest,
    from: twdAcct,
    to: null,
    book: "both",
    vat: true,
    invoice: k === -1 ? invRent : null,
  })),

  // ---- 固定支出：雲端（USD，6 個月）----
  ...[-5, -4, -3, -2, -1, 0].map((k) => ({
    type: "expense",
    date: pastMonthDay(k, 3),
    amount: 1_200,
    currency: "USD",
    description: `${monthStart(k).slice(0, 7)} Northgate Cloud hosting`,
    category: "雲端服務成本",
    party: northgateCloud,
    from: usdAcct,
    to: null,
    book: "both",
    invoice: k === -1 ? invCloud : null,
  })),

  // ---- 其餘營運支出 ----
  { type: "expense", date: day(-95), amount: 8_500, currency: "TWD", description: "設計工具年費", category: "軟體訂閱", party: brightfold, from: twdAcct, to: null, book: "both", vat: true },
  { type: "expense", date: day(-55), amount: 8_500, currency: "TWD", description: "專案管理工具授權", category: "軟體訂閱", party: brightfold, from: twdAcct, to: null, book: "both", vat: true },
  { type: "expense", date: day(-70), amount: 120_000, currency: "TWD", description: "官網改版前端外包", category: "外包成本", party: brightfold, from: twdAcct, to: null, book: "both", project: projMorningside, contract: ctMorningside, vat: true },
  { type: "expense", date: day(-40), amount: 120_000, currency: "TWD", description: "儀表板圖表外包", category: "外包成本", party: brightfold, from: twdAcct, to: null, book: "both", project: projVerdant, contract: ctVerdant, vat: true },
  { type: "expense", date: day(-80), amount: 25_000, currency: "TWD", description: "產品說明會場地與素材", category: "行銷推廣", party: halcyon, from: twdAcct, to: null, book: "external" },
  { type: "expense", date: day(-25), amount: 25_000, currency: "TWD", description: "社群廣告投放", category: "行銷推廣", party: halcyon, from: twdAcct, to: null, book: "external" },
  { type: "expense", date: day(-100), amount: 15_000, currency: "TWD", description: "上期營業稅申報服務費", category: "專業服務費", party: fairweather, from: twdAcct, to: null, book: "both", vat: true },
  { type: "expense", date: day(-35), amount: 15_000, currency: "TWD", description: "本期營業稅申報服務費", category: "專業服務費", party: fairweather, from: twdAcct, to: null, book: "both", vat: true },
  { type: "expense", date: day(-18), amount: 3_500, currency: "TWD", description: "辦公室補給品", category: "雜項支出", party: halcyon, from: cashAcct, to: null, book: "internal" },
  { type: "expense", date: day(-6), amount: 3_500, currency: "TWD", description: "會議茶水與耗材", category: "雜項支出", party: halcyon, from: cashAcct, to: null, book: "internal" },

  // ---- 帳戶互轉（transfer 一律 book=both）----
  { type: "transfer", date: day(-60), amount: 100_000, currency: "TWD", description: "撥補零用金", category: "帳戶互轉", party: null, from: twdAcct, to: cashAcct, book: "both" },
  { type: "transfer", date: day(-10), amount: 50_000, currency: "TWD", description: "撥補零用金", category: "帳戶互轉", party: null, from: twdAcct, to: cashAcct, book: "both" },
];

const bulkTxnCount = await section("transactions (bulk)", async () => {
  const rows = await db
    .insert(transactions)
    .values(bulkTxns.map(txnValues))
    .returning({ id: transactions.id });
  return rows.length;
});

// 需要被回頭引用的交易：description 在這個 org 內唯一，用它對回 id。
const empIds = PAYROLL_EMPLOYEES.map((e) => ({ def: e, id: pick(employee, e.name) }));
const PAID_RUN_OFFSETS = [-2, -1];

const SALARY_DESC = (k: number, name: string) => `${monthStart(k).slice(0, 7)} 薪資 - ${name}`;
/**
 * 發薪日：當月 25 號（薪資月份本身，不是次月）。
 * 刻意不用「次月 5 號」——那樣在每個月的 1~4 號跑這支腳本時，最近一期「已發放」
 * 的薪資會帶著未來的日期，示範資料看起來就像壞掉的。
 */
const PAY_DAY = (k: number) => monthDay(k, 25);
const ADV_TRAVEL_DESC = "代墊：客戶拜訪計程車資";
const ADV_SUPPLY_DESC = "代墊：展場臨時採購";
const DOC_TAXI_DESC = "客戶拜訪車資（紙本收據）";
const DOC_MEAL_DESC = "專案結案聚餐（三聯式發票）";

/** 示範用的固定扣除額，湊出「應稅 / 免稅 / 各項扣除」都有的薪資單。 */
function deductions(base: number) {
  const labor = Math.round((base * 0.02) / 100) * 100;
  const health = Math.round((base * 0.015) / 100) * 100;
  const tax = Math.round((base * 0.03) / 100) * 100;
  return { labor, health, tax, total: labor + health + tax };
}
const MEAL_ALLOWANCE = 2_400;
function netPay(base: number): number {
  return base + MEAL_ALLOWANCE - deductions(base).total;
}

const trackedTxns: TxnDef[] = [
  // 發薪支出（每位在職員工 × 已發放的兩個月）
  ...PAID_RUN_OFFSETS.flatMap((k) =>
    empIds.map(({ def, id }) => ({
      type: "expense",
      date: PAY_DAY(k),
      amount: netPay(def.base),
      currency: "TWD",
      description: SALARY_DESC(k, def.name),
      category: "薪資費用",
      party: null,
      from: twdAcct,
      to: null,
      book: "both",
      employee: id,
    })),
  ),
  // 代墊（advance 不掛帳戶）：一筆未還、一筆下面會撥款
  { type: "advance", date: day(-9), amount: 3_800, currency: "TWD", description: ADV_TRAVEL_DESC, category: "差旅交通", party: skyline, from: null, to: null, book: "internal", employee: empIds[1].id },
  { type: "advance", date: day(-50), amount: 6_500, currency: "TWD", description: ADV_SUPPLY_DESC, category: "雜項支出", party: halcyon, from: null, to: null, book: "internal", employee: empIds[0].id },
  // 有紙本／三聯式發票要通知會計師的兩筆支出
  { type: "expense", date: day(-22), amount: 1_200, currency: "TWD", description: DOC_TAXI_DESC, category: "差旅交通", party: skyline, from: cashAcct, to: null, book: "both", vat: false },
  { type: "expense", date: day(-5), amount: 4_800, currency: "TWD", description: DOC_MEAL_DESC, category: "雜項支出", party: halcyon, from: cashAcct, to: null, book: "both", vat: true },
];

const tracked = await section("transactions (tracked)", async () => {
  const rows = await db
    .insert(transactions)
    .values(trackedTxns.map(txnValues))
    .returning({ id: transactions.id, description: transactions.description });
  return new Map(rows.map((r) => [r.description ?? "", r.id]));
});

const advSupplyId = pick(tracked, ADV_SUPPLY_DESC);

// 撥款還代墊：relatedToId 指回原代墊，所以必須等上一批拿到 id 之後才能插。
// 只還其中一筆 —— 另一筆留在 list_outstanding_advances 上。
const reimbursementCount = await section("reimbursement", async () => {
  const rows = await db
    .insert(transactions)
    .values(
      txnValues({
        type: "reimbursement",
        date: day(-44),
        amount: 6_500,
        currency: "TWD",
        description: "撥款還代墊",
        category: "雜項支出",
        party: null,
        from: twdAcct,
        to: null,
        book: "internal",
        employee: empIds[0].id,
        related: advSupplyId,
      }),
    )
    .returning({ id: transactions.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 12. 薪資：項目類型 → 薪資期別 → 薪資單 → 明細
// ---------------------------------------------------------------------------

const ITEM_BASE = "本薪";
const ITEM_MEAL = "伙食津貼";
const ITEM_LABOR = "勞保費";
const ITEM_HEALTH = "健保費";
const ITEM_TAX = "代扣所得稅";

const itemType = await section("payroll item types", async () =>
  byName(
    await db
      .insert(payrollItemTypes)
      .values([
        { ...scoped, name: ITEM_BASE, direction: "earning", isTaxable: true, isStatutory: false, note: null },
        { ...scoped, name: ITEM_MEAL, direction: "earning", isTaxable: false, isStatutory: false, note: "免稅上限內的伙食津貼" },
        { ...scoped, name: "加班費", direction: "earning", isTaxable: true, isStatutory: false, note: null },
        { ...scoped, name: ITEM_LABOR, direction: "deduction", isTaxable: false, isStatutory: true, note: null },
        { ...scoped, name: ITEM_HEALTH, direction: "deduction", isTaxable: false, isStatutory: true, note: null },
        { ...scoped, name: "勞退自提", direction: "deduction", isTaxable: false, isStatutory: true, note: null },
        { ...scoped, name: ITEM_TAX, direction: "deduction", isTaxable: false, isStatutory: true, note: null },
      ])
      .returning({ id: payrollItemTypes.id, name: payrollItemTypes.name }),
  ),
);

/** 薪資期別：前兩個月已發放（狀態 paid），本月還是草稿（未發放）。 */
const RUN_DEFS = [
  { offset: -2, status: "paid", note: "已完成發放" },
  { offset: -1, status: "paid", note: "已完成發放" },
  { offset: 0, status: "draft", note: "本月尚未發放" },
];

const run = await section("payroll runs", async () => {
  const rows = await db
    .insert(payrollRuns)
    .values(
      RUN_DEFS.map((r) => {
        const d = addMonths(TODAY, r.offset);
        return {
          ...scoped,
          periodYear: d.getFullYear(),
          periodMonth: d.getMonth() + 1,
          payDate: PAY_DAY(r.offset),
          status: r.status,
          note: r.note,
        };
      }),
    )
    .returning({ id: payrollRuns.id, periodYear: payrollRuns.periodYear, periodMonth: payrollRuns.periodMonth });
  return new Map(rows.map((r) => [`${r.periodYear}-${r.periodMonth}`, r.id]));
});

function runKey(offset: number): string {
  const d = addMonths(TODAY, offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

const payslipIds = await section("payslips", async () => {
  const values = RUN_DEFS.flatMap((r) =>
    empIds.map(({ def, id }) => {
      const d = deductions(def.base);
      const paidTxn = PAID_RUN_OFFSETS.includes(r.offset)
        ? (tracked.get(SALARY_DESC(r.offset, def.name)) ?? null)
        : null;
      return {
        payrollRunId: pick(run, runKey(r.offset)),
        employeeId: id,
        taxableTotal: dec(def.base),
        nontaxableTotal: dec(MEAL_ALLOWANCE),
        deductionTotal: dec(d.total),
        netPay: dec(netPay(def.base)),
        paidTransactionId: paidTxn,
        note: paidTxn ? null : "尚未發放",
      };
    }),
  );
  const rows = await db
    .insert(payslips)
    .values(values)
    .returning({ id: payslips.id, payrollRunId: payslips.payrollRunId, employeeId: payslips.employeeId });
  return new Map(rows.map((r) => [`${r.payrollRunId}:${r.employeeId}`, r.id]));
});

const payslipItemCount = await section("payslip items", async () => {
  const values = RUN_DEFS.flatMap((r) =>
    empIds.flatMap(({ def, id }) => {
      const slipId = payslipIds.get(`${pick(run, runKey(r.offset))}:${id}`);
      if (slipId === undefined) throw new Error(`internal: payslip for ${def.name} ${runKey(r.offset)} missing`);
      const d = deductions(def.base);
      return [
        { payslipId: slipId, itemTypeId: pick(itemType, ITEM_BASE), name: ITEM_BASE, direction: "earning", isTaxable: true, amount: dec(def.base), hours: null },
        { payslipId: slipId, itemTypeId: pick(itemType, ITEM_MEAL), name: ITEM_MEAL, direction: "earning", isTaxable: false, amount: dec(MEAL_ALLOWANCE), hours: null },
        { payslipId: slipId, itemTypeId: pick(itemType, ITEM_LABOR), name: ITEM_LABOR, direction: "deduction", isTaxable: false, amount: dec(d.labor), hours: null },
        { payslipId: slipId, itemTypeId: pick(itemType, ITEM_HEALTH), name: ITEM_HEALTH, direction: "deduction", isTaxable: false, amount: dec(d.health), hours: null },
        { payslipId: slipId, itemTypeId: pick(itemType, ITEM_TAX), name: ITEM_TAX, direction: "deduction", isTaxable: false, amount: dec(d.tax), hours: null },
      ];
    }),
  );
  const rows = await db.insert(payslipItems).values(values).returning({ id: payslipItems.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 13. 銀行對帳（每個帳戶 × 月底結存）
// ---------------------------------------------------------------------------

const reconciliationCount = await section("reconciliations", async () => {
  const lastMonthEnd = plus(monthStart(0), -1);
  const prevMonthEnd = plus(monthStart(-1), -1);
  const rows = await db
    .insert(accountReconciliations)
    .values([
      { ...scoped, accountId: twdAcct, asOfDate: lastMonthEnd, statementBalance: dec(1_486_500), note: "與銀行對帳單相符" },
      { ...scoped, accountId: twdAcct, asOfDate: prevMonthEnd, statementBalance: dec(1_312_000), note: "與銀行對帳單相符" },
      { ...scoped, accountId: usdAcct, asOfDate: lastMonthEnd, statementBalance: dec(23_400), note: "USD 帳戶月結" },
      { ...scoped, accountId: cashAcct, asOfDate: lastMonthEnd, statementBalance: dec(41_800), note: "零用金盤點，差異 0" },
    ])
    .returning({ id: accountReconciliations.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 14. 憑證：list_accountant_notices 看的是「invoice_kind = paper 且掛在交易上」的
//     documents —— 一筆待通知、一筆已通知。R2 裡沒有對應的實體檔案（示範資料只需要
//     metadata），note 有寫清楚，下載會 404 是預期行為。
// ---------------------------------------------------------------------------

const documentCount = await section("documents", async () => {
  const placeholder = "示範資料：僅有 metadata，R2 內沒有對應檔案。";
  const rows = await db
    .insert(documents)
    .values([
      { ...scoped, docType: "invoice", r2Key: `demo/${ORG}/paper-invoice-taxi.pdf`, fileName: "計程車收據.pdf", contentType: "application/pdf", sizeBytes: 48_120, transactionId: pick(tracked, DOC_TAXI_DESC), invoiceId: null, invoiceKind: "paper", accountantNotifiedAt: null, note: `待通知會計師。${placeholder}` },
      { ...scoped, docType: "invoice", r2Key: `demo/${ORG}/paper-invoice-meal.pdf`, fileName: "三聯式發票-結案聚餐.pdf", contentType: "application/pdf", sizeBytes: 61_540, transactionId: pick(tracked, DOC_MEAL_DESC), invoiceId: null, invoiceKind: "paper", accountantNotifiedAt: stamp(-2), note: `已通知會計師。${placeholder}` },
      { ...scoped, docType: "receipt", r2Key: `demo/${ORG}/electronic-invoice-rent.pdf`, fileName: "租金電子發票.pdf", contentType: "application/pdf", sizeBytes: 33_900, transactionId: null, invoiceId: invRent, invoiceKind: "electronic", accountantNotifiedAt: null, note: `電子發票，會計師自動看得到。${placeholder}` },
      { ...scoped, docType: "contract", r2Key: `demo/${ORG}/contract-morningside.pdf`, fileName: "品牌官網改版合約.pdf", contentType: "application/pdf", sizeBytes: 210_400, transactionId: null, invoiceId: null, invoiceKind: null, accountantNotifiedAt: null, note: placeholder },
    ])
    .returning({ id: documents.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 15. 操作紀錄
//
// 這支腳本是直接寫 DB 的，不會走到 logWeb / logMcp，所以 list_activity 預設會是空的。
// 補幾筆據實描述「這批資料是被 seed 出來的」紀錄，讓稽核頁不是空白，也不假裝有
// 沒發生過的操作。
// ---------------------------------------------------------------------------

const activityCount = await section("activity log", async () => {
  const entry = (entityType: string, entityId: number | null, summary: string, daysAgo: number) => ({
    ...scoped,
    actorUserId: ownerUser.id,
    actorEmail: ownerUser.email,
    actorName: ownerUser.name,
    channel: "web",
    action: "create",
    entityType,
    entityId,
    summary,
    createdAt: stamp(-daysAgo),
  });
  const rows = await db
    .insert(activityLog)
    .values([
      entry("category", pick(cat, "專案服務收入"), "建立會計科目（示範資料匯入）", 7),
      entry("bank_account", twdAcct, `建立帳戶「${ACCT_TWD}」（示範資料匯入）`, 7),
      entry("party", morningside, "建立客戶「Morningside Creative」（示範資料匯入）", 7),
      entry("project", projMorningside, "建立專案「Morningside 品牌官網改版」（示範資料匯入）", 6),
      entry("contract", ctMorningside, "建立合約「品牌官網改版合約」（示範資料匯入）", 6),
      entry("billing_item", biMorningsideSigning, "展開請款排程「官網改版 — 簽約金」（示範資料匯入）", 6),
      entry("subscription", subVerdant, `建立訂閱「${SUB_VERDANT}」（示範資料匯入）`, 5),
      entry("invoice", invMorningsideSigning, "建立發票 DM-2001（示範資料匯入）", 5),
      entry("employee", empIds[0].id, `建立員工「${empIds[0].def.name}」（示範資料匯入）`, 4),
      entry("transaction", advSupplyId, "建立代墊交易（示範資料匯入）", 3),
      entry("reconciliation", null, "建立銀行對帳紀錄（示範資料匯入）", 2),
    ])
    .returning({ id: activityLog.id });
  return rows.length;
});

// ---------------------------------------------------------------------------
// 摘要
// ---------------------------------------------------------------------------

const totalTxns = bulkTxnCount + trackedTxns.length + reimbursementCount;

console.log(`✓ seeded demo organization "${org.name}"`);
console.log(`  organizationId : ${ORG}`);
const slugNote =
  slug === requestedSlug ? "" : `  (requested "${requestedSlug}" was taken; --force picked this)`;
console.log(`  slug           : ${slug}${slugNote}`);
console.log(`  owner          : ${ownerUser.email} (${ownerUser.id})`);
console.log("");
console.log("  categories           " + CATEGORY_DEFS.length);
console.log("  bank accounts        3  (TWD ×2, USD ×1 — bank + cash)");
console.log("  parties              " + PARTY_DEFS.length + "  (6 customers, 6 vendors, 1 gov)");
console.log("  projects             " + PROJECT_DEFS.length + "  (4 active, 1 archived)");
console.log("  contracts            " + CONTRACT_DEFS.length + "  (4 active, 1 completed, 1 draft)");
console.log("  billing items        " + BILLING_DEFS.length + "  (paid / overdue / due / billed / partial / upcoming / cancelled)");
console.log("  subscriptions        5  (3 active, 1 paused, 1 ended)");
console.log("  subscription periods " + subPeriodCount);
console.log("  employees            " + EMPLOYEE_DEFS.length + "  (4 active, 1 departed)");
console.log("  invoices             " + INVOICE_DEFS.length + "  (issued/received × valid/void/allowance)");
console.log("  transactions         " + totalTxns + "  (income/expense/advance/reimbursement/transfer, books both+internal+external)");
console.log("  payroll runs         " + RUN_DEFS.length + "  (2 paid, 1 draft)");
console.log("  payslips             " + payslipIds.size + " with " + payslipItemCount + " line items");
console.log("  payroll item types   7");
console.log("  reconciliations      " + reconciliationCount);
console.log("  documents            " + documentCount + "  (1 accountant notice pending, 1 notified)");
console.log("  activity log         " + activityCount);
console.log("");
console.log(`  Sign in as ${ownerUser.email} and pass organizationId="${slug}" to any MCP tool.`);
