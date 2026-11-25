import { and, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  billingItems,
  contracts,
  projects,
  subscriptionPeriods,
  subscriptions,
  transactions,
  vendorBillingAccounts,
} from "@/db/schema";
import { computeSubscriptionSchedule } from "@/db/queries";
import { getOrgTaxSetting } from "@/db/org-tax";
import { billingItemCollected, contractCollected, subscriptionPeriodCollected } from "@/db/allocations";
import { effectiveTaxSetting, taxedAmountOrNull, type TaxColumns } from "@/lib/tax-amounts";
import type { TaxSetting } from "@/lib/tax-treatment";
import { matchPartiesOf } from "@/lib/vendor-billing/account-meta";
import {
  decideAutoLink,
  feeTolerance,
  scoreCandidates,
  type LinkCandidate,
  type LinkKind,
  type ReviewReason,
} from "./match";
import type { PendingParty } from "./party";

/**
 * 連結層：交易「屬於誰」的推導，所有建立 / 更新交易的路徑都要經過這裡（src/lib/linking/write.ts
 * 是唯一能 insert / update transactions 的地方，src/lib/linking/guard.test.ts 會擋）。
 *
 * 規則（docs/data-links.md）：
 * 1. 繼承：請款項 → 合約、專案；訂閱 → 合約、專案；合約 → 專案；撥款 → 原代墊的專案、合約。
 *    只補空的，人或呼叫端給的值優先。
 * 2. 收入有客戶、卻沒有任何請款項 / 訂閱 / 合約時：在這位客戶開著的請款項、訂閱期別、合約裡
 *    找同幣別的候選，金額相符（容許匯款手續費）且唯一 → 自動掛；多個相符或都對不上 → 待連結。
 * 3. 支出有對象、沒有廠商計費帳戶時：這個對象剛好只有一個開著的廠商計費帳戶 → 掛上（固定支出
 *    「付了沒」看這個外鍵）。
 */

export type LinkSource =
  | "web"
  | "mcp"
  | "wise"
  | "vendor_billing"
  | "promotion"
  | "simpany"
  | "reimbursement"
  | "payroll"
  | "billing_board"
  | "pending_links"
  | "rescan";

export type LinkDraft = {
  type: string;
  txnDate: string;
  amount: string | number;
  currency: string;
  partyId: number | null;
  projectId?: number | null;
  contractId?: number | null;
  subscriptionId?: number | null;
  subscriptionPeriod?: string | null;
  billingItemId?: number | null;
  vendorBillingAccountId?: number | null;
  relatedToId?: number | null;
  /** 對象名稱很像既有對象、沒自動新建（同步用 hold 模式時） */
  pendingParty?: PendingParty | null;
  /** 這筆已經有收款分配（payment_allocations）＝人已經拆分好了，視同已連結、不再自動比對 */
  hasAllocations?: boolean;
  /** 既有的待連結狀態（更新時帶入）；link_skipped 代表人說過不要連，不再自動比對 */
  reviewReason?: string | null;
};

export type LinkContext = {
  db: Db;
  orgId: string;
  source: LinkSource;
  /** 收入沒連結時要不要自動比對候選。預設 true；更新時由 write.ts 決定。 */
  autoMatch?: boolean;
  /**
   * true = 只標待連結、不自動掛（重新掃描既有交易用：歷史資料一律給人確認）。
   */
  suggestOnly?: boolean;
  /** 更新時排除自己，不然「已收」會把這筆自己算進去 */
  excludeTransactionIds?: readonly number[];
};

export type LinkValues = {
  projectId: number | null;
  contractId: number | null;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  billingItemId: number | null;
  vendorBillingAccountId: number | null;
  reviewReason: ReviewReason | null;
  linkCandidates: Record<string, unknown> | null;
};

