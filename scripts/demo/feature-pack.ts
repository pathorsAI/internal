/**
 * 示範組織的「新功能資料包」：讓 2026-11 之後上線的功能在示範組織裡一打開就有內容。
 *
 * 給兩個入口用：
 *   - scripts/seed-demo-org.ts      新建示範組織時最後呼叫一次；
 *   - scripts/seed-demo-features.ts 對既有的示範組織補一次（正式 DB 上的示範組織不是每次重建的）。
 *
 * 涵蓋的功能（每一段開頭有說明）：
 *   A. 營業稅別（含稅／未稅／零稅率）                         migrations/0040
 *   B. 連結層：待連結（多個候選、金額不符、相似對象、待確認）、合約收齊提示、專案由合約聚合  0041
 *   C. 收款分配：一筆入帳分給請款項目＋訂閱期別，吸收匯費      0043
 *   D. 固定支出＝廠商計費手動帳戶（扣款週期、預估金額、付款方式）  0041
 *   E. 雲端計費：GCP（抵用點數）、Azure（月帳單對帳）、每月費用明細  0031／0037
 *   F. 總帳與財報：管理帳專用帳戶、匯率、財產與折舊、調整分錄       0044
 *   G. 站內 AI：AI 規則、網頁對話、LINE 對話                    0036／0042
 *   H. API key：只有一把已撤銷的示範 key（雜湊是隨機值，任何字串都對不上）  0038
 *   I. 使用紀錄（usage_events）                               0047
 *   J. 復原：幾筆可以復原的操作紀錄（走 app 自己的 activity 紀錄，快照由 trigger 產生）  0045
 *
 * 原則：
 *   - 資料包自成一組：自己的客戶、廠商、合約、交易，不依賴組織裡原本有什麼（只沿用一個台幣政府帳戶，
 *     沒有才新建）。所以對任何示範組織都能補，也不會改到原本的資料 —— 只新增，不 UPDATE 既有列。
 *   - 會被系統推導的欄位一律交給 app 自己的寫入路徑：交易走連結層（src/lib/linking/write.ts），
 *     候選、繼承、收款日都是真的算出來的；收款分配走 replaceTransactionAllocations；抵用點數走
 *     bookPromotionCredits；可復原的操作紀錄走 logToolActivity。這樣畫面上的數字一定前後兼容。
 *   - 冪等：組織裡已經有統編 DEMOF001 的對象就視為補過了，直接中止。
 *   - 名稱全是虛構的；統編用 DEMOF0xx（含字母，不可能撞到真實統編）；不放任何真的 token。
 */
import { createHash, randomBytes } from "node:crypto";
import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { logToolActivity } from "@/db/activity";
import { createAiConversation, insertAiMessage } from "@/db/ai";
import { replaceTransactionAllocations } from "@/db/allocations";
import { ensureChartOfAccounts } from "@/db/ledger";
import {
  accountReconciliations,
  aiRules,
  apiKeys,
  bankAccounts,
  billingItems,
  categories,
  contracts,
  fixedAssets,
  fxRates,
  glAccounts,
  invoices,
  journalEntries,
  journalLines,
  parties,
  paymentMethods,
  projects,
  subscriptions,
  transactions,
  vendorBillingAccounts,
  vendorBillingResources,
  vendorCostLines,
  vendorInvoices,
} from "@/db/schema";
import { pendingPartyOf, resolvePartyForWrite } from "@/lib/linking/party";
import { insertTransactions, type InsertResult, type LinkedInsert } from "@/lib/linking/write";
import type { LinkSource } from "@/lib/linking/resolve";
import { bookPromotionCredits } from "@/lib/vendor-billing/promotion-ledger";
import { splitGross } from "@/lib/vat";

export const FEATURE_PACK_SENTINEL_TAX_ID = "DEMOF001";

export type FeaturePackOwner = { id: string; email: string; name: string };

export type FeaturePackOptions = {
  db: Db;
  orgId: string;
  owner: FeaturePackOwner;
  /** 預設今天；測試可以固定日期。 */
  today?: Date;
  log?: (line: string) => void;
};

export type FeaturePackSummary = Record<string, number>;

/** 這個組織補過資料包沒有（看哨兵對象）。 */
export async function featurePackApplied(db: Db, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.taxId, FEATURE_PACK_SENTINEL_TAX_ID)))
    .limit(1);
  return Boolean(row);
}

const NOTE = "示範資料（fictional demo data）";

