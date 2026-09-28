import { and, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bankAccounts, parties, transactions } from "@/db/schema";
import { getIntegration, updateConfig } from "@/lib/integrations/store";
import type { IntegrationConfig } from "@/lib/integrations/types";
import {
  discoverAccounts,
  withWiseClient,
  type WiseBalanceSummary,
  type WiseClient,
  type WiseProfileSummary,
  type WiseStatementTransaction,
} from "@/lib/integrations/wise";

/**
 * Wise 對帳單 → 本組織帳本（transactions）的同步。
 *
 * 只「讀」Wise（見 src/lib/integrations/wise.ts 的唯讀白名單），只「寫」自己的帳本。
 *
 * 規則（docs/integrations.md 的 Wise 一節有同樣的說明）：
 * - 只同步「有對應到帳本帳戶」的 Wise 餘額；沒對應的列在結果的 skippedBalances。
 * - 每個對應有自己的 syncFrom（切換日，YYYY-MM-DD，台北日期）：這天以前的 Wise 交易
 *   一律不寫，避免跟過去手動輸入的月彙總重複。沒設 syncFrom 的對應不會同步。
 * - 每次從 max(syncFrom, 這個帳戶上最後一筆 Wise 交易日 − 3 天) 抓到現在，按月切塊。
 * - 去重鍵是 (org, 'wise', referenceNumber)，DB 有部分唯一索引；寫入用
 *   ON CONFLICT DO NOTHING。已存在（含已軟刪除）的列永遠不改、不重寫。
 * - CREDIT → income、DEBIT → expense；分類留空（未分類）、needs_review = true、
 *   book = 'internal'（與過去手動輸入的 Wise 列一致）。
 * - 換匯（CONVERSION）：本帳本一列只有一個幣別，不支援跨幣轉帳。所以換匯的兩腳各記一列
 *   「單腳轉帳」（type = transfer，只填自己這邊的帳戶）—— 不影響損益、帳戶餘額正確。
 *   兩腳共用同一個 referenceNumber，所以 external_ref 加上幣別後綴（`BALANCE-123:USD`）。
 *   若另一腳的餘額沒有對應，就退回 income / expense 並標 needs_review。
 * - dryRun 只算不寫：回傳每個帳戶會新增幾筆與前 50 筆樣本。
 */

const SOURCE = "wise";
const TZ = "Asia/Taipei";
const OVERLAP_DAYS = 3;
const SAMPLE_LIMIT = 50;
const INSERT_CHUNK = 500;
const CONVERSION_PARTY = "Wise 換匯";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type WiseAccountMapping = {
  profileId: number;
  balanceId: number;
  currency: string;
  bankAccountId: number | null;
  /** 切換日（台北日期 YYYY-MM-DD）；null = 尚未設定，不同步。 */
  syncFrom: string | null;
};