export type LinkedRef = {
  kind: LinkKind | "project" | "vendor_billing_account";
  id: number;
  name: string | null;
  /** given = 呼叫端給的；inherited = 從上層帶出來的；matched = 連結層比對到的 */
  via: "given" | "inherited" | "matched";
  subscriptionPeriod?: string;
};

export type Unlinked = {
  reason: ReviewReason;
  message: string;
  candidates: LinkCandidate[];
  party?: PendingParty;
};

export type LinkResolution = {
  values: LinkValues;
  links: LinkedRef[];
  unlinked: Unlinked | null;
};

type BillingItemRef = {
  id: number;
  title: string;
  contractId: number | null;
  projectId: number | null;
  customerPartyId: number;
  amount: string;
  currency: string;
  status: string;
  dueDate: string | null;
} & TaxColumns;
type SubscriptionRef = {
  id: number;
  name: string;
  contractId: number | null;
  projectId: number | null;
  customerPartyId: number;
  amount: string;
  currency: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  status: string;
} & TaxColumns;
type ContractRef = {
  id: number;
  title: string;
  projectId: number | null;
  customerPartyId: number;
  amount: string | null;
  currency: string;
  status: string;
} & TaxColumns;

const OPEN_CONTRACT = ["draft", "active"];
// 只排除取消的請款項。人工標「已收」但沒綁交易的也要當候選：還沒收的金額一律以綁定的交易算，
// 剛好就是要找回那筆沒綁上的收款。
const CLOSED_BILLING_ITEM = ["cancelled"];

function ids(list: readonly (number | null | undefined)[]): number[] {
  return [...new Set(list.filter((n): n is number => typeof n === "number" && n > 0))];
}