export async function seedFeaturePack(opts: FeaturePackOptions): Promise<FeaturePackSummary> {
  const { db, orgId: ORG, owner } = opts;
  const log = opts.log ?? (() => {});
  const TODAY = opts.today ?? new Date();
  const summary: FeaturePackSummary = {};
  const count = (key: string, n: number) => {
    summary[key] = (summary[key] ?? 0) + n;
  };

  if (await featurePackApplied(db, ORG)) {
    throw new Error(`organization ${ORG} already has the demo feature pack (party ${FEATURE_PACK_SENTINEL_TAX_ID})`);
  }

  // 資料包自己的客戶必須是新的（既有同名客戶會把別的交易算進故事裡）。寫任何東西之前先擋。
  const OWN_NAMES = ["鷺洲物流", "禾豐食品", "雲杉診所", "青嶼設計", "Harbor Pacific Trading", "北辰共享辦公室", "安和記帳士事務所"];
  const clash = await db
    .select({ name: parties.name })
    .from(parties)
    .where(and(eq(parties.organizationId, ORG), isNull(parties.deletedAt), inArray(parties.name, OWN_NAMES)));
  if (clash.length) {
    throw new Error(`organization ${ORG} already has parties named ${clash.map((c) => c.name).join(", ")}; refusing to mix them into the demo story`);
  }

  // ---------------------------------------------------------------------------
  // 日期工具（全部相對今天，資料永遠是「最近半年」）
  // ---------------------------------------------------------------------------
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const todayIso = iso(TODAY);
  const day = (n: number) => iso(addDays(TODAY, n));
  const monthStart = (k: number) => iso(startOfMonth(addMonths(TODAY, k)));
  const monthEnd = (k: number) => iso(endOfMonth(addMonths(TODAY, k)));
  const monthDay = (k: number, d: number) => iso(addDays(startOfMonth(addMonths(TODAY, k)), d - 1));
  /** 第 k 個月第 d 天，但不晚於今天（已付的錢不能是未來日期）。 */
  const pastMonthDay = (k: number, d: number) => {
    const t = monthDay(k, d);
    if (t > todayIso) return todayIso;
    return t;
  };
  const ym = (k: number) => monthStart(k).slice(0, 7);
  const dec = (n: number) => n.toFixed(2);
  const gross = (net: number) => Math.round(net * 1.05);

  /** 示範用 USD 匯率：32 上下小幅擺動，同一天永遠同一個值。 */
  const usdRate = (dateIso: string) => {
    const t = new Date(`${dateIso}T00:00:00Z`).getTime() / 86_400_000;
    return Math.round((32.1 + 0.45 * Math.sin(t / 23) + 0.2 * Math.sin(t / 7)) * 10_000) / 10_000;
  };
  const twdOf = (amount: number, currency: string, dateIso: string) =>
    currency === "TWD" ? dec(amount) : dec(Math.round(amount * usdRate(dateIso) * 100) / 100);

  async function section<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      log(`  ✓ ${label}`);
      return out;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`feature pack: while seeding ${label}: ${detail}`, { cause: e });
    }
  }

  // ---------------------------------------------------------------------------
  // 0. 共用：資料包自己的台幣帳戶（政府帳）與 Wise 美金帳戶（只在管理帳）、分類
  //    刻意不沿用組織原本的帳戶：那些帳戶可能已有對帳紀錄，多出來的交易會讓既有對帳對不上。
  // ---------------------------------------------------------------------------
  const { twdAcct, wiseAcct } = await section("bank accounts", async () => {
    const [twd] = await db
      .insert(bankAccounts)
      .values({ organizationId: ORG, name: "示範銀行 營運戶 (****5521)", kind: "bank", currency: "TWD", openingBalance: dec(2_400_000), ledgerScope: "government" })
      .returning({ id: bankAccounts.id });
    count("bank_accounts", 1);
    // ledger_scope = management：只進管理帳。政府帳上這個帳戶的收付一律沖「股東往來」。
    const [wise] = await db
      .insert(bankAccounts)
      .values({
        organizationId: ORG,
        name: "Wise 美金帳戶（只在管理帳）",
        kind: "bank",
        currency: "USD",
        openingBalance: dec(12_000),
        ledgerScope: "management",
      })
      .returning({ id: bankAccounts.id });
    count("bank_accounts", 1);
    return { twdAcct: twd.id, wiseAcct: wise.id };
  });

  const cat = await section("categories", async () => {
    const want: [string, string][] = [
      ["專案服務收入", "income"],
      ["訂閱收入", "income"],
      ["雲端服務成本", "cogs"],
      ["辦公室租金", "expense"],
      ["專業服務費", "expense"],
      ["軟體訂閱", "expense"],
      ["差旅交通", "expense"],
      ["電腦設備", "expense"],
    ];
    const rows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.organizationId, ORG), isNull(categories.deletedAt)));
    const map = new Map(rows.map((r) => [r.name, r.id]));
    const missing = want.filter(([n]) => !map.has(n));
    if (missing.length) {
      const created = await db
        .insert(categories)
        .values(missing.map(([name, kind]) => ({ organizationId: ORG, name, kind, isActive: true })))
        .returning({ id: categories.id, name: categories.name });
      for (const r of created) map.set(r.name, r.id);
      count("categories", created.length);
    }
    return (name: string) => {
      const id = map.get(name);
      if (id === undefined) throw new Error(`category ${name} missing`);
      return id;
    };
  });

  // ---------------------------------------------------------------------------
  // 1. 交易對象
  // ---------------------------------------------------------------------------
  type P = { key: string; name: string; label: string; taxId: string | null; currency: string; account: number; contact: string | null; aliases?: string[] };
  const PARTY_DEFS: P[] = [
    { key: "luzhou", name: "鷺洲物流", label: "customer", taxId: "DEMOF001", currency: "TWD", account: twdAcct, contact: "ap@luzhou-logistics.example" },
    { key: "hefeng", name: "禾豐食品", label: "customer", taxId: "DEMOF002", currency: "TWD", account: twdAcct, contact: "finance@hefeng-foods.example" },
    { key: "yunshan", name: "雲杉診所", label: "customer", taxId: "DEMOF003", currency: "TWD", account: twdAcct, contact: "admin@yunshan-clinic.example" },
    { key: "qingyu", name: "青嶼設計", label: "customer", taxId: "DEMOF004", currency: "TWD", account: twdAcct, contact: "hello@qingyu-design.example" },
    { key: "harbor", name: "Harbor Pacific Trading", label: "customer", taxId: null, currency: "USD", account: wiseAcct, contact: "ap@harborpacific.example" },
    { key: "beichen", name: "北辰共享辦公室", label: "vendor", taxId: "DEMOF101", currency: "TWD", account: twdAcct, contact: "billing@beichen-cowork.example" },
    { key: "anhe", name: "安和記帳士事務所", label: "vendor", taxId: "DEMOF102", currency: "TWD", account: twdAcct, contact: "service@anhe-bookkeeping.example" },
    { key: "gcp", name: "Google Cloud", label: "vendor", taxId: null, currency: "USD", account: wiseAcct, contact: null },
    { key: "azure", name: "Microsoft Azure", label: "vendor", taxId: null, currency: "TWD", account: twdAcct, contact: null },
    { key: "figma", name: "Figma", label: "vendor", taxId: null, currency: "USD", account: wiseAcct, contact: null },
    { key: "taxi", name: "台灣大車隊", label: "vendor", taxId: null, currency: "TWD", account: twdAcct, contact: null },
  ];
  const party = await section("parties", async () => {
    // 廠商（Google Cloud、Figma…）在不少示範組織裡本來就有同名的對象（名稱在組織內唯一）：沿用既有的，
    // 只新增缺的。資料包自己的客戶都是新名字。
    const existing = await db
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.organizationId, ORG), isNull(parties.deletedAt), inArray(parties.name, PARTY_DEFS.map((p) => p.name))));
    const byName = new Map(existing.map((r) => [r.name, r.id]));
    const missing = PARTY_DEFS.filter((p) => !byName.has(p.name));
    if (missing.length) {
      const rows = await db
        .insert(parties)
        .values(
          missing.map((p) => ({
            organizationId: ORG,
            name: p.name,
            label: p.label,
            taxId: p.taxId,
            defaultCurrency: p.currency,
            defaultAccountId: p.account,
            contact: p.contact,
            note: NOTE,
            isActive: true,
          })),
        )
        .returning({ id: parties.id, name: parties.name });
      for (const r of rows) byName.set(r.name, r.id);
      count("parties", rows.length);
    }
    return Object.fromEntries(PARTY_DEFS.map((p) => [p.key, byName.get(p.name)!])) as Record<string, number>;
  });

  // ---------------------------------------------------------------------------
  // 2. 專案（狀態由底下的合約推導，這裡只存 active）
  //    鷺洲：合約進行中 → 進行中；雲杉：合約已收齊但還開著 → 合約頁出「已收齊」提示；
  //    青嶼：合約已完成、沒有訂閱 → 專案頁出「可結案」提示；Harbor：零稅率外銷合約。
  //    禾豐的合約刻意不掛專案（專案頁列在「沒有專案的合約」讓人歸類）。
  // ---------------------------------------------------------------------------
  const project = await section("projects", async () => {
    const defs = [
      { key: "luzhou", name: "鷺洲物流 倉儲排程系統", client: party.luzhou, description: "倉儲排程系統建置與每月維運。" },
      { key: "yunshan", name: "雲杉診所 線上預約系統", client: party.yunshan, description: "門診線上預約與回診提醒。" },
      { key: "qingyu", name: "青嶼設計 品牌網站改版", client: party.qingyu, description: "品牌官網改版，已驗收。" },
      { key: "harbor", name: "Harbor Pacific 出口報表平台", client: party.harbor, description: "外銷客戶的報表平台（USD、零稅率）。" },
    ];
    const rows = await db
      .insert(projects)
      .values(defs.map((p) => ({ organizationId: ORG, name: p.name, clientPartyId: p.client, status: "active", description: p.description })))
      .returning({ id: projects.id, name: projects.name });
    count("projects", rows.length);
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    return Object.fromEntries(defs.map((p) => [p.key, byName.get(p.name)!])) as Record<string, number>;
  });

  // ---------------------------------------------------------------------------
  // 3. 合約（A. 營業稅別：未稅＋5%、含稅、零稅率）
  // ---------------------------------------------------------------------------
  type C = {
    key: string; title: string; customer: number; project: number | null; amount: number; currency: string;
    signed: string; start: string; end: string | null; status: string; plan: string; count: number; split: string | null;
    interval: number; tax: string; basis: string;
  };
  const CONTRACT_DEFS: C[] = [
    { key: "luzhou", title: "倉儲排程系統年約", customer: party.luzhou, project: project.luzhou, amount: 600_000, currency: "TWD", signed: day(-110), start: monthStart(-3), end: day(255), status: "active", plan: "installments", count: 2, split: "50,50", interval: 2, tax: "taxable", basis: "net" },
    { key: "hefeng", title: "門市點餐系統導入（含稅報價）", customer: party.hefeng, project: null, amount: 210_000, currency: "TWD", signed: day(-45), start: day(-40), end: day(50), status: "active", plan: "installments", count: 2, split: "50,50", interval: 1, tax: "taxable", basis: "gross" },
    { key: "yunshan", title: "線上預約系統建置", customer: party.yunshan, project: project.yunshan, amount: 150_000, currency: "TWD", signed: day(-70), start: day(-65), end: day(-15), status: "active", plan: "single", count: 1, split: null, interval: 1, tax: "taxable", basis: "net" },
    { key: "qingyu", title: "品牌網站改版", customer: party.qingyu, project: project.qingyu, amount: 80_000, currency: "TWD", signed: day(-120), start: day(-115), end: day(-75), status: "completed", plan: "single", count: 1, split: null, interval: 1, tax: "taxable", basis: "net" },
    { key: "harbor", title: "Export Analytics Platform (zero-rated)", customer: party.harbor, project: project.harbor, amount: 24_000, currency: "USD", signed: day(-105), start: day(-100), end: day(265), status: "active", plan: "installments", count: 4, split: "25,25,25,25", interval: 3, tax: "zero_rated", basis: "net" },
  ];
  const contract = await section("contracts", async () => {
    const rows = await db
      .insert(contracts)
      .values(
        CONTRACT_DEFS.map((c) => ({
          organizationId: ORG,
          customerPartyId: c.customer,
          projectId: c.project,
          title: c.title,
          amount: dec(c.amount),
          currency: c.currency,
          startDate: c.start,
          endDate: c.end,
          signedDate: c.signed,
          paymentTermsDays: 30,
          status: c.status,
          note: NOTE,
          billingPlan: c.plan,
          installmentCount: c.count,
          installmentSplit: c.split,
          billingIntervalMonths: c.interval,
          dueRule: "signed_date",
          dueDay: null,
          taxTreatment: c.tax,
          amountBasis: c.basis,
        })),
      )
      .returning({ id: contracts.id, title: contracts.title });
    count("contracts", rows.length);
    const byTitle = new Map(rows.map((r) => [r.title, r.id]));
    return Object.fromEntries(CONTRACT_DEFS.map((c) => [c.key, byTitle.get(c.title)!])) as Record<string, number>;
  });

  // ---------------------------------------------------------------------------
  // 4. 請款項目（稅別一律沿用合約，欄位留 NULL）
  // ---------------------------------------------------------------------------
  type B = { key: string; title: string; customer: number; contract: number; project: number | null; amount: number; currency: string; due: string; billed: string | null; invoiced: string | null; status: string };
  const BILLING_DEFS: B[] = [
    { key: "luzhou1", title: "倉儲排程 — 建置費", customer: party.luzhou, contract: contract.luzhou, project: project.luzhou, amount: 300_000, currency: "TWD", due: day(-40), billed: day(-40), invoiced: null, status: "billed" },
    { key: "luzhou2", title: "倉儲排程 — 驗收款", customer: party.luzhou, contract: contract.luzhou, project: project.luzhou, amount: 300_000, currency: "TWD", due: day(30), billed: null, invoiced: null, status: "scheduled" },
    // 兩期金額一樣（含稅 105,000）：之後一筆 105,000 的入帳會有兩個候選 → 待連結「多個相符」。
    { key: "hefeng1", title: "點餐系統 — 第一期", customer: party.hefeng, contract: contract.hefeng, project: null, amount: 105_000, currency: "TWD", due: day(-20), billed: day(-20), invoiced: null, status: "billed" },
    { key: "hefeng2", title: "點餐系統 — 第二期", customer: party.hefeng, contract: contract.hefeng, project: null, amount: 105_000, currency: "TWD", due: day(-5), billed: day(-5), invoiced: null, status: "billed" },
    { key: "yunshan", title: "預約系統 — 全額", customer: party.yunshan, contract: contract.yunshan, project: project.yunshan, amount: 150_000, currency: "TWD", due: day(-50), billed: day(-50), invoiced: day(-50), status: "billed" },
    { key: "qingyu", title: "網站改版 — 全額", customer: party.qingyu, contract: contract.qingyu, project: project.qingyu, amount: 80_000, currency: "TWD", due: day(-80), billed: day(-80), invoiced: day(-80), status: "billed" },
    { key: "harbor1", title: "Export Analytics — Q1", customer: party.harbor, contract: contract.harbor, project: project.harbor, amount: 6_000, currency: "USD", due: day(-100), billed: day(-100), invoiced: day(-100), status: "billed" },
    { key: "harbor2", title: "Export Analytics — Q2", customer: party.harbor, contract: contract.harbor, project: project.harbor, amount: 6_000, currency: "USD", due: day(-10), billed: day(-10), invoiced: null, status: "billed" },
    { key: "harbor3", title: "Export Analytics — Q3", customer: party.harbor, contract: contract.harbor, project: project.harbor, amount: 6_000, currency: "USD", due: day(80), billed: null, invoiced: null, status: "scheduled" },
    { key: "harbor4", title: "Export Analytics — Q4", customer: party.harbor, contract: contract.harbor, project: project.harbor, amount: 6_000, currency: "USD", due: day(170), billed: null, invoiced: null, status: "scheduled" },
  ];
  const item = await section("billing items", async () => {
    const rows = await db
      .insert(billingItems)
      .values(
        BILLING_DEFS.map((b) => ({
          organizationId: ORG,
          customerPartyId: b.customer,
          contractId: b.contract,
          projectId: b.project,
          title: b.title,
          amount: dec(b.amount),
          currency: b.currency,
          dueDate: b.due,
          billedOn: b.billed,
          paidOn: null,
          invoicedOn: b.invoiced,
          needsInvoice: true,
          status: b.status,
          note: null,
        })),
      )
      .returning({ id: billingItems.id, title: billingItems.title });
    count("billing_items", rows.length);
    const byTitle = new Map(rows.map((r) => [r.title, r.id]));
    return Object.fromEntries(BILLING_DEFS.map((b) => [b.key, byTitle.get(b.title)!])) as Record<string, number>;
  });

  // ---------------------------------------------------------------------------
  // 5. 訂閱：鷺洲月費（綁合約，含稅 21,000）、青嶼網站維運（沒綁合約與專案，含稅 5,250）
  // ---------------------------------------------------------------------------
  const sub = await section("subscriptions", async () => {
    const [luzhou] = await db
      .insert(subscriptions)
      .values({ organizationId: ORG, customerPartyId: party.luzhou, projectId: project.luzhou, contractId: contract.luzhou, name: "鷺洲物流 排程系統月費", amount: dec(20_000), currency: "TWD", intervalMonths: 1, startDate: monthStart(-3), endDate: null, status: "active", note: "隨年約每月收" })
      .returning({ id: subscriptions.id });
    const [qingyu] = await db
      .insert(subscriptions)
      .values({ organizationId: ORG, customerPartyId: party.qingyu, projectId: null, name: "青嶼設計 網站維運", amount: dec(5_000), currency: "TWD", intervalMonths: 1, startDate: monthStart(-2), endDate: null, status: "active", note: "改版後的月維運" })
      .returning({ id: subscriptions.id });
    count("subscriptions", 2);
    return { luzhou: luzhou.id, qingyu: qingyu.id };
  });

  // ---------------------------------------------------------------------------
  // 6. 發票（開立）：雲杉、青嶼、Harbor Q1（零稅率）。收款交易會直接綁 invoiceId，總帳用它沖應收。
  // ---------------------------------------------------------------------------
  const invoice = await section("invoices", async () => {
    const defs = [
      { key: "yunshan", number: "DF-3001", date: day(-50), party: party.yunshan, name: "雲杉診所", taxId: "DEMOF003", gross: gross(150_000), currency: "TWD", zero: false, contract: contract.yunshan, item: item.yunshan },
      { key: "qingyu", number: "DF-3002", date: day(-80), party: party.qingyu, name: "青嶼設計", taxId: "DEMOF004", gross: gross(80_000), currency: "TWD", zero: false, contract: contract.qingyu, item: item.qingyu },
      // 外銷零稅率：發票金額是台幣（外幣 × 水單匯率），外幣另記在 foreign_*，總帳沖應收的匯差記兌換損益。
      { key: "harbor", number: "DF-3003", date: day(-100), party: party.harbor, name: "Harbor Pacific Trading", taxId: null, gross: Math.round(6_000 * usdRate(day(-100))), currency: "TWD", zero: true, contract: contract.harbor, item: item.harbor1 },
    ];
    const rows = await db
      .insert(invoices)
      .values(
        defs.map((v) => {
          const { net, tax } = v.zero ? { net: v.gross, tax: 0 } : splitGross(v.gross);
          return {
            organizationId: ORG,
            direction: "issued",
            invoiceNumber: v.number,
            invoiceDate: v.date,
            counterpartyName: v.name,
            counterpartyTaxId: v.taxId,
            amountNet: dec(net),
            tax: dec(tax),
            amountGross: dec(v.gross),
            currency: v.currency,
            status: "valid",
            note: v.zero ? "外銷零稅率" : null,
            partyId: v.party,
            contractId: v.contract,
            billingItemId: v.item,
            externalStatus: "issued",
            externalRef: `SIM-DEMO-${v.number}`,
            ...(v.zero
              ? { taxTreatment: "zero_rated", zeroRateReason: "72", exchangeRate: usdRate(v.date).toFixed(6), foreignCurrency: "USD", foreignAmount: dec(6_000) }
              : {}),
          };
        }),
      )
      .returning({ id: invoices.id, number: invoices.invoiceNumber });
    count("invoices", rows.length);
    const byNo = new Map(rows.map((r) => [r.number, r.id]));
    return Object.fromEntries(defs.map((v) => [v.key, byNo.get(v.number)!])) as Record<string, number>;
  });

  // ---------------------------------------------------------------------------
  // 7. 付款方式 + 廠商計費帳戶（D. 固定支出、E. 雲端）
  // ---------------------------------------------------------------------------
  const pm = await section("payment methods", async () => {
    const rows = await db
      .insert(paymentMethods)
      .values([
        { organizationId: ORG, kind: "card", label: "公司信用卡", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2028, holderName: "示範公司", settlesFromAccountId: twdAcct, source: "manual", isActive: true, note: NOTE },
        { organizationId: ORG, kind: "wise_card", label: "Wise 簽帳卡", brand: "visa", last4: "8817", expiryMonth: 6, expiryYear: 2029, holderName: "示範公司", settlesFromAccountId: wiseAcct, source: "manual", isActive: true, note: NOTE },
        { organizationId: ORG, kind: "bank_transfer", label: "銀行轉帳", brand: null, last4: null, expiryMonth: null, expiryYear: null, holderName: null, settlesFromAccountId: twdAcct, source: "manual", isActive: true, note: NOTE },
      ])
      .returning({ id: paymentMethods.id, label: paymentMethods.label });
    count("payment_methods", rows.length);
    const by = new Map(rows.map((r) => [r.label, r.id]));
    return { card: by.get("公司信用卡")!, wise: by.get("Wise 簽帳卡")!, transfer: by.get("銀行轉帳")! };
  });

  const vba = await section("vendor billing accounts", async () => {
    // 確認過的帳戶不會出現在「需要處理」；Figma 故意留著沒確認，示範那一條提醒長什麼樣子。
    const verified = new Date(`${day(-20)}T10:00:00+08:00`).toISOString();
    const base = { organizationId: ORG, ownerUserId: owner.id, ledgerMode: "match_only", status: "active", note: NOTE, lastVerifiedAt: verified };
    const rows = await db
      .insert(vendorBillingAccounts)
      .values([
        // 手動帳戶＝固定支出
        { ...base, partyId: party.beichen, provider: "other", source: "manual", displayName: "辦公室租金（北辰共享辦公室）", paymentMethodId: pm.transfer, schedule: "fixed", anchorDate: monthDay(-6, 5), intervalMonths: 1, expectedAmount: dec(gross(35_000)), currency: "TWD", billingUrl: null, meta: {} },
        { ...base, partyId: party.anhe, provider: "other", source: "manual", displayName: "記帳士月費", paymentMethodId: pm.transfer, schedule: "fixed", anchorDate: monthDay(-6, 10), intervalMonths: 1, expectedAmount: dec(gross(8_000)), currency: "TWD", billingUrl: null, meta: {} },
        { ...base, partyId: party.figma, provider: "other", source: "manual", displayName: "Figma 團隊方案（年繳）", lastVerifiedAt: null, paymentMethodId: pm.wise, schedule: "fixed", anchorDate: monthDay(-8, 15), intervalMonths: 12, expectedAmount: dec(540), currency: "USD", billingUrl: "https://www.figma.com/settings", meta: {} },
        // 雲端：synced 帳戶。external_id 是假的格式樣本，沒有對應的整合，不會被同步排程碰到。
        { ...base, partyId: party.gcp, provider: "gcp", source: "synced", externalId: "01D3M0-0A0A0A-DEMO01", displayName: "GCP 計費帳號（示範）", paymentMethodId: pm.wise, schedule: "usage", anchorDate: null, intervalMonths: 1, expectedAmount: null, currency: "USD", billingUrl: null, lastSeenAt: new Date().toISOString(), meta: { demo: true } },
        { ...base, partyId: party.azure, provider: "azure", source: "synced", externalId: "a1b2c3d4-0000-4000-8000-00000000de01", displayName: "Azure 訂閱（示範）", paymentMethodId: pm.card, schedule: "usage", anchorDate: null, intervalMonths: 1, expectedAmount: null, currency: "TWD", billingUrl: null, lastSeenAt: new Date().toISOString(), meta: { demo: true } },
      ])
      .returning({ id: vendorBillingAccounts.id, displayName: vendorBillingAccounts.displayName });
    count("vendor_billing_accounts", rows.length);
    const by = new Map(rows.map((r) => [r.displayName, r.id]));
    return {
      rent: by.get("辦公室租金（北辰共享辦公室）")!,
      bookkeeping: by.get("記帳士月費")!,
      figma: by.get("Figma 團隊方案（年繳）")!,
      gcp: by.get("GCP 計費帳號（示範）")!,
      azure: by.get("Azure 訂閱（示範）")!,
    };
  });

  await section("vendor billing resources", async () => {
    const rows = await db
      .insert(vendorBillingResources)
      .values([
        { organizationId: ORG, billingAccountId: vba.gcp, kind: "gcp_project", externalId: "demo-prod-480211", name: "demo-prod", status: "active", lastSeenAt: new Date().toISOString() },
        { organizationId: ORG, billingAccountId: vba.gcp, kind: "gcp_project", externalId: "demo-staging-480211", name: "demo-staging", status: "active", lastSeenAt: new Date().toISOString() },
        { organizationId: ORG, billingAccountId: vba.azure, kind: "azure_subscription", externalId: "a1b2c3d4-0000-4000-8000-00000000de02", name: "Production", status: "active", lastSeenAt: new Date().toISOString() },
      ])
      .returning({ id: vendorBillingResources.id });
    count("vendor_billing_resources", rows.length);
  });

  // 每月費用明細：GCP 有抵用點數（4,000 USD 的額度，前幾個月抵掉大半，後來用完）；Azure 沒有。
  const CLOUD_MONTHS = [-6, -5, -4, -3, -2, -1];
  type CostLine = { service: string; resource: string; gross: number; promo: number; net: number };
  const gcpMonths = new Map<number, CostLine[]>();
  const azureMonths = new Map<number, CostLine[]>();
  {
    let pool = 4_000;
    CLOUD_MONTHS.forEach((k, i) => {
      const growth = 1 + i * 0.08;
      const lines = [
        { service: "Compute Engine", resource: "demo-prod", gross: 612.4 * growth },
        { service: "Cloud SQL", resource: "demo-prod", gross: 238.15 * growth },
        { service: "Vertex AI", resource: "demo-prod", gross: 140.6 * growth * growth },
        { service: "Cloud Storage", resource: "demo-prod", gross: 31.9 * growth },
        { service: "Compute Engine", resource: "demo-staging", gross: 88.3 },
      ].map((l) => ({ ...l, gross: Math.round(l.gross * 100) / 100 }));
      const total = lines.reduce((s, l) => s + l.gross, 0);
      const credit = Math.min(pool, Math.round(total * 0.8 * 100) / 100);
      pool -= credit;
      let left = credit;
      const out = lines.map((l, j) => {
        const promo = j === lines.length - 1 ? left : Math.round((credit * l.gross) / total * 100) / 100;
        left = Math.round((left - promo) * 100) / 100;
        return { ...l, promo: -promo, net: Math.round((l.gross - promo) * 100) / 100 };
      });
      gcpMonths.set(k, out);
      azureMonths.set(
        k,
        [
          { service: "Virtual Machines", resource: "Production", gross: 9_800 + i * 350 },
          { service: "Azure OpenAI", resource: "Production", gross: 4_200 + i * 900 },
          { service: "Storage", resource: "Production", gross: 640 },
          { service: "Bandwidth", resource: "Production", gross: 310 + i * 20 },
        ].map((l) => ({ ...l, promo: 0, net: l.gross })),
      );
    });
  }
  const sumNet = (lines: CostLine[]) => Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100;

  await section("vendor cost lines", async () => {
    const values = CLOUD_MONTHS.flatMap((k) => [
      ...gcpMonths.get(k)!.map((l) => ({
        organizationId: ORG, billingAccountId: vba.gcp, month: monthStart(k), resourceExternalId: `${l.resource}-480211`, resourceName: l.resource,
        service: l.service, amount: l.net.toFixed(4), grossAmount: l.gross.toFixed(4), promotionCredit: l.promo.toFixed(4), currency: "USD", source: "gcp_bigquery",
      })),
      ...azureMonths.get(k)!.map((l) => ({
        organizationId: ORG, billingAccountId: vba.azure, month: monthStart(k), resourceExternalId: "a1b2c3d4-0000-4000-8000-00000000de02", resourceName: l.resource,
        service: l.service, amount: l.net.toFixed(4), grossAmount: l.gross.toFixed(4), promotionCredit: "0", currency: "TWD", source: "azure_cost",
      })),
    ]);
    const rows = await db.insert(vendorCostLines).values(values).returning({ id: vendorCostLines.id });
    count("vendor_cost_lines", rows.length);
  });

  // ---------------------------------------------------------------------------
  // 8. 交易（全部走連結層）
  // ---------------------------------------------------------------------------
  const allResults: InsertResult[] = [];
  const write = async (source: LinkSource, rows: LinkedInsert[], extra: { suggestOnly?: boolean; autoMatch?: boolean } = {}) => {
    const res = await insertTransactions({ db, orgId: ORG, source, ...extra }, rows);
    allResults.push(...res);
    count("transactions", res.length);
    return res;
  };
  type T = {
    type: string; date: string; amount: number; currency: string; description: string; category: string | null; party: number | null;
    from?: number | null; to?: number | null; book?: string; vat?: boolean; project?: number | null; contract?: number | null;
    subscription?: number | null; period?: string | null; billingItem?: number | null; invoice?: number | null;
    vendorAccount?: number | null; externalSource?: string | null; externalRef?: string | null;
  };
  const row = (t: T): LinkedInsert => ({
    organizationId: ORG,
    type: t.type,
    txnDate: t.date,
    description: t.description,
    categoryId: t.category ? cat(t.category) : null,
    amount: dec(t.amount),
    currency: t.currency,
    amountTwd: twdOf(t.amount, t.currency, t.date),
    fromAccountId: t.from ?? null,
    toAccountId: t.to ?? null,
    book: t.book ?? "both",
    billedToCompanyTaxId: t.vat ?? false,
    invoiceId: t.invoice ?? null,
    partyId: t.party,
    projectId: t.project ?? null,
    contractId: t.contract ?? null,
    subscriptionId: t.subscription ?? null,
    subscriptionPeriod: t.period ?? null,
    billingItemId: t.billingItem ?? null,
    vendorBillingAccountId: t.vendorAccount ?? null,
    externalSource: t.externalSource ?? null,
    externalRef: t.externalRef ?? null,
  });

  // C. 收款分配：鷺洲把「建置費＋當月月費」一次匯進來，被扣了 30 元匯費。
  const allocDate = day(-12);
  const allocPeriod = iso(startOfMonth(new Date(`${allocDate}T00:00:00`)));
  const luzhouPeriods = [-3, -2, -1, 0].map(monthStart).filter((p) => p < allocPeriod);

  await section("transactions: settled income", async () => {
    await write("web", [
      // 鷺洲月費：分配那一期之前的每一期各自入帳（直接掛訂閱期別）
      ...luzhouPeriods.map((p) => {
        const k = [-3, -2, -1, 0].find((m) => monthStart(m) === p)!;
        return row({ type: "income", date: pastMonthDay(k, 5), amount: gross(20_000), currency: "TWD", description: `鷺洲物流 ${p.slice(0, 7)} 月費`, category: "訂閱收入", party: party.luzhou, to: twdAcct, subscription: sub.luzhou, period: p });
      }),
      // 青嶼：改版全額（綁發票）＋第一期維運
      row({ type: "income", date: day(-70), amount: gross(80_000), currency: "TWD", description: "青嶼設計 網站改版尾款", category: "專案服務收入", party: party.qingyu, to: twdAcct, billingItem: item.qingyu, invoice: invoice.qingyu }),
      row({ type: "income", date: pastMonthDay(-2, 6), amount: gross(5_000), currency: "TWD", description: `青嶼設計 ${ym(-2)} 網站維運`, category: "訂閱收入", party: party.qingyu, to: twdAcct, subscription: sub.qingyu, period: monthStart(-2) }),
      // Harbor Q1（零稅率、USD，進 Wise）
      row({ type: "income", date: day(-95), amount: 6_000, currency: "USD", description: "Harbor Pacific Q1 payment", category: "專案服務收入", party: party.harbor, to: wiseAcct, billingItem: item.harbor1, invoice: invoice.harbor }),
    ]);
    // 雲杉：沒指定請款項，交給連結層自動比對（唯一相符 → 自動掛上，差 30 元匯費在容許範圍內）
    // → 合約已收齊但狀態還是進行中 → 合約頁出「已收齊」提示。
    await write("web", [
      row({ type: "income", date: day(-35), amount: gross(150_000) - 30, currency: "TWD", description: "雲杉診所 預約系統款（扣匯費 30）", category: "專案服務收入", party: party.yunshan, to: twdAcct, invoice: invoice.yunshan }),
    ]);
  });

  await section("payment allocation", async () => {
    const amount = gross(300_000) + gross(20_000) - 30;
    const [res] = await write(
      "web",
      [row({ type: "income", date: allocDate, amount, currency: "TWD", description: "鷺洲物流 匯入（建置費＋月費，扣匯費 30）", category: "專案服務收入", party: party.luzhou, to: twdAcct })],
      { autoMatch: false },
    );
    await replaceTransactionAllocations(
      ORG,
      res.row.id,
      [
        { target: { type: "billing_item", billingItemId: item.luzhou1 }, amount: gross(300_000) - 30, fee: 30, note: "匯費 30 元吸收" },
        { target: { type: "subscription_period", subscriptionId: sub.luzhou, period: allocPeriod }, amount: gross(20_000), fee: 0, note: null },
      ],
      owner.id,
      db,
    );
    count("payment_allocations", 2);
  });

  await section("transactions: pending links", async () => {
    // 多個相符：禾豐兩期金額一樣
    await write("wise", [
      row({ type: "income", date: day(-3), amount: 105_000, currency: "TWD", description: "禾豐食品 匯款", category: "專案服務收入", party: party.hefeng, to: twdAcct, externalSource: "wise", externalRef: "demo-pack-hefeng-1" }),
      // 金額不符：Harbor 只先付了 4,000（Q2 應收 6,000）
      row({ type: "income", date: day(-2), amount: 4_000, currency: "USD", description: "HARBOR PACIFIC TRADING partial", category: "專案服務收入", party: party.harbor, to: wiseAcct, externalSource: "wise", externalRef: "demo-pack-harbor-2" }),
    ]);
    // 待確認：重新掃描的舊交易剛好一個相符，等人按確認
    await write(
      "rescan",
      [row({ type: "income", date: day(-4), amount: gross(5_000), currency: "TWD", description: "青嶼設計 轉帳", category: "訂閱收入", party: party.qingyu, to: twdAcct })],
      { suggestOnly: true },
    );
    // 相似對象：自動同步帶進來的名稱跟既有對象很像，不自動新建
    const name = "鷺洲物流股份有限公司";
    const held = await resolvePartyForWrite(db, ORG, name, "customer", "hold");
    const pendingParty = pendingPartyOf(name, "customer", held);
    await write("wise", [
      { ...row({ type: "income", date: day(-1), amount: gross(20_000), currency: "TWD", description: `${name} 匯入`, category: "訂閱收入", party: held.partyId, to: twdAcct, externalSource: "wise", externalRef: "demo-pack-luzhou-similar" }), pendingParty },
    ]);
  });

  await section("transactions: expenses", async () => {
    const rows: LinkedInsert[] = [];
    // 固定支出：租金、記帳士。對象只有一個開著的廠商計費帳戶 → 連結層自動掛上（「付了沒」看這個）。
    // 本月的刻意不付，固定支出頁會看到本期待付。
    for (const k of [-5, -4, -3, -2, -1]) {
      rows.push(
        row({ type: "expense", date: monthDay(k, 5), amount: gross(35_000), currency: "TWD", description: `${ym(k)} 辦公室租金`, category: "辦公室租金", party: party.beichen, from: twdAcct, vat: true }),
        row({ type: "expense", date: monthDay(k, 10), amount: gross(8_000), currency: "TWD", description: `${ym(k)} 記帳士月費`, category: "專業服務費", party: party.anhe, from: twdAcct, vat: true }),
      );
    }
    rows.push(row({ type: "expense", date: monthDay(-8, 15), amount: 540, currency: "USD", description: "Figma 團隊方案年費", category: "軟體訂閱", party: party.figma, from: wiseAcct }));
    // 雲端：GCP 每月卡費（淨額，Wise 卡）、Azure 每月卡費（公司信用卡）。最後一個月的 Azure 還沒扣款 → 帳單待對帳。
    for (const k of CLOUD_MONTHS) {
      rows.push(row({ type: "expense", date: pastMonthDay(k + 1, 2), amount: sumNet(gcpMonths.get(k)!), currency: "USD", description: `GCP ${ym(k)} 用量`, category: "雲端服務成本", party: party.gcp, from: wiseAcct }));
      if (k !== -1) {
        rows.push(row({ type: "expense", date: pastMonthDay(k + 1, 8), amount: sumNet(azureMonths.get(k)!), currency: "TWD", description: `Azure ${ym(k)} 用量`, category: "雲端服務成本", party: party.azure, from: twdAcct }));
      }
    }
    // F. 財產：研發筆電（下面建 fixed_assets 指回這筆）
    rows.push(row({ type: "expense", date: day(-75), amount: 128_000, currency: "TWD", description: "研發用筆電 ×2", category: "電腦設備", party: null, from: twdAcct, vat: true }));
    await write("web", rows);
  });

  const txnByDesc = new Map(allResults.map((r) => [r.row.description ?? "", r.row.id]));

  await section("GCP promotion credits (management books)", async () => {
    const n = await bookPromotionCredits(
      db,
      ORG,
      vba.gcp,
      CLOUD_MONTHS.map((k) => {
        const credit = -gcpMonths.get(k)!.reduce((s, l) => s + l.promo, 0);
        return { billingAccountId: "01D3M0-0A0A0A-DEMO01", month: monthStart(k), periodEnd: monthEnd(k), amount: Math.round(credit * 100) / 100, currency: "USD" };
      }).filter((m) => m.amount > 0),
    );
    count("transactions", n);
  });

  await section("vendor invoices (Azure)", async () => {
    const values = CLOUD_MONTHS.map((k) => {
      const matched = k === -1 ? null : txnByDesc.get(`Azure ${ym(k)} 用量`) ?? null;
      return {
        organizationId: ORG,
        billingAccountId: vba.azure,
        externalRef: `E0DEMO${ym(k).replace("-", "")}`,
        source: "azure_invoice",
        periodStart: monthStart(k),
        periodEnd: monthEnd(k),
        invoiceDate: pastMonthDay(k + 1, 1),
        amount: dec(sumNet(azureMonths.get(k)!)),
        currency: "TWD",
        status: "Paid",
        matchStatus: matched ? "matched" : "unmatched",
        matchedTransactionId: matched,
        matchedAt: matched ? new Date().toISOString() : null,
        meta: { demo: true },
      };
    });
    const rows = await db.insert(vendorInvoices).values(values).returning({ id: vendorInvoices.id });
    count("vendor_invoices", rows.length);
  });

  // 上個月底的銀行對帳：結存照帳上算（期初＋收－付），對帳頁與總帳的「銀行對帳」檢查都會通過。
  await section("reconciliations", async () => {
    const asOf = monthEnd(-1);
    const balanceOf = async (acct: number, opening: number) => {
      const [r] = await db
        .select({
          net: sql<string>`coalesce(sum(case when ${transactions.toAccountId} = ${acct} then ${transactions.amount} else 0 end), 0)
            - coalesce(sum(case when ${transactions.fromAccountId} = ${acct} then ${transactions.amount} else 0 end), 0)`,
        })
        .from(transactions)
        .where(and(eq(transactions.organizationId, ORG), isNull(transactions.deletedAt), sql`${transactions.txnDate} <= ${asOf}`));
      return opening + Number(r?.net ?? 0);
    };
    await db.insert(accountReconciliations).values([
      { organizationId: ORG, accountId: twdAcct, asOfDate: asOf, statementBalance: dec(await balanceOf(twdAcct, 2_400_000)), note: "與銀行對帳單相符" },
      { organizationId: ORG, accountId: wiseAcct, asOfDate: asOf, statementBalance: dec(await balanceOf(wiseAcct, 12_000)), note: "Wise 月結單" },
    ]);
    count("reconciliations", 2);
  });

  // ---------------------------------------------------------------------------
  // 9. 總帳：科目表、匯率、財產、調整分錄
  // ---------------------------------------------------------------------------
  await section("general ledger", async () => {
    await ensureChartOfAccounts(ORG);
    const gl = await db
      .select({ id: glAccounts.id, code: glAccounts.code })
      .from(glAccounts)
      .where(eq(glAccounts.organizationId, ORG));
    const code = new Map(gl.map((g) => [g.code, g.id]));

    // 匯率：從組織最早一筆交易的前 10 天（總帳的期初記在帳本起始日前一天，也要換算）到今天，
    // 每 5 天一筆，讓「之前最近的匯率」永遠不超過 7 天。組織原本有的其他外幣也一起補（示範值），
    // 不然那些交易在財報上會是「缺匯率」。已有的同日匯率不覆蓋。
    const [earliest] = await db
      .select({ d: sql<string | null>`min(${transactions.txnDate})::text` })
      .from(transactions)
      .where(and(eq(transactions.organizationId, ORG), isNull(transactions.deletedAt)));
    const usedCurrencies = await db
      .selectDistinct({ c: transactions.currency })
      .from(transactions)
      .where(and(eq(transactions.organizationId, ORG), ne(transactions.currency, "TWD"), isNull(transactions.deletedAt)));
    const BASE_RATES: Record<string, number> = { USD: 0, EUR: 34.8, JPY: 0.212, SGD: 24.1, HKD: 4.12, GBP: 40.6, CNY: 4.45, AUD: 21.2 };
    const currencies = ["USD", ...usedCurrencies.map((c) => c.c.trim().toUpperCase()).filter((c) => c !== "USD" && c in BASE_RATES)];
    const rateFor = (c: string, d: string) =>
      c === "USD" ? usdRate(d) : Math.round(BASE_RATES[c] * (usdRate(d) / 32.1) * 1_000_000) / 1_000_000;
    const startIso = [earliest?.d ? iso(addDays(new Date(`${earliest.d}T00:00:00`), -10)) : null, iso(addMonths(TODAY, -9))]
      .filter((d): d is string => d !== null)
      .sort((a, b) => a.localeCompare(b))[0];
    const rates: { organizationId: string; currency: string; rateDate: string; rate: string; source: string }[] = [];
    const dates: string[] = [];
    for (let cursor = new Date(`${startIso}T00:00:00`); iso(cursor) <= todayIso; cursor = addDays(cursor, 5)) dates.push(iso(cursor));
    if (dates.at(-1) !== todayIso) dates.push(todayIso);
    for (const c of currencies) {
      for (const d of dates) rates.push({ organizationId: ORG, currency: c, rateDate: d, rate: rateFor(c, d).toFixed(6), source: "manual" });
    }
    const inserted = await db.insert(fxRates).values(rates).onConflictDoNothing().returning({ id: fxRates.id });
    count("fx_rates", inserted.length);

    const laptopTxn = txnByDesc.get("研發用筆電 ×2");
    await db.insert(fixedAssets).values({
      organizationId: ORG,
      name: "研發用筆電 ×2",
      acquiredOn: day(-75),
      cost: dec(128_000),
      salvageValue: dec(8_000),
      usefulLifeMonths: 36,
      assetAccountId: code.get("1681") ?? null,
      sourceTransactionId: laptopTxn ?? null,
      note: NOTE,
    });
    count("fixed_assets", 1);

    // 調整分錄：上個月的水電帳單次月才到，月底先估列（借 水電瓦斯費、貸 應付費用）。
    const utilities = code.get("6119");
    const accrued = code.get("2193");
    if (utilities && accrued) {
      const [je] = await db
        .insert(journalEntries)
        .values({ organizationId: ORG, ledger: "both", kind: "adjustment", entryDate: monthEnd(-1), memo: `估列 ${ym(-1)} 水電費（帳單次月才到）`, createdBy: owner.name || owner.email })
        .returning({ id: journalEntries.id });
      await db.insert(journalLines).values([
        { entryId: je.id, glAccountId: utilities, debit: dec(4_800), credit: "0", memo: "估列水電費" },
        { entryId: je.id, glAccountId: accrued, debit: "0", credit: dec(4_800), memo: "估列水電費" },
      ]);
      count("journal_entries", 1);
    }
  });

  // ---------------------------------------------------------------------------
  // 10. 站內 AI：規則與對話（對話只有本人看得到 → 掛在 owner 名下）
  // ---------------------------------------------------------------------------
  await section("AI rules", async () => {
    const rows = await db
      .insert(aiRules)
      .values([
        { organizationId: ORG, scope: "org", userId: null, kind: "category", match: { partyContains: "Google Cloud" }, action: { categoryId: cat("雲端服務成本"), categoryName: "雲端服務成本" }, text: "Google Cloud 的支出都記雲端服務成本", createdBy: owner.id, source: "web", applyCount: 6, lastAppliedAt: new Date(`${pastMonthDay(0, 2)}T09:00:00+08:00`).toISOString() },
        { organizationId: ORG, scope: "org", userId: null, kind: "category", match: { keyword: "計程車" }, action: { categoryId: cat("差旅交通"), categoryName: "差旅交通" }, text: "計程車、高鐵都算差旅交通", createdBy: owner.id, source: "line", applyCount: 3, lastAppliedAt: new Date().toISOString() },
        { organizationId: ORG, scope: "org", userId: null, kind: "note", match: {}, action: {}, text: "單筆超過 NT$50,000 的支出，先跟我確認再記帳", createdBy: owner.id, source: "web", applyCount: 0, lastAppliedAt: null },
        { organizationId: ORG, scope: "user", userId: owner.id, kind: "advance_default", match: {}, action: {}, text: "我用個人卡付的都算我代墊", createdBy: owner.id, source: "line", applyCount: 2, lastAppliedAt: new Date().toISOString() },
      ])
      .returning({ id: aiRules.id });
    count("ai_rules", rows.length);
  });

  await section("AI conversations", async () => {
    const me = { orgId: ORG, userId: owner.id };
    const web = await createAiConversation(me, "這個月還有誰沒付款？", "web");
    await insertAiMessage(web.id, { role: "user", content: "這個月還有哪些客戶沒付款？" });
    await insertAiMessage(web.id, { role: "assistant", content: null, toolCalls: [{ id: "call_demo_1", name: "list_billing_status", arguments: JSON.stringify({ status: "overdue" }) }], status: "ok" });
    await insertAiMessage(web.id, { role: "tool", toolCallId: "call_demo_1", toolName: "list_billing_status", status: "ok", content: JSON.stringify({ items: [{ customer: "禾豐食品", title: "點餐系統 — 第一期", amount: 105000, currency: "TWD" }, { customer: "Harbor Pacific Trading", title: "Export Analytics — Q2", amount: 6000, currency: "USD" }] }) });
    await insertAiMessage(web.id, {
      role: "assistant",
      status: "ok",
      content:
        "目前有兩筆已請款但還沒收齊：\n\n- **禾豐食品**「點餐系統 — 第一期」NT$105,000。帳上有一筆 3 天前的 105,000 入帳，但第一期和第二期金額一樣，我沒辦法判斷是哪一期，放在「待連結」等你選。\n- **Harbor Pacific Trading**「Export Analytics — Q2」US$6,000，2 天前只入帳 US$4,000，金額對不上，也在待連結。\n\n要我幫你把禾豐那筆掛到第一期嗎？",
    });
    count("ai_conversations", 1);
    count("ai_messages", 4);

    const line = await createAiConversation(me, "LINE：計程車 385", "line");
    await insertAiMessage(line.id, { role: "user", content: "計程車 385 去鷺洲物流開會" });
    await insertAiMessage(line.id, { role: "assistant", content: null, toolCalls: [{ id: "call_demo_2", name: "create_transaction", arguments: JSON.stringify({ type: "expense", amount: 385, currency: "TWD", partyName: "台灣大車隊", categoryName: "差旅交通", description: "計程車 拜訪鷺洲物流" }) }], status: "ok" });
    await insertAiMessage(line.id, { role: "tool", toolCallId: "call_demo_2", toolName: "create_transaction", status: "ok", content: JSON.stringify({ ok: true, rule: "計程車、高鐵都算差旅交通" }) });
    await insertAiMessage(line.id, { role: "assistant", status: "ok", content: `記好了：${day(0)} 差旅交通 NT$385（台灣大車隊）。分類照你教過的規則「計程車、高鐵都算差旅交通」。記錯了跟我說「復原」就好。` });
    count("ai_conversations", 1);
    count("ai_messages", 4);
  });

  // ---------------------------------------------------------------------------
  // 11. API key：一把已撤銷的示範 key。key_hash 是另一組隨機位元組的雜湊，原文從未存在過，
  //     任何呼叫都驗不過；而且已撤銷。prefix 只是畫面上辨識用。
  // ---------------------------------------------------------------------------
  await section("API key (revoked)", async () => {
    const neverAKey = createHash("sha256").update(randomBytes(32)).digest("hex");
    await db.insert(apiKeys).values({
      organizationId: ORG,
      createdByUserId: owner.id,
      name: "月報匯出腳本（已撤銷的示範金鑰）",
      prefix: "pik_demo0000",
      keyHash: neverAKey,
      scope: "read",
      createdAt: new Date(`${day(-60)}T10:00:00+08:00`).toISOString(),
      lastUsedAt: new Date(`${day(-14)}T09:30:00+08:00`).toISOString(),
      revokedAt: new Date(`${day(-12)}T18:00:00+08:00`).toISOString(),
      revokedByUserId: owner.id,
    });
    count("api_keys", 1);
  });

  // ---------------------------------------------------------------------------
  // 12. 使用紀錄（頁面瀏覽＋工具呼叫，近 30 天）
  // ---------------------------------------------------------------------------
  await section("usage events", async () => {
    const pages = ["/dashboard", "/dashboard/billing", "/dashboard/transactions", "/dashboard/links", "/dashboard/vendor-billing", "/dashboard/reports", "/dashboard/accounting", "/dashboard/ai", "/dashboard/contracts", "/dashboard/projects"];
    const tools: [string, string][] = [
      ["list_billing_status", "mcp"], ["create_transaction", "line"], ["list_unlinked_transactions", "ai"], ["get_financial_statement", "mcp"],
      ["set_payment_allocations", "ai"], ["list_vendor_billing_accounts", "api"], ["create_transaction", "ai"], ["monthly_spend_breakdown", "mcp"],
    ];
    // usage_events 來自 migrations/0047（#128）。schema.ts 還沒有這張表的定義，用原生 SQL 寫；
    // 資料庫還沒套 0047 就跳過這段。
    const [reg] = await db.select({ t: sql<string | null>`to_regclass('public.usage_events')::text` }).from(sql`(select 1) as one`);
    if (!reg?.t) {
      log("    (usage_events table not found — skipped)");
      return;
    }
    type U = { kind: string; channel: string; feature: string; ok: boolean; durationMs: number; createdAt: string };
    const values: U[] = [];
    for (let d = 29; d >= 0; d--) {
      const date = addDays(TODAY, -d);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const n = 3 + ((d * 7) % 5);
      for (let i = 0; i < n; i++) {
        const at = new Date(date);
        at.setHours(9 + ((i * 3 + d) % 9), (i * 17 + d * 7) % 60, 0, 0);
        if (at > new Date()) continue;
        if (i % 3 === 2) {
          const [feature, channel] = tools[(d + i) % tools.length];
          values.push({ kind: "tool", channel, feature, ok: (d + i) % 11 !== 0, durationMs: 300 + ((d * 37 + i * 91) % 2400), createdAt: at.toISOString() });
        } else {
          values.push({ kind: "page", channel: "web", feature: pages[(d * 3 + i) % pages.length], ok: true, durationMs: 120 + ((d * 13 + i * 29) % 600), createdAt: at.toISOString() });
        }
      }
    }
    await db.execute(sql`
      insert into usage_events (organization_id, user_id, kind, channel, feature, ok, duration_ms, created_at)
      values ${sql.join(
        values.map((v) => sql`(${ORG}, ${owner.id}, ${v.kind}, ${v.channel}, ${v.feature}, ${v.ok}, ${v.durationMs}, ${v.createdAt})`),
        sql`, `,
      )}`);
    count("usage_events", values.length);
  });

  // ---------------------------------------------------------------------------
  // 13. 復原：最後做幾個「真的操作」，並用 app 的 activity 紀錄記下來。entity_changes 由 trigger
  //     寫，logToolActivity 會認領剛剛那幾列並存下前後快照 → 操作紀錄頁這幾筆有「復原」可以按。
  //     必須在同一次執行、寫入後兩分鐘內記錄（captureChangeGroup 的認領時間窗）。
  // ---------------------------------------------------------------------------
  await section("undoable activity", async () => {
    // (1) LINE bot 記一筆計程車（對應上面的 LINE 對話）
    const [taxi] = await write("mcp", [
      row({ type: "expense", date: todayIso, amount: 385, currency: "TWD", description: "計程車 拜訪鷺洲物流", category: "差旅交通", party: party.taxi, from: twdAcct, book: "both" }),
    ]);
    await logToolActivity({ channel: "line", orgId: ORG, userId: owner.id, action: "create", entityType: "transaction", entityId: taxi.row.id, summary: "新增支出「計程車 拜訪鷺洲物流」NT$385", extra: { toolName: "create_transaction" } });

    // (2) 站內 AI 改了禾豐的聯絡信箱
    await db.update(parties).set({ contact: "ar@hefeng-foods.example" }).where(and(eq(parties.organizationId, ORG), eq(parties.id, party.hefeng)));
    await logToolActivity({ channel: "ai", orgId: ORG, userId: owner.id, action: "update", entityType: "party", entityId: party.hefeng, summary: "更新交易對象「禾豐食品」聯絡信箱", extra: { toolName: "update_party" } });

    // (3) MCP 幫第二期請款項目加註
    await db.update(billingItems).set({ note: "客戶要求改寄紙本請款單" }).where(and(eq(billingItems.organizationId, ORG), eq(billingItems.id, item.hefeng2)));
    await logToolActivity({ channel: "mcp", orgId: ORG, userId: owner.id, action: "update", entityType: "billing_item", entityId: item.hefeng2, summary: "更新請款項目「點餐系統 — 第二期」備註", extra: { toolName: "update_billing_item" } });

    // (4) LINE 上教了一條新規則
    const [rule] = await db
      .insert(aiRules)
      .values({ organizationId: ORG, scope: "org", userId: null, kind: "category", match: { partyContains: "Figma" }, action: { categoryId: cat("軟體訂閱"), categoryName: "軟體訂閱" }, text: "Figma 記軟體訂閱", createdBy: owner.id, source: "line" })
      .returning({ id: aiRules.id });
    await logToolActivity({ channel: "line", orgId: ORG, userId: owner.id, action: "create", entityType: "ai_rule", entityId: rule.id, summary: "新增 AI 規則「Figma 記軟體訂閱」", extra: { toolName: "create_ai_rule" } });
    count("ai_rules", 1);
    count("undoable_activity", 4);
  });

  return summary;
}