export type WiseConfig = {
  profiles: WiseProfileSummary[];
  balances: WiseBalanceSummary[];
  accountMappings: WiseAccountMapping[];
  /** 全域切換日；對應本身沒設 syncFrom 時用這個。 */
  syncFrom: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 字串 / 數字 / 布林轉成文字；其他（物件、null…）用 fallback，避免變成 "[object Object]"。 */
function text(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

/** 從 org_integrations.config 讀出 Wise 設定；形狀不對的項目直接略過。 */
export function parseWiseConfig(config: IntegrationConfig | null | undefined): WiseConfig {
  const c = config ?? {};
  const profiles = Array.isArray(c.profiles)
    ? (c.profiles as unknown[]).flatMap((p) => {
        const o = p as Record<string, unknown>;
        const id = num(o?.id);
        return id === null
          ? []
          : [{ id, type: text(o.type, ""), name: text(o.name, String(id)) }];
      })
    : [];
  const balances = Array.isArray(c.balances)
    ? (c.balances as unknown[]).flatMap((b) => {
        const o = b as Record<string, unknown>;
        const profileId = num(o?.profileId);
        const balanceId = num(o?.balanceId);
        if (profileId === null || balanceId === null || typeof o.currency !== "string") return [];
        return [
          {
            profileId,
            balanceId,
            currency: o.currency.toUpperCase(),
            amount: num(o.amount),
            fetchedAt: typeof o.fetchedAt === "string" ? o.fetchedAt : "",
          },
        ];
      })
    : [];
  const accountMappings = Array.isArray(c.accountMappings)
    ? (c.accountMappings as unknown[]).flatMap((m) => {
        const o = m as Record<string, unknown>;
        const profileId = num(o?.profileId);
        const balanceId = num(o?.balanceId);
        if (profileId === null || balanceId === null || typeof o.currency !== "string") return [];
        return [
          {
            profileId,
            balanceId,
            currency: o.currency.toUpperCase(),
            bankAccountId: num(o.bankAccountId),
            syncFrom: isIsoDate(o.syncFrom) ? o.syncFrom : null,
          },
        ];
      })
    : [];
  return {
    profiles,
    balances,
    accountMappings,
    syncFrom: isIsoDate(c.syncFrom) ? c.syncFrom : null,
  };
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

const taipeiFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO 時間點 → 台北日期 YYYY-MM-DD。 */
export function taipeiDate(iso: string | Date): string {
  return taipeiFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** 台北日期當天 00:00 對應的 UTC ISO 時間點。 */
export function taipeiStartUtc(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstOfNextMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** [start, now) 切成按月（台北日曆月）的區間，回 UTC ISO。 */
export function monthlyChunks(startDate: string, now = new Date()): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const endMs = now.getTime();
  let cur = startDate;
  while (new Date(taipeiStartUtc(cur)).getTime() < endMs) {
    const next = firstOfNextMonth(cur);
    const nextMs = new Date(taipeiStartUtc(next)).getTime();
    out.push({
      start: taipeiStartUtc(cur),
      end: new Date(Math.min(nextMs, endMs)).toISOString(),
    });
    cur = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 切換日建議
// ---------------------------------------------------------------------------

/**
 * 每個帳本帳戶的建議切換日：這個帳戶上最後一筆「非 Wise 同步」交易的下個月 1 號。
 * 帳戶上沒有任何交易時，建議本月 1 號（台北）。
 */
export async function suggestSyncFrom(
  orgId: string,
  bankAccountIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(bankAccountIds)];
  if (ids.length === 0) return out;
  const db = getDb();
  const base = and(
    eq(transactions.organizationId, orgId),
    isNull(transactions.deletedAt),
    or(isNull(transactions.externalSource), sql`${transactions.externalSource} <> ${SOURCE}`),
  );
  // 帳戶可能出現在 from 或 to，兩邊各 group 一次再取較晚者。
  const [fromRows, toRows] = await Promise.all([
    db
      .select({ accountId: transactions.fromAccountId, last: max(transactions.txnDate) })
      .from(transactions)
      .where(and(base, inArray(transactions.fromAccountId, ids)))
      .groupBy(transactions.fromAccountId),
    db
      .select({ accountId: transactions.toAccountId, last: max(transactions.txnDate) })
      .from(transactions)
      .where(and(base, inArray(transactions.toAccountId, ids)))
      .groupBy(transactions.toAccountId),
  ]);
  const lastById = new Map<number, string>();
  for (const r of [...fromRows, ...toRows]) {
    if (r.accountId === null || !r.last) continue;
    const d = String(r.last).slice(0, 10);
    const prev = lastById.get(r.accountId);
    if (!prev || d > prev) lastById.set(r.accountId, d);
  }
  const thisMonth = `${taipeiDate(new Date()).slice(0, 7)}-01`;
  for (const id of ids) {
    const last = lastById.get(id);
    out.set(id, last ? firstOfNextMonth(last) : thisMonth);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 儲存對應（web 設定頁）
// ---------------------------------------------------------------------------

export type MappingInput = {
  profileId: number;
  balanceId: number;
  bankAccountId: number | null;
  syncFrom: string | null;
};

/**
 * 驗證並寫入帳戶對應。回傳錯誤字串（給人看）或 null。
 * - 餘額必須是 config.balances 裡發現過的；
 * - 帳本帳戶必須屬於本組織、未刪除，幣別必須與 Wise 餘額相同；
 * - 同一個帳本帳戶只能對應一個 Wise 餘額；
 * - 有對應帳戶但沒填 syncFrom 時，存成建議切換日。
 */
export async function saveWiseMappings(
  orgId: string,
  input: MappingInput[],
): Promise<{ error: string } | { mappings: WiseAccountMapping[] }> {
  const integ = await getIntegration(orgId, "wise");
  if (!integ) return { error: "Wise 尚未連接" };
  const cfg = parseWiseConfig(integ.config);
  const accountIds = input.map((m) => m.bankAccountId).filter((x): x is number => x !== null);
  const accounts = await loadOrgAccounts(getDb(), orgId, accountIds);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seenAccounts = new Set<number>();
  const out: WiseAccountMapping[] = [];
  for (const m of input) {
    const checked = validateMapping(m, cfg, byId, seenAccounts);
    if ("error" in checked) return checked;
    out.push(checked.mapping);
  }
  await fillSuggestedSyncFrom(orgId, out);
  await updateConfig(orgId, "wise", { accountMappings: out });
  return { mappings: out };
}

type AccountRow = { id: number; name: string; currency: string };

/** 讀本組織、未刪除的帳本帳戶（只取 id / 名稱 / 幣別）。 */
async function loadOrgAccounts(db: Db, orgId: string, ids: number[]): Promise<AccountRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.organizationId, orgId),
        inArray(bankAccounts.id, ids),
        isNull(bankAccounts.deletedAt),
      ),
    );
}

/** 驗證單一對應；通過就回傳要存的對應（syncFrom 可能仍是 null，稍後補建議值）。 */
function validateMapping(
  m: MappingInput,
  cfg: WiseConfig,
  byId: Map<number, AccountRow>,
  seenAccounts: Set<number>,
): { error: string } | { mapping: WiseAccountMapping } {
  const bal = cfg.balances.find((b) => b.balanceId === m.balanceId && b.profileId === m.profileId);
  if (!bal) return { error: `找不到 Wise 餘額 #${m.balanceId}，請先重新整理餘額` };
  if (m.syncFrom !== null && !isIsoDate(m.syncFrom)) {
    return { error: `切換日格式錯誤：${m.syncFrom}（應為 YYYY-MM-DD）` };
  }
  if (m.bankAccountId !== null) {
    const error = checkMappedAccount(byId.get(m.bankAccountId), m.bankAccountId, bal.currency, seenAccounts);
    if (error) return { error };
  }
  return {
    mapping: {
      profileId: bal.profileId,
      balanceId: bal.balanceId,
      currency: bal.currency,
      bankAccountId: m.bankAccountId,
      syncFrom: m.syncFrom,
    },
  };
}

/** 帳本帳戶存在、幣別相符、且沒被重複對應；通過時記進 seenAccounts。 */
function checkMappedAccount(
  acct: AccountRow | undefined,
  bankAccountId: number,
  currency: string,
  seenAccounts: Set<number>,
): string | null {
  if (!acct) return `找不到帳本帳戶 #${bankAccountId}`;
  if (acct.currency.trim().toUpperCase() !== currency) {
    return `「${acct.name}」是 ${acct.currency.trim()} 帳戶，不能對應 Wise 的 ${currency} 餘額`;
  }
  if (seenAccounts.has(acct.id)) {
    return `「${acct.name}」被對應到兩個 Wise 餘額，一個帳本帳戶只能對應一個`;
  }
  seenAccounts.add(acct.id);
  return null;
}

/** 有對應帳戶但沒填 syncFrom 的，補上建議切換日（就地修改）。 */
async function fillSuggestedSyncFrom(orgId: string, mappings: WiseAccountMapping[]): Promise<void> {
  const needSuggestion = mappings
    .filter((m) => m.bankAccountId !== null && m.syncFrom === null)
    .map((m) => m.bankAccountId as number);
  if (needSuggestion.length === 0) return;
  const suggested = await suggestSyncFrom(orgId, needSuggestion);
  for (const m of mappings) {
    if (m.bankAccountId !== null && m.syncFrom === null) {
      m.syncFrom = suggested.get(m.bankAccountId) ?? null;
    }
  }
}

/** 重新向 Wise 抓 profile 與餘額（唯讀），寫回 config。整合必須已開啟。 */
export async function refreshWiseBalances(orgId: string): Promise<WiseConfig> {
  const discovered = await withWiseClient(orgId, (client) => discoverAccounts(client));
  const cfg = await updateConfig(orgId, "wise", discovered);
  return parseWiseConfig(cfg);
}

// ---------------------------------------------------------------------------
// Wise 交易 → 帳本列
// ---------------------------------------------------------------------------

export type PlannedRow = {
  bankAccountId: number;
  type: "income" | "expense" | "transfer";
  txnDate: string;
  amount: string;
  currency: string;
  partyName: string | null;
  description: string;
  externalRef: string;
  externalMeta: Record<string, unknown>;
  needsReview: boolean;
  fromAccountId: number | null;
  toAccountId: number | null;
};

type ResolvedMapping = WiseAccountMapping & { bankAccountId: number };

type WiseDetails = NonNullable<WiseStatementTransaction["details"]>;
type WiseMoney = WiseStatementTransaction["amount"];

function fmtAmount(v: number): string {
  return Math.abs(v).toFixed(2);
}

function feeLabel(fee: WiseMoney): string {
  return `fee ${fmtAmount(fee.value)} ${fee.currency}`;
}

function recipientName(r: unknown): string | null {
  if (!r) return null;
  if (typeof r === "string") return r;
  const n = (r as { name?: unknown }).name;
  return typeof n === "string" && n.trim() ? n : null;
}

function counterCurrencyOf(tx: WiseStatementTransaction, ownCurrency: string): string | null {
  const ex = tx.exchangeDetails;
  const d = tx.details;
  const candidates = [
    ex?.fromAmount?.currency,
    ex?.toAmount?.currency,
    d?.sourceAmount?.currency,
    d?.targetAmount?.currency,
  ];
  for (const c of candidates) {
    if (c && c.toUpperCase() !== ownCurrency) return c.toUpperCase();
  }
  return null;
}

/** CREDIT 進帳記在 to，DEBIT 出帳記在 from。 */
function accountSides(
  isCredit: boolean,
  bankAccountId: number,
): { fromAccountId: number | null; toAccountId: number | null } {
  return isCredit
    ? { fromAccountId: null, toAccountId: bankAccountId }
    : { fromAccountId: bankAccountId, toAccountId: null };
}

function merchantMeta(merchant: NonNullable<WiseDetails["merchant"]>): Record<string, unknown> {
  return {
    name: merchant.name ?? null,
    city: merchant.city ?? null,
    country: merchant.country ?? null,
    category: merchant.category ?? null,
  };
}

/** 寫進 external_meta 的原始資訊。 */
function buildMeta(
  tx: WiseStatementTransaction,
  d: WiseDetails,
  dtype: string,
  m: ResolvedMapping,
  rate: number | null,
  fee: WiseMoney | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    referenceNumber: tx.referenceNumber,
    wiseType: tx.type,
    detailsType: dtype,
    dateTime: tx.date,
    profileId: m.profileId,
    balanceId: m.balanceId,
  };
  if (d.category) meta.category = d.category;
  if (d.merchant) meta.merchant = merchantMeta(d.merchant);
  if (d.amount) meta.originalAmount = { value: d.amount.value, currency: d.amount.currency };
  if (rate !== null) meta.exchangeRate = rate;
  if (fee) meta.fees = { value: fee.value, currency: fee.currency };
  if (d.cardLastFourDigits) meta.cardLastFour = d.cardLastFourDigits;
  if (d.cardHolderFullName) meta.cardHolder = d.cardHolderFullName;
  if (tx.runningBalance) meta.runningBalance = tx.runningBalance.value;
  return meta;
}

function conversionDescription(
  tx: WiseStatementTransaction,
  d: WiseDetails,
  rate: number | null,
  fee: WiseMoney | null,
): string {
  const from = tx.exchangeDetails?.fromAmount;
  const to = tx.exchangeDetails?.toAmount;
  let main: string;
  if (from && to) {
    const rateText = rate ? ` @ ${rate}` : "";
    main = `Wise 換匯 ${from.currency} ${Math.abs(from.value)} → ${to.currency} ${Math.abs(to.value)}${rateText}`;
  } else {
    main = `Wise 換匯 ${d.description ?? ""}`.trim();
  }
  return [main, fee ? feeLabel(fee) : null].filter(Boolean).join(" · ");
}

/**
 * 換匯的其中一腳：另一腳的餘額有對應 → 單腳轉帳；沒有 → 退回 income / expense 並標 needs_review。
 */
function mapConversion(
  tx: WiseStatementTransaction,
  d: WiseDetails,
  m: ResolvedMapping,
  all: readonly WiseAccountMapping[],
  meta: Record<string, unknown>,
  rate: number | null,
  fee: WiseMoney | null,
): PlannedRow {
  const isCredit = tx.type === "CREDIT";
  const currency = m.currency;
  const counter = counterCurrencyOf(tx, currency);
  const counterMapping = counter
    ? all.find((x) => x.profileId === m.profileId && x.currency === counter && x.bankAccountId !== null)
    : undefined;
  meta.conversion = {
    counterCurrency: counter,
    counterBankAccountId: counterMapping?.bankAccountId ?? null,
  };
  const base = {
    bankAccountId: m.bankAccountId,
    txnDate: taipeiDate(tx.date),
    amount: fmtAmount(tx.amount.value),
    currency,
    description: conversionDescription(tx, d, rate, fee),
    externalRef: `${tx.referenceNumber}:${currency}`,
    externalMeta: meta,
    ...accountSides(isCredit, m.bankAccountId),
  };
  if (counterMapping) {
    return { ...base, type: "transfer", partyName: null, needsReview: false };
  }
  return {
    ...base,
    type: isCredit ? "income" : "expense",
    partyName: CONVERSION_PARTY,
    needsReview: true,
  };
}

function partyNameOf(d: WiseDetails): string {
  return (
    d.merchant?.name?.trim() ||
    d.senderName?.trim() ||
    recipientName(d.recipient) ||
    d.description?.trim() ||
    "Wise"
  );
}

/** 一筆 Wise 對帳單交易 → 一列帳本交易（尚未寫入）。 */
export function mapWiseTransaction(
  tx: WiseStatementTransaction,
  m: ResolvedMapping,
  all: readonly WiseAccountMapping[],
): PlannedRow {
  const d: WiseDetails = tx.details ?? {};
  const dtype = (d.type ?? "UNKNOWN").toUpperCase();
  const isCredit = tx.type === "CREDIT";
  const currency = m.currency;
  const fee = tx.totalFees?.value ? tx.totalFees : null;
  const orig = d.amount?.currency && d.amount.currency.toUpperCase() !== currency ? d.amount : null;
  const rate = tx.exchangeDetails?.rate ?? d.rate ?? null;
  const meta = buildMeta(tx, d, dtype, m, rate, fee);

  if (dtype === "CONVERSION") return mapConversion(tx, d, m, all, meta, rate, fee);

  const suffix: string[] = [];
  if (orig) suffix.push(`${orig.currency} ${Math.abs(orig.value)}`);
  if (fee) suffix.push(feeLabel(fee));
  const description = [d.description?.trim() || dtype, ...suffix].join(" · ");
  return {
    bankAccountId: m.bankAccountId,
    type: isCredit ? "income" : "expense",
    txnDate: taipeiDate(tx.date),
    amount: fmtAmount(tx.amount.value),
    currency,
    partyName: partyNameOf(d).slice(0, 200),
    description,
    externalRef: tx.referenceNumber,
    externalMeta: meta,
    needsReview: true,
    ...accountSides(isCredit, m.bankAccountId),
  };
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

export type SyncAccountResult = {
  bankAccountId: number;
  bankAccountName: string;
  profileId: number;
  profileName: string;
  balanceId: number;
  currency: string;
  syncFrom: string;
  rangeStart: string;
  rangeEnd: string;
  fetched: number;
  beforeCutover: number;
  alreadySynced: number;
  /** dryRun：會新增幾筆；實際寫入：新增了幾筆。 */
  created: number;
  needsReview: number;
};

export type SkippedBalance = {
  profileId: number;
  profileName: string;
  balanceId: number;
  currency: string;
  reason: "unmapped" | "no_sync_from" | "account_missing" | "currency_mismatch";
};

export type SyncResult = {
  dryRun: boolean;
  accounts: SyncAccountResult[];
  skippedBalances: SkippedBalance[];
  totals: { created: number; alreadySynced: number; beforeCutover: number };
  /** 同一次抓回來的資料裡，同一個鍵出現兩次（第二筆沒寫）。 */
  duplicateRefs: string[];
  sample: {
    bankAccountId: number;
    txnDate: string;
    type: string;
    amount: string;
    currency: string;
    partyName: string | null;
    description: string;
    externalRef: string;
    needsReview: boolean;
  }[];
};

export type SyncOptions = {
  /** 只同步這個帳本帳戶（必須已對應）。 */
  accountId?: number;
  /** 覆寫起始日（台北日期）；不得早於該對應的切換日。 */
  startDate?: string;
  dryRun: boolean;
};

async function lastWiseDate(db: Db, orgId: string, accountId: number): Promise<string | null> {
  const [row] = await db
    .select({ last: max(transactions.txnDate) })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.externalSource, SOURCE),
        or(eq(transactions.fromAccountId, accountId), eq(transactions.toAccountId, accountId)),
      ),
    );
  return row?.last ? String(row.last).slice(0, 10) : null;
}