/** 一次把這批 draft 會用到的上層資料載進來。 */
async function loadRefs(ctx: LinkContext, drafts: readonly LinkDraft[], matchPartyIds: number[]) {
  const { db, orgId } = ctx;
  const biCols = {
    id: billingItems.id,
    title: billingItems.title,
    contractId: billingItems.contractId,
    projectId: billingItems.projectId,
    customerPartyId: billingItems.customerPartyId,
    amount: billingItems.amount,
    currency: billingItems.currency,
    status: billingItems.status,
    dueDate: billingItems.dueDate,
    taxTreatment: billingItems.taxTreatment,
    amountBasis: billingItems.amountBasis,
  };
  const subCols = {
    id: subscriptions.id,
    name: subscriptions.name,
    contractId: subscriptions.contractId,
    projectId: subscriptions.projectId,
    customerPartyId: subscriptions.customerPartyId,
    amount: subscriptions.amount,
    currency: subscriptions.currency,
    intervalMonths: subscriptions.intervalMonths,
    startDate: subscriptions.startDate,
    endDate: subscriptions.endDate,
    status: subscriptions.status,
    taxTreatment: subscriptions.taxTreatment,
    amountBasis: subscriptions.amountBasis,
  };
  const ctCols = {
    id: contracts.id,
    title: contracts.title,
    projectId: contracts.projectId,
    customerPartyId: contracts.customerPartyId,
    amount: contracts.amount,
    currency: contracts.currency,
    status: contracts.status,
    taxTreatment: contracts.taxTreatment,
    amountBasis: contracts.amountBasis,
  };

  const biIds = ids(drafts.map((d) => d.billingItemId));
  const subIds = ids(drafts.map((d) => d.subscriptionId));
  const advIds = ids(drafts.map((d) => d.relatedToId));

  const [givenBi, givenSub, advances, openBi, openSub, openCt] = await Promise.all([
    biIds.length
      ? db.select(biCols).from(billingItems).where(and(eq(billingItems.organizationId, orgId), inArray(billingItems.id, biIds)))
      : Promise.resolve([] as BillingItemRef[]),
    subIds.length
      ? db.select(subCols).from(subscriptions).where(and(eq(subscriptions.organizationId, orgId), inArray(subscriptions.id, subIds)))
      : Promise.resolve([] as SubscriptionRef[]),
    advIds.length
      ? db
          .select({ id: transactions.id, projectId: transactions.projectId, contractId: transactions.contractId })
          .from(transactions)
          .where(and(eq(transactions.organizationId, orgId), inArray(transactions.id, advIds)))
      : Promise.resolve([] as { id: number; projectId: number | null; contractId: number | null }[]),
    matchPartyIds.length
      ? db
          .select(biCols)
          .from(billingItems)
          .where(
            and(
              eq(billingItems.organizationId, orgId),
              inArray(billingItems.customerPartyId, matchPartyIds),
              isNull(billingItems.deletedAt),
              notInArray(billingItems.status, CLOSED_BILLING_ITEM),
            ),
          )
      : Promise.resolve([] as BillingItemRef[]),
    matchPartyIds.length
      ? db
          .select(subCols)
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, orgId),
              inArray(subscriptions.customerPartyId, matchPartyIds),
              isNull(subscriptions.deletedAt),
              eq(subscriptions.status, "active"),
            ),
          )
      : Promise.resolve([] as SubscriptionRef[]),
    matchPartyIds.length
      ? db
          .select(ctCols)
          .from(contracts)
          .where(
            and(
              eq(contracts.organizationId, orgId),
              inArray(contracts.customerPartyId, matchPartyIds),
              isNull(contracts.deletedAt),
              inArray(contracts.status, OPEN_CONTRACT),
            ),
          )
      : Promise.resolve([] as ContractRef[]),
  ]);

  const biById = new Map<number, BillingItemRef>([...givenBi, ...openBi].map((r) => [r.id, r]));
  const subById = new Map<number, SubscriptionRef>([...givenSub, ...openSub].map((r) => [r.id, r]));
  const advById = new Map(advances.map((r) => [r.id, r]));

  const ctIds = ids([
    ...drafts.map((d) => d.contractId),
    ...advances.map((a) => a.contractId),
    ...[...biById.values()].map((b) => b.contractId),
    ...[...subById.values()].map((s) => s.contractId),
  ]);
  const extraCt = ctIds.filter((id) => !openCt.some((c) => c.id === id));
  const moreCt = extraCt.length
    ? await db.select(ctCols).from(contracts).where(and(eq(contracts.organizationId, orgId), inArray(contracts.id, extraCt)))
    : [];
  const ctById = new Map<number, ContractRef>([...openCt, ...moreCt].map((r) => [r.id, r]));

  // 應收一律比含稅金額（入帳是客戶實際付的錢）：稅別照 請款項 / 訂閱自己 → 合約 → 組織 的順序沿用
  const orgTax: TaxSetting = matchPartyIds.length ? await getOrgTaxSetting(orgId) : { treatment: "none", basis: "net" };
  return { biById, subById, ctById, advById, openBi, openSub, openCt, orgTax };
}

type Refs = Awaited<ReturnType<typeof loadRefs>>;

/** 候選的「已收」：請款項、訂閱各期、合約（含收款分配與吸收的手續費）。 */
async function loadPaid(ctx: LinkContext, refs: Refs) {
  const { db, orgId } = ctx;
  const biIds = refs.openBi.map((b) => b.id);
  const subIds = refs.openSub.map((s) => s.id);
  const ctIds = refs.openCt.map((c) => c.id);
  // 已收一律走收款分配的「有效分配」（src/db/allocations.ts）：拆分過的入帳看分配列（含吸收的手續費），
  // 其餘看舊的單一綁定。跟請款看板、合約進度同一套口徑。
  // 不用排除更新中的那筆自己：會重新比對的交易都沒有任何綁定或分配，本來就不在已收裡。
  const [biPaid, subPaid, ctPaid, overrides] = await Promise.all([
    billingItemCollected(orgId, biIds, db),
    subscriptionPeriodCollected(orgId, subIds, db),
    contractCollected(orgId, ctIds, db),
    subIds.length
      ? db
          .select({
            subscriptionId: subscriptionPeriods.subscriptionId,
            periodStart: subscriptionPeriods.periodStart,
            expectedAmount: subscriptionPeriods.expectedAmount,
          })
          .from(subscriptionPeriods)
          .where(
            and(
              eq(subscriptionPeriods.organizationId, orgId),
              inArray(subscriptionPeriods.subscriptionId, subIds),
              isNull(subscriptionPeriods.deletedAt),
            ),
          )
      : Promise.resolve([]),
  ]);
  const sub = new Map<string, number>();
  for (const [id, periods] of subPaid) for (const p of periods) sub.set(`${id}:${p.periodStart}`, p.paid);
  return {
    bi: new Map([...biPaid].map(([id, c]) => [id, c.paid])),
    sub,
    ct: new Map([...ctPaid].map(([id, c]) => [id, c.paid])),
    overrideBySub: overridesBySub(overrides),
  };
}