async function existingRefs(db: Db, orgId: string, refs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < refs.length; i += INSERT_CHUNK) {
    const chunk = refs.slice(i, i + INSERT_CHUNK);
    const rows = await db
      .select({ ref: transactions.externalRef })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.externalSource, SOURCE),
          inArray(transactions.externalRef, chunk),
        ),
      );
    for (const r of rows) if (r.ref) out.add(r.ref);
  }
  return out;
}

async function resolveParties(
  db: Db,
  orgId: string,
  labelByName: Map<string, string>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const names = [...labelByName.keys()];
  if (names.length === 0) return map;
  const existing = await db
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), inArray(parties.name, names)));
  for (const r of existing) if (!map.has(r.name)) map.set(r.name, r.id);
  const missing = names.filter((n) => !map.has(n));
  if (missing.length) {
    const created = await db
      .insert(parties)
      .values(missing.map((name) => ({ organizationId: orgId, name, label: labelByName.get(name)! })))
      .returning({ id: parties.id, name: parties.name });
    for (const r of created) map.set(r.name, r.id);
  }
  return map;
}

async function fetchStatementRange(
  client: WiseClient,
  m: WiseAccountMapping,
  startDate: string,
  now: Date,
): Promise<WiseStatementTransaction[]> {
  const out: WiseStatementTransaction[] = [];
  for (const chunk of monthlyChunks(startDate, now)) {
    const st = await client.getStatement(m.profileId, m.balanceId, m.currency, chunk.start, chunk.end);
    out.push(...(st.transactions ?? []));
  }
  return out;
}