/** 訂閱期別的金額覆寫，依訂閱分組。 */
function overridesBySub(
  rows: readonly { subscriptionId: number; periodStart: string; expectedAmount: string | null }[],
) {
  const out = new Map<number, { periodStart: string; expectedAmount: number | null }[]>();
  for (const o of rows) {
    const list = out.get(o.subscriptionId) ?? [];
    list.push({ periodStart: o.periodStart, expectedAmount: o.expectedAmount == null ? null : Number(o.expectedAmount) });
    out.set(o.subscriptionId, list);
  }
  return out;
}

type Paid = Awaited<ReturnType<typeof loadPaid>>;

/** 一個金額依有效稅別換成含稅應收（gross）。 */
function grossOf(refs: Refs, amount: number, own: TaxColumns, contractId: number | null, currency: string): number {
  const contract = contractId ? refs.ctById.get(contractId) : undefined;
  const setting = effectiveTaxSetting(refs.orgTax, own, contractId, contract ?? null);
  return taxedAmountOrNull(amount, setting, currency).gross ?? amount;
}

type RawCandidate = Omit<LinkCandidate, "gap" | "amountMatches">;

/** 某位客戶、某個幣別、某天的候選（還沒算 gap）。expected 一律是含稅應收減已收。 */
function rawCandidates(refs: Refs, paid: Paid, partyId: number, currency: string, txnDate: string): RawCandidate[] {
  // 有開著的請款項 / 訂閱的合約（不論幣別），合約本身就不再當候選
  const busyContracts = new Set<number>();
  return [
    ...billingItemCandidates(refs, paid, partyId, currency, txnDate, busyContracts),
    ...subscriptionCandidates(refs, paid, partyId, currency, txnDate, busyContracts),
    ...contractCandidates(refs, paid, partyId, currency, busyContracts),
  ];
}

function billingItemCandidates(
  refs: Refs,
  paid: Paid,
  partyId: number,
  currency: string,
  txnDate: string,
  busyContracts: Set<number>,
): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const b of refs.openBi) {
    if (b.customerPartyId !== partyId) continue;
    if (b.contractId) busyContracts.add(b.contractId);
    if (b.currency !== currency) continue;
    const c = billingItemCandidate(refs, paid, b, txnDate);
    if (c) out.push(c);
  }
  return out;
}

/** 請款項的應請款日最多可以比收款日晚幾天（預收）。 */
const DUE_AHEAD_DAYS = 60;

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 還沒收的金額在匯款手續費容許差以內 → 視同收齊，不再當候選。
 * 例：應收 13,060.17、實收 13,054.06，剩 6.11 是被扣的電匯費，不是還有一筆錢沒進來。
 */
function settled(remaining: number, gross: number, currency: string): boolean {
  return remaining <= 0 || remaining <= feeTolerance(gross, currency);
}

function billingItemCandidate(refs: Refs, paid: Paid, b: BillingItemRef, txnDate: string): RawCandidate | null {
  // 應請款日在收款日之後太久的不算（去年的匯款不會是明年那期的錢）
  if (b.dueDate && b.dueDate > addDaysIso(txnDate, DUE_AHEAD_DAYS)) return null;
  const gross = grossOf(refs, Number(b.amount), b, b.contractId, b.currency);
  const remaining = gross - (paid.bi.get(b.id) ?? 0);
  if (settled(remaining, gross, b.currency)) return null;
  const ct = b.contractId ? refs.ctById.get(b.contractId) : undefined;
  return {
    kind: "billing_item",
    id: b.id,
    label: ct ? `${ct.title}・${b.title}` : b.title,
    contractId: b.contractId,
    projectId: b.projectId ?? ct?.projectId ?? null,
    subscriptionPeriod: null,
    expected: round2(remaining),
    currency: b.currency,
  };
}

function subscriptionCandidates(
  refs: Refs,
  paid: Paid,
  partyId: number,
  currency: string,
  txnDate: string,
  busyContracts: Set<number>,
): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const s of refs.openSub) {
    if (s.customerPartyId !== partyId) continue;
    if (s.contractId) busyContracts.add(s.contractId);
    if (s.currency !== currency) continue;
    const c = subscriptionCandidate(refs, paid, s, txnDate);
    if (c) out.push(c);
  }
  return out;
}

/** 訂閱目前第一個還沒收齊的期別。 */
function subscriptionCandidate(refs: Refs, paid: Paid, s: SubscriptionRef, txnDate: string): RawCandidate | null {
  const paidByPeriod = [...paid.sub.entries()]
    .filter(([k]) => k.startsWith(`${s.id}:`))
    .map(([k, v]) => ({ periodStart: k.slice(String(s.id).length + 1), paid: v }));
  const gross = (n: number) => grossOf(refs, n, s, s.contractId, s.currency);
  const overrides = (paid.overrideBySub.get(s.id) ?? []).map((o) => ({
    ...o,
    expectedAmount: o.expectedAmount == null ? null : gross(o.expectedAmount),
    note: null,
    dueDate: null,
    billedOn: null,
    invoicedOn: null,
  }));
  const { periods } = computeSubscriptionSchedule(
    { ...s, amount: String(gross(Number(s.amount))) },
    paidByPeriod,
    overrides,
    txnDate,
  );
  const open = periods.find((p) => !settled(p.expected - p.paid, p.expected, s.currency));
  // 預收最多抓 DUE_AHEAD_DAYS 天後開始的期別（訂閱還沒開始前的匯款不會是它的錢）
  if (!open || open.periodStart > addDaysIso(txnDate, DUE_AHEAD_DAYS)) return null;
  const ct = s.contractId ? refs.ctById.get(s.contractId) : undefined;
  return {
    kind: "subscription",
    id: s.id,
    label: `${s.name}（${open.periodStart} 期）`,
    contractId: s.contractId,
    projectId: s.projectId ?? ct?.projectId ?? null,
    subscriptionPeriod: open.periodStart,
    expected: round2(open.expected - open.paid),
    currency: s.currency,
  };
}

// 合約本身只在它底下沒有開著的請款項 / 訂閱時才當候選（不然會跟子項目重複）
function contractCandidates(
  refs: Refs,
  paid: Paid,
  partyId: number,
  currency: string,
  busyContracts: Set<number>,
): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const c of refs.openCt) {
    if (c.customerPartyId !== partyId || c.currency !== currency || busyContracts.has(c.id)) continue;
    const amount = c.amount == null ? 0 : grossOf(refs, Number(c.amount), c, c.id, c.currency);
    const remaining = amount - (paid.ct.get(c.id) ?? 0);
    // NaN 金額也不當候選（跟 !(amount > 0) 同義）
    if (Number.isNaN(amount) || amount <= 0 || settled(remaining, amount, c.currency)) continue;
    out.push({
      kind: "contract",
      id: c.id,
      label: c.title,
      contractId: c.id,
      projectId: c.projectId,
      subscriptionPeriod: null,
      expected: round2(remaining),
      currency: c.currency,
    });
  }
  return out;
}