function compareStr(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

type ProfileNameFn = (id: number) => string;

function skippedEntry(
  b: { profileId: number; balanceId: number; currency: string },
  profileName: ProfileNameFn,
  reason: SkippedBalance["reason"],
): SkippedBalance {
  return {
    profileId: b.profileId,
    profileName: profileName(b.profileId),
    balanceId: b.balanceId,
    currency: b.currency,
    reason,
  };
}

/** config 裡發現過、但沒有對應到帳本帳戶的 Wise 餘額。 */
function unmappedBalances(cfg: WiseConfig, profileName: ProfileNameFn): SkippedBalance[] {
  return cfg.balances
    .filter((b) => {
      const m = cfg.accountMappings.find((x) => x.balanceId === b.balanceId);
      return (m?.bankAccountId ?? null) === null;
    })
    .map((b) => skippedEntry(b, profileName, "unmapped"));
}

/** 要同步的對應（有帳本帳戶的；指定 accountId 時只取那一個）。沒有就丟錯。 */
function selectMappings(cfg: WiseConfig, accountId: number | undefined): ResolvedMapping[] {
  let mapped = cfg.accountMappings.filter((m): m is ResolvedMapping => m.bankAccountId !== null);
  if (accountId !== undefined) {
    mapped = mapped.filter((m) => m.bankAccountId === accountId);
    if (mapped.length === 0) {
      throw new Error(
        `帳本帳戶 #${accountId} 沒有對應到任何 Wise 餘額，請先到 設定 › 整合 › Wise 設定帳戶對應`,
      );
    }
  }
  if (mapped.length === 0) {
    throw new Error("還沒有任何 Wise 餘額對應到帳本帳戶，請先到 設定 › 整合 › Wise 設定帳戶對應");
  }
  return mapped;
}

type Eligibility =
  | { ok: true; acct: AccountRow; syncFrom: string }
  | { ok: false; reason: SkippedBalance["reason"] };

/** 帳本帳戶存在、幣別相符、有切換日，才能同步。 */
function checkEligible(
  acct: AccountRow | undefined,
  m: ResolvedMapping,
  globalSyncFrom: string | null,
): Eligibility {
  if (!acct) return { ok: false, reason: "account_missing" };
  if (acct.currency.trim().toUpperCase() !== m.currency) {
    return { ok: false, reason: "currency_mismatch" };
  }
  const syncFrom = m.syncFrom ?? globalSyncFrom;
  if (!syncFrom) return { ok: false, reason: "no_sync_from" };
  return { ok: true, acct, syncFrom };
}

type PlanContext = {
  db: Db;
  orgId: string;
  client: WiseClient;
  cfg: WiseConfig;
  profileName: ProfileNameFn;
  now: Date;
  today: string;
  startDate: string | undefined;
  /** 跨帳戶共用：同一次抓回來的資料裡看過的鍵。 */
  seenRefs: Set<string>;
  duplicateRefs: string[];
};

/**
 * 這個帳戶從哪天開始抓：有指定 startDate 就用它（不得早於切換日）；
 * 否則 max(切換日, 最後一筆 Wise 交易日 − OVERLAP_DAYS)。
 */
async function resolveStart(
  ctx: PlanContext,
  m: ResolvedMapping,
  acctName: string,
  syncFrom: string,
): Promise<string> {
  if (ctx.startDate === undefined) {
    const last = await lastWiseDate(ctx.db, ctx.orgId, m.bankAccountId);
    const overlap = last ? addDaysStr(last, -OVERLAP_DAYS) : null;
    return overlap && overlap > syncFrom ? overlap : syncFrom;
  }
  if (ctx.startDate < syncFrom) {
    throw new Error(
      `起始日 ${ctx.startDate} 早於「${acctName}」的切換日 ${syncFrom}。切換日之前的 Wise 交易已以手動彙總入帳，不能再同步；真的要回補請先到 設定 › 整合 › Wise 調整切換日`,
    );
  }
  return ctx.startDate;
}

/** 把抓回來的交易轉成帳本列，濾掉切換日 / 起始日之前的、以及同批重複的鍵。 */
function planRows(
  ctx: PlanContext,
  txns: WiseStatementTransaction[],
  m: ResolvedMapping,
  syncFrom: string,
  start: string,
): { rows: PlannedRow[]; beforeCutover: number } {
  let beforeCutover = 0;
  const rows: PlannedRow[] = [];
  for (const tx of txns) {
    if (!tx?.referenceNumber || !tx.amount) continue;
    const r = mapWiseTransaction(tx, m, ctx.cfg.accountMappings);
    if (r.txnDate < syncFrom || r.txnDate < start) {
      beforeCutover++;
      continue;
    }
    if (ctx.seenRefs.has(r.externalRef)) {
      ctx.duplicateRefs.push(r.externalRef);
      continue;
    }
    ctx.seenRefs.add(r.externalRef);
    rows.push(r);
  }
  return { rows, beforeCutover };
}

/** 抓一個帳戶的對帳單並規劃要寫的列；created / alreadySynced 之後再填。 */
async function planAccount(
  ctx: PlanContext,
  m: ResolvedMapping,
  acct: AccountRow,
  syncFrom: string,
): Promise<{ result: SyncAccountResult; rows: PlannedRow[] }> {
  const start = await resolveStart(ctx, m, acct.name, syncFrom);
  const txns = start <= ctx.today ? await fetchStatementRange(ctx.client, m, start, ctx.now) : [];
  const { rows, beforeCutover } = planRows(ctx, txns, m, syncFrom, start);
  return {
    rows,
    result: {
      bankAccountId: m.bankAccountId,
      bankAccountName: acct.name,
      profileId: m.profileId,
      profileName: ctx.profileName(m.profileId),
      balanceId: m.balanceId,
      currency: m.currency,
      syncFrom,
      rangeStart: start,
      rangeEnd: ctx.today,
      fetched: txns.length,
      beforeCutover,
      alreadySynced: 0,
      created: 0,
      needsReview: 0,
    },
  };
}

function toInsertRow(
  orgId: string,
  p: PlannedRow,
  partyIds: Map<string, number>,
): typeof transactions.$inferInsert {
  return {
    organizationId: orgId,
    type: p.type,
    txnDate: p.txnDate,
    description: p.description,
    categoryId: null,
    partyId: p.partyName ? (partyIds.get(p.partyName) ?? null) : null,
    amount: p.amount,
    currency: p.currency,
    // 與 create_transaction 相同：只有 TWD 才填 amount_twd，外幣不換算。
    amountTwd: p.currency === "TWD" ? p.amount : null,
    fromAccountId: p.fromAccountId,
    toAccountId: p.toAccountId,
    book: "internal",
    billedToCompanyTaxId: false,
    externalSource: SOURCE,
    externalRef: p.externalRef,
    externalMeta: p.externalMeta,
    needsReview: p.needsReview,
  };
}

/** 寫入帳本（ON CONFLICT DO NOTHING），回傳實際寫進去的 external_ref。 */
async function insertPlanned(db: Db, orgId: string, toCreate: PlannedRow[]): Promise<Set<string>> {
  const labelByName = new Map<string, string>();
  for (const p of toCreate) {
    if (p.partyName && !labelByName.has(p.partyName)) {
      labelByName.set(p.partyName, p.type === "income" ? "customer" : "vendor");
    }
  }
  const partyIds = await resolveParties(db, orgId, labelByName);
  const createdRefs = new Set<string>();
  for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
    const chunk = toCreate.slice(i, i + INSERT_CHUNK);
    const inserted = await db
      .insert(transactions)
      .values(chunk.map((p) => toInsertRow(orgId, p, partyIds)))
      .onConflictDoNothing()
      .returning({ ref: transactions.externalRef });
    for (const r of inserted) if (r.ref) createdRefs.add(r.ref);
  }
  return createdRefs;
}