/** 掛上一個候選之後，同一批後面的交易要看到它「已收」增加了。 */
function consume(paid: Paid, pick: LinkCandidate, amount: number) {
  if (pick.kind === "billing_item") paid.bi.set(pick.id, (paid.bi.get(pick.id) ?? 0) + amount);
  else if (pick.kind === "subscription" && pick.subscriptionPeriod) {
    const k = `${pick.id}:${pick.subscriptionPeriod}`;
    paid.sub.set(k, (paid.sub.get(k) ?? 0) + amount);
  } else if (pick.kind === "contract") paid.ct.set(pick.id, (paid.ct.get(pick.id) ?? 0) + amount);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hasAnyLink(d: LinkDraft): boolean {
  return Boolean(d.billingItemId || d.subscriptionId || d.contractId || d.hasAllocations);
}

function wantsMatch(ctx: LinkContext, d: LinkDraft): boolean {
  return (
    ctx.autoMatch !== false &&
    d.type === "income" &&
    d.partyId != null &&
    !hasAnyLink(d) &&
    d.reviewReason !== "link_skipped" &&
    !d.pendingParty
  );
}

const REASON_MESSAGE: Record<string, string> = {
  link_suggested: "剛好一個金額相符的候選；這筆是既有交易，請確認後再掛上（或略過）。",
  link_ambiguous: "有多個金額相符的請款項 / 訂閱期別 / 合約，請從候選裡選一個（或略過）。",
  link_amount_mismatch: "這位客戶有開著的請款項 / 訂閱 / 合約，但金額都對不上，請確認要掛哪一個（或略過）。",
  party_similar: "對象名稱跟既有對象很像，沒有自動新建；請選既有對象（會把這個名稱加成別名）或確認新建。",
};

export function reviewMessage(reason: string): string {
  return REASON_MESSAGE[reason] ?? "";
}

/** 繼承：從請款項 / 訂閱 / 合約 / 代墊帶出合約與專案。 */
function inherit(d: LinkDraft, refs: Refs, links: LinkedRef[]): LinkValues {
  const v: LinkValues = {
    projectId: d.projectId ?? null,
    contractId: d.contractId ?? null,
    subscriptionId: d.subscriptionId ?? null,
    subscriptionPeriod: d.subscriptionId ? (d.subscriptionPeriod ?? null) : null,
    billingItemId: d.billingItemId ?? null,
    vendorBillingAccountId: d.vendorBillingAccountId ?? null,
    reviewReason: null,
    linkCandidates: null,
  };
  const given = (kind: LinkedRef["kind"], id: number | null, name: string | null, extra?: Partial<LinkedRef>) => {
    if (id) links.push({ kind, id, name, via: "given", ...extra });
  };
  const bi = v.billingItemId ? refs.biById.get(v.billingItemId) : undefined;
  const sub = v.subscriptionId ? refs.subById.get(v.subscriptionId) : undefined;
  given("billing_item", v.billingItemId, bi?.title ?? null);
  given("subscription", v.subscriptionId, sub?.name ?? null, v.subscriptionPeriod ? { subscriptionPeriod: v.subscriptionPeriod } : {});
  given("contract", v.contractId, v.contractId ? (refs.ctById.get(v.contractId)?.title ?? null) : null);
  given("project", v.projectId, null);

  const fill = (field: "contractId" | "projectId", value: number | null | undefined) => {
    if (v[field] == null && value) {
      v[field] = value;
      if (field === "contractId") {
        links.push({ kind: "contract", id: value, name: refs.ctById.get(value)?.title ?? null, via: "inherited" });
      } else {
        links.push({ kind: "project", id: value, name: null, via: "inherited" });
      }
    }
  };
  if (bi) {
    fill("contractId", bi.contractId);
    fill("projectId", bi.projectId);
  }
  if (sub) {
    fill("contractId", sub.contractId);
    fill("projectId", sub.projectId);
  }
  const adv = d.relatedToId ? refs.advById.get(d.relatedToId) : undefined;
  if (adv) {
    fill("contractId", adv.contractId);
    fill("projectId", adv.projectId);
  }
  if (v.contractId) fill("projectId", refs.ctById.get(v.contractId)?.projectId);
  return v;
}

/** 把比對到的候選套上去（再走一次繼承）。 */
function applyPick(v: LinkValues, pick: LinkCandidate, refs: Refs, links: LinkedRef[]) {
  if (pick.kind === "billing_item") v.billingItemId = pick.id;
  if (pick.kind === "subscription") {
    v.subscriptionId = pick.id;
    v.subscriptionPeriod = pick.subscriptionPeriod;
  }
  if (pick.kind === "contract") v.contractId = pick.id;
  links.push({
    kind: pick.kind,
    id: pick.id,
    name: pick.label,
    via: "matched",
    ...(pick.subscriptionPeriod ? { subscriptionPeriod: pick.subscriptionPeriod } : {}),
  });
  if (v.contractId == null && pick.contractId) {
    v.contractId = pick.contractId;
    links.push({ kind: "contract", id: pick.contractId, name: refs.ctById.get(pick.contractId)?.title ?? null, via: "inherited" });
  }
  if (v.projectId == null && pick.projectId) {
    v.projectId = pick.projectId;
    links.push({ kind: "project", id: pick.projectId, name: null, via: "inherited" });
  }
}

async function loadVendorAccounts(ctx: LinkContext, partyIds: number[]) {
  if (partyIds.length === 0) return new Map<number, { id: number; name: string }[]>();
  const rows = await ctx.db
    .select({
      id: vendorBillingAccounts.id,
      name: vendorBillingAccounts.displayName,
      partyId: vendorBillingAccounts.partyId,
      meta: vendorBillingAccounts.meta,
    })
    .from(vendorBillingAccounts)
    .where(
      and(
        eq(vendorBillingAccounts.organizationId, ctx.orgId),
        isNull(vendorBillingAccounts.deletedAt),
        ne(vendorBillingAccounts.status, "closed"),
        or(
          inArray(vendorBillingAccounts.partyId, partyIds),
          sql`${vendorBillingAccounts.meta} ? 'matchPartyIds'`,
        ),
      ),
    );
  const byParty = new Map<number, { id: number; name: string }[]>();
  for (const r of rows) {
    for (const p of matchPartiesOf(r)) {
      const list = byParty.get(p) ?? [];
      list.push({ id: r.id, name: r.name });
      byParty.set(p, list);
    }
  }
  return byParty;
}

async function projectNames(ctx: LinkContext, links: LinkedRef[][]) {
  const pids = ids(links.flat().filter((l) => l.kind === "project").map((l) => l.id));
  if (pids.length === 0) return;
  const rows = await ctx.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.organizationId, ctx.orgId), inArray(projects.id, pids)));
  const name = new Map(rows.map((r) => [r.id, r.name]));
  for (const l of links.flat()) if (l.kind === "project") l.name = name.get(l.id) ?? null;
}

/**
 * 一批交易一起推導（同步一次幾十筆，候選只查一次）。回傳順序跟 drafts 一樣。
 * 同一批裡比對到同一個候選時，後面的交易會看到前面已經收的錢（依日期先後）。
 */
export async function resolveLinksMany(drafts: readonly LinkDraft[], ctx: LinkContext): Promise<LinkResolution[]> {
  const matchPartyIds = ids(drafts.filter((d) => wantsMatch(ctx, d)).map((d) => d.partyId));
  const refs = await loadRefs(ctx, drafts, matchPartyIds);
  const paid = matchPartyIds.length ? await loadPaid(ctx, refs) : null;
  const vendorPartyIds = ids(
    drafts.filter((d) => d.type === "expense" && !d.vendorBillingAccountId).map((d) => d.partyId),
  );
  const vendorAccounts = await loadVendorAccounts(ctx, vendorPartyIds);

  const out: LinkResolution[] = new Array(drafts.length);
  const order = drafts.map((d, i) => i).sort((a, b) => drafts[a].txnDate.localeCompare(drafts[b].txnDate) || a - b);
  for (const i of order) {
    const d = drafts[i];
    const links: LinkedRef[] = [];
    const v = inherit(d, refs, links);
    const unlinked = resolveReview(d, v, links, ctx, refs, paid);
    linkVendorAccount(d, v, links, vendorAccounts);
    out[i] = { values: v, links, unlinked };
  }
  await projectNames(ctx, out.map((r) => r.links));
  return out;
}