/** 把已同步 / 新增 / 待審的數字填回每個帳戶的結果。 */
function tallyResults(
  results: SyncAccountResult[],
  planned: PlannedRow[],
  existing: Set<string>,
  toCreate: PlannedRow[],
  createdRefs: Set<string>,
  dryRun: boolean,
): void {
  for (const r of results) {
    const mine = planned.filter((p) => p.bankAccountId === r.bankAccountId);
    r.alreadySynced = mine.filter((p) => existing.has(p.externalRef)).length;
    const toCreateMine = toCreate.filter((p) => p.bankAccountId === r.bankAccountId);
    const created = toCreateMine.filter((p) => createdRefs.has(p.externalRef));
    r.created = created.length;
    r.needsReview = created.filter((p) => p.needsReview).length;
    // 寫入時被 ON CONFLICT 擋下的（同時有另一個同步在跑）算已同步。
    if (!dryRun) r.alreadySynced += toCreateMine.length - created.length;
  }
}

function toSample(p: PlannedRow): SyncResult["sample"][number] {
  return {
    bankAccountId: p.bankAccountId,
    txnDate: p.txnDate,
    type: p.type,
    amount: p.amount,
    currency: p.currency,
    partyName: p.partyName,
    description: p.description,
    externalRef: p.externalRef,
    needsReview: p.needsReview,
  };
}

/**
 * 同步（或試算）Wise 交易到帳本。整合必須已連接且開啟。
 * 錯誤（未對應、起始日早於切換日…）以 Error 丟出，訊息給人看。
 */
export async function syncWiseTransactions(orgId: string, opts: SyncOptions): Promise<SyncResult> {
  if (opts.startDate !== undefined && !isIsoDate(opts.startDate)) {
    throw new Error(`startDate 格式錯誤：${opts.startDate}（應為 YYYY-MM-DD）`);
  }
  return withWiseClient(orgId, async (client, row) => {
    const db = getDb();
    const cfg = parseWiseConfig(row.config);
    const profileName = (id: number) => cfg.profiles.find((p) => p.id === id)?.name ?? String(id);

    const skippedBalances = unmappedBalances(cfg, profileName);
    const mapped = selectMappings(cfg, opts.accountId);
    const accounts = await loadOrgAccounts(db, orgId, mapped.map((m) => m.bankAccountId));
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    const now = new Date();
    const ctx: PlanContext = {
      db,
      orgId,
      client,
      cfg,
      profileName,
      now,
      today: taipeiDate(now),
      startDate: opts.startDate,
      seenRefs: new Set<string>(),
      duplicateRefs: [],
    };
    const results: SyncAccountResult[] = [];
    const planned: PlannedRow[] = [];

    for (const m of mapped) {
      const check = checkEligible(acctById.get(m.bankAccountId), m, cfg.syncFrom);
      if (!check.ok) {
        skippedBalances.push(skippedEntry(m, profileName, check.reason));
        continue;
      }
      const { result, rows } = await planAccount(ctx, m, check.acct, check.syncFrom);
      planned.push(...rows);
      results.push(result);
    }

    const existing = await existingRefs(db, orgId, planned.map((p) => p.externalRef));
    const toCreate = planned
      .filter((p) => !existing.has(p.externalRef))
      .sort((a, b) => compareStr(a.txnDate, b.txnDate));

    const createdRefs =
      opts.dryRun || toCreate.length === 0
        ? new Set<string>(toCreate.map((p) => p.externalRef))
        : await insertPlanned(db, orgId, toCreate);

    tallyResults(results, planned, existing, toCreate, createdRefs, opts.dryRun);

    return {
      dryRun: opts.dryRun,
      accounts: results,
      skippedBalances,
      totals: {
        created: results.reduce((s, r) => s + r.created, 0),
        alreadySynced: results.reduce((s, r) => s + r.alreadySynced, 0),
        beforeCutover: results.reduce((s, r) => s + r.beforeCutover, 0),
      },
      duplicateRefs: ctx.duplicateRefs,
      sample: toCreate
        .filter((p) => createdRefs.has(p.externalRef))
        .slice(0, SAMPLE_LIMIT)
        .map(toSample),
    };
  });
}