/** 一筆 draft 的待連結狀態：對象待確認、略過，或比對客戶的候選（自動掛或標待連結）。 */
function resolveReview(
  d: LinkDraft,
  v: LinkValues,
  links: LinkedRef[],
  ctx: LinkContext,
  refs: Refs,
  paid: Paid | null,
): Unlinked | null {
  if (d.pendingParty) {
    v.reviewReason = "party_similar";
    v.linkCandidates = { party: d.pendingParty };
    return { reason: "party_similar", message: reviewMessage("party_similar"), candidates: [], party: d.pendingParty };
  }
  if (d.reviewReason === "link_skipped" && !hasAnyLink(d)) {
    v.reviewReason = "link_skipped";
    return null;
  }
  if (paid && wantsMatch(ctx, d) && d.partyId != null) return matchDraft(d, d.partyId, v, links, ctx, refs, paid);
  return null;
}

/** 比對客戶開著的候選：唯一相符就掛上（並記進已收），否則標待連結。 */
function matchDraft(
  d: LinkDraft,
  partyId: number,
  v: LinkValues,
  links: LinkedRef[],
  ctx: LinkContext,
  refs: Refs,
  paid: Paid,
): Unlinked | null {
  const amount = Number(d.amount);
  const candidates = scoreCandidates(rawCandidates(refs, paid, partyId, d.currency, d.txnDate), amount);
  const decision = decideAutoLink(candidates);
  if (decision.kind === "none") return null;
  if (decision.kind === "link" && !ctx.suggestOnly) {
    applyPick(v, decision.pick, refs, links);
    consume(paid, decision.pick, amount);
    return null;
  }
  const reason = decision.kind === "review" ? decision.reason : "link_suggested";
  const list = decision.kind === "review" ? decision.candidates : [decision.pick];
  v.reviewReason = reason;
  v.linkCandidates = { links: list };
  return { reason, message: reviewMessage(reason), candidates: list };
}

/** 支出沒給廠商計費帳戶、對象剛好只有一個 → 掛上；有給的就記成 given。 */
function linkVendorAccount(
  d: LinkDraft,
  v: LinkValues,
  links: LinkedRef[],
  vendorAccounts: Map<number, { id: number; name: string }[]>,
) {
  if (d.type === "expense" && !v.vendorBillingAccountId && d.partyId != null) {
    const accts = vendorAccounts.get(d.partyId) ?? [];
    if (accts.length === 1) {
      v.vendorBillingAccountId = accts[0].id;
      links.push({ kind: "vendor_billing_account", id: accts[0].id, name: accts[0].name, via: "matched" });
    }
  } else if (v.vendorBillingAccountId) {
    links.push({ kind: "vendor_billing_account", id: v.vendorBillingAccountId, name: null, via: "given" });
  }
}

/** 單筆版。 */
export async function resolveLinks(draft: LinkDraft, ctx: LinkContext): Promise<LinkResolution> {
  const [r] = await resolveLinksMany([draft], ctx);
  return r;
}