// ---------------------------------------------------------------------------
// 對帳單查詢（唯讀，給 MCP wise_get_statement）
// ---------------------------------------------------------------------------

export type CompactWiseTxn = {
  date: string;
  dateTime: string;
  direction: string;
  detailsType: string;
  amount: number;
  currency: string;
  fee: number | null;
  description: string | null;
  merchant: string | null;
  originalAmount: { value: number; currency: string } | null;
  referenceNumber: string;
  runningBalance: number | null;
};

export function compactWiseTxn(tx: WiseStatementTransaction): CompactWiseTxn {
  const d = tx.details ?? {};
  return {
    date: taipeiDate(tx.date),
    dateTime: tx.date,
    direction: tx.type,
    detailsType: d.type ?? "UNKNOWN",
    amount: tx.amount.value,
    currency: tx.amount.currency,
    fee: tx.totalFees?.value ?? null,
    description: d.description ?? null,
    merchant: d.merchant?.name ?? d.senderName ?? recipientName(d.recipient) ?? null,
    originalAmount: d.amount ? { value: d.amount.value, currency: d.amount.currency } : null,
    referenceNumber: tx.referenceNumber,
    runningBalance: tx.runningBalance?.value ?? null,
  };
}

/** 讀一段期間的對帳單（台北日期，含頭含尾），按月切塊。 */
export async function getWiseStatement(
  orgId: string,
  target: { profileId: number; balanceId: number; currency: string },
  startDate: string,
  endDate: string,
): Promise<CompactWiseTxn[]> {
  const endExclusive = new Date(taipeiStartUtc(addDaysStr(endDate, 1)));
  const until = endExclusive.getTime() < Date.now() ? endExclusive : new Date();
  return withWiseClient(orgId, async (client) => {
    const txns = await fetchStatementRange(
      client,
      { ...target, bankAccountId: null, syncFrom: null },
      startDate,
      until,
    );
    return txns
      .filter((t) => t?.referenceNumber && t.amount)
      .map(compactWiseTxn)
      .filter((t) => t.date >= startDate && t.date <= endDate)
      .sort((a, b) => compareStr(a.dateTime, b.dateTime));
  });
}
