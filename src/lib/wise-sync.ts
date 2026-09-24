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

/** 從 org_integrations.config 讀出 Wise 設定；形狀不對的項目直接略過。 */
export function parseWiseConfig(config: IntegrationConfig | null | undefined): WiseConfig {
  const c = config ?? {};
  const profiles = Array.isArray(c.profiles)
    ? (c.profiles as unknown[]).flatMap((p) => {
        const o = p as Record<string, unknown>;
        const id = num(o?.id);
        return id === null
          ? []
          : [{ id, type: String(o.type ?? ""), name: String(o.name ?? id) }];
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
  const db = getDb();
  const accountIds = input.map((m) => m.bankAccountId).filter((x): x is number => x !== null);
  const accounts = accountIds.length
    ? await db
        .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.organizationId, orgId),
            inArray(bankAccounts.id, accountIds),
            isNull(bankAccounts.deletedAt),
          ),
        )
    : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seenAccounts = new Set<number>();
  const needSuggestion: number[] = [];
  const out: WiseAccountMapping[] = [];
  for (const m of input) {
    const bal = cfg.balances.find((b) => b.balanceId === m.balanceId && b.profileId === m.profileId);
    if (!bal) return { error: `找不到 Wise 餘額 #${m.balanceId}，請先重新整理餘額` };
    if (m.syncFrom !== null && !isIsoDate(m.syncFrom)) {
      return { error: `切換日格式錯誤：${m.syncFrom}（應為 YYYY-MM-DD）` };
    }
    if (m.bankAccountId !== null) {
      const acct = byId.get(m.bankAccountId);
      if (!acct) return { error: `找不到帳本帳戶 #${m.bankAccountId}` };
      if (acct.currency.trim().toUpperCase() !== bal.currency) {
        return {
          error: `「${acct.name}」是 ${acct.currency.trim()} 帳戶，不能對應 Wise 的 ${bal.currency} 餘額`,
        };
      }
      if (seenAccounts.has(acct.id)) {
        return { error: `「${acct.name}」被對應到兩個 Wise 餘額，一個帳本帳戶只能對應一個` };
      }
      seenAccounts.add(acct.id);
      if (m.syncFrom === null) needSuggestion.push(acct.id);
    }
    out.push({
      profileId: bal.profileId,
      balanceId: bal.balanceId,
      currency: bal.currency,
      bankAccountId: m.bankAccountId,
      syncFrom: m.syncFrom,
    });
  }
  if (needSuggestion.length) {
    const suggested = await suggestSyncFrom(orgId, needSuggestion);
    for (const m of out) {
      if (m.bankAccountId !== null && m.syncFrom === null) {
        m.syncFrom = suggested.get(m.bankAccountId) ?? null;
      }
    }
  }
  await updateConfig(orgId, "wise", { accountMappings: out });
  return { mappings: out };
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

function fmtAmount(v: number): string {
  return Math.abs(v).toFixed(2);
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

/** 一筆 Wise 對帳單交易 → 一列帳本交易（尚未寫入）。 */
export function mapWiseTransaction(
  tx: WiseStatementTransaction,
  m: ResolvedMapping,
  all: readonly WiseAccountMapping[],
): PlannedRow {
  const d = tx.details ?? {};
  const dtype = (d.type ?? "UNKNOWN").toUpperCase();
  const isCredit = tx.type === "CREDIT";
  const currency = m.currency;
  const amount = fmtAmount(tx.amount.value);
  const fee = tx.totalFees && tx.totalFees.value ? tx.totalFees : null;
  const orig = d.amount && d.amount.currency && d.amount.currency.toUpperCase() !== currency ? d.amount : null;
  const rate = tx.exchangeDetails?.rate ?? d.rate ?? null;

  const meta: Record<string, unknown> = {
    referenceNumber: tx.referenceNumber,
    wiseType: tx.type,
    detailsType: dtype,
    dateTime: tx.date,
    profileId: m.profileId,
    balanceId: m.balanceId,
  };
  if (d.category) meta.category = d.category;
  if (d.merchant) {
    meta.merchant = {
      name: d.merchant.name ?? null,
      city: d.merchant.city ?? null,
      country: d.merchant.country ?? null,
      category: d.merchant.category ?? null,
    };
  }
  if (d.amount) meta.originalAmount = { value: d.amount.value, currency: d.amount.currency };
  if (rate !== null) meta.exchangeRate = rate;
  if (fee) meta.fees = { value: fee.value, currency: fee.currency };
  if (d.cardLastFourDigits) meta.cardLastFour = d.cardLastFourDigits;
  if (d.cardHolderFullName) meta.cardHolder = d.cardHolderFullName;
  if (tx.runningBalance) meta.runningBalance = tx.runningBalance.value;

  const suffix: string[] = [];
  if (orig) suffix.push(`${orig.currency} ${Math.abs(orig.value)}`);
  if (fee) suffix.push(`fee ${fmtAmount(fee.value)} ${fee.currency}`);

  if (dtype === "CONVERSION") {
    const counter = counterCurrencyOf(tx, currency);
    const counterMapping = counter
      ? all.find((x) => x.profileId === m.profileId && x.currency === counter && x.bankAccountId !== null)
      : undefined;
    const from = tx.exchangeDetails?.fromAmount;
    const to = tx.exchangeDetails?.toAmount;
    const desc = [
      from && to
        ? `Wise 換匯 ${from.currency} ${Math.abs(from.value)} → ${to.currency} ${Math.abs(to.value)}${rate ? ` @ ${rate}` : ""}`
        : `Wise 換匯 ${d.description ?? ""}`.trim(),
      fee ? `fee ${fmtAmount(fee.value)} ${fee.currency}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    meta.conversion = {
      counterCurrency: counter,
      counterBankAccountId: counterMapping?.bankAccountId ?? null,
    };
    const base = {
      bankAccountId: m.bankAccountId,
      txnDate: taipeiDate(tx.date),
      amount,
      currency,
      description: desc,
      externalRef: `${tx.referenceNumber}:${currency}`,
      externalMeta: meta,
    };
    if (counterMapping) {
      return {
        ...base,
        type: "transfer",
        partyName: null,
        needsReview: false,
        fromAccountId: isCredit ? null : m.bankAccountId,
        toAccountId: isCredit ? m.bankAccountId : null,
      };
    }
    return {
      ...base,
      type: isCredit ? "income" : "expense",
      partyName: CONVERSION_PARTY,
      needsReview: true,
      fromAccountId: isCredit ? null : m.bankAccountId,
      toAccountId: isCredit ? m.bankAccountId : null,
    };
  }

  const partyName =
    d.merchant?.name?.trim() ||
    d.senderName?.trim() ||
    recipientName(d.recipient) ||
    d.description?.trim() ||
    "Wise";
  const description = [d.description?.trim() || dtype, ...suffix].join(" · ");
  return {
    bankAccountId: m.bankAccountId,
    type: isCredit ? "income" : "expense",
    txnDate: taipeiDate(tx.date),
    amount,
    currency,
    partyName: partyName.slice(0, 200),
    description,
    externalRef: tx.referenceNumber,
    externalMeta: meta,
    needsReview: true,
    fromAccountId: isCredit ? null : m.bankAccountId,
    toAccountId: isCredit ? m.bankAccountId : null,
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

    const skippedBalances: SkippedBalance[] = [];
    for (const b of cfg.balances) {
      const m = cfg.accountMappings.find((x) => x.balanceId === b.balanceId);
      if (!m || m.bankAccountId === null) {
        skippedBalances.push({
          profileId: b.profileId,
          profileName: profileName(b.profileId),
          balanceId: b.balanceId,
          currency: b.currency,
          reason: "unmapped",
        });
      }
    }

    let mapped = cfg.accountMappings.filter(
      (m): m is ResolvedMapping => m.bankAccountId !== null,
    );
    if (opts.accountId !== undefined) {
      mapped = mapped.filter((m) => m.bankAccountId === opts.accountId);
      if (mapped.length === 0) {
        throw new Error(
          `帳本帳戶 #${opts.accountId} 沒有對應到任何 Wise 餘額，請先到 設定 › 整合 › Wise 設定帳戶對應`,
        );
      }
    }
    if (mapped.length === 0) {
      throw new Error("還沒有任何 Wise 餘額對應到帳本帳戶，請先到 設定 › 整合 › Wise 設定帳戶對應");
    }

    const accountIds = mapped.map((m) => m.bankAccountId);
    const accounts = await db
      .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.organizationId, orgId),
          inArray(bankAccounts.id, accountIds),
          isNull(bankAccounts.deletedAt),
        ),
      );
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    const now = new Date();
    const today = taipeiDate(now);
    const results: SyncAccountResult[] = [];
    const planned: PlannedRow[] = [];
    const duplicateRefs: string[] = [];
    const seenRefs = new Set<string>();

    for (const m of mapped) {
      const acct = acctById.get(m.bankAccountId);
      const skip = (reason: SkippedBalance["reason"]) =>
        skippedBalances.push({
          profileId: m.profileId,
          profileName: profileName(m.profileId),
          balanceId: m.balanceId,
          currency: m.currency,
          reason,
        });
      if (!acct) {
        skip("account_missing");
        continue;
      }
      if (acct.currency.trim().toUpperCase() !== m.currency) {
        skip("currency_mismatch");
        continue;
      }
      const syncFrom = m.syncFrom ?? cfg.syncFrom;
      if (!syncFrom) {
        skip("no_sync_from");
        continue;
      }
      let start: string;
      if (opts.startDate !== undefined) {
        if (opts.startDate < syncFrom) {
          throw new Error(
            `起始日 ${opts.startDate} 早於「${acct.name}」的切換日 ${syncFrom}。切換日之前的 Wise 交易已以手動彙總入帳，不能再同步；真的要回補請先到 設定 › 整合 › Wise 調整切換日`,
          );
        }
        start = opts.startDate;
      } else {
        const last = await lastWiseDate(db, orgId, m.bankAccountId);
        const overlap = last ? addDaysStr(last, -OVERLAP_DAYS) : null;
        start = overlap && overlap > syncFrom ? overlap : syncFrom;
      }

      const txns = start <= today ? await fetchStatementRange(client, m, start, now) : [];
      let beforeCutover = 0;
      const rowsForAccount: PlannedRow[] = [];
      for (const tx of txns) {
        if (!tx?.referenceNumber || !tx.amount) continue;
        const r = mapWiseTransaction(tx, m, cfg.accountMappings);
        if (r.txnDate < syncFrom || r.txnDate < start) {
          beforeCutover++;
          continue;
        }
        if (seenRefs.has(r.externalRef)) {
          duplicateRefs.push(r.externalRef);
          continue;
        }
        seenRefs.add(r.externalRef);
        rowsForAccount.push(r);
      }
      planned.push(...rowsForAccount);
      results.push({
        bankAccountId: m.bankAccountId,
        bankAccountName: acct.name,
        profileId: m.profileId,
        profileName: profileName(m.profileId),
        balanceId: m.balanceId,
        currency: m.currency,
        syncFrom,
        rangeStart: start,
        rangeEnd: today,
        fetched: txns.length,
        beforeCutover,
        alreadySynced: 0,
        created: 0,
        needsReview: 0,
      });
    }

    const existing = await existingRefs(db, orgId, planned.map((p) => p.externalRef));
    const toCreate = planned
      .filter((p) => !existing.has(p.externalRef))
      .sort((a, b) => (a.txnDate === b.txnDate ? 0 : a.txnDate < b.txnDate ? -1 : 1));
    for (const r of results) {
      const mine = planned.filter((p) => p.bankAccountId === r.bankAccountId);
      r.alreadySynced = mine.filter((p) => existing.has(p.externalRef)).length;
    }

    let createdRefs = new Set<string>(toCreate.map((p) => p.externalRef));
    if (!opts.dryRun && toCreate.length > 0) {
      const labelByName = new Map<string, string>();
      for (const p of toCreate) {
        if (p.partyName && !labelByName.has(p.partyName)) {
          labelByName.set(p.partyName, p.type === "income" ? "customer" : "vendor");
        }
      }
      const partyIds = await resolveParties(db, orgId, labelByName);
      createdRefs = new Set();
      for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
        const chunk = toCreate.slice(i, i + INSERT_CHUNK);
        const inserted = await db
          .insert(transactions)
          .values(
            chunk.map((p) => ({
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
            })),
          )
          .onConflictDoNothing()
          .returning({ ref: transactions.externalRef });
        for (const r of inserted) if (r.ref) createdRefs.add(r.ref);
      }
    }

    for (const r of results) {
      const mine = toCreate.filter(
        (p) => p.bankAccountId === r.bankAccountId && createdRefs.has(p.externalRef),
      );
      r.created = mine.length;
      r.needsReview = mine.filter((p) => p.needsReview).length;
      // 寫入時被 ON CONFLICT 擋下的（同時有另一個同步在跑）算已同步。
      if (!opts.dryRun) {
        r.alreadySynced +=
          toCreate.filter((p) => p.bankAccountId === r.bankAccountId).length - mine.length;
      }
    }

    return {
      dryRun: opts.dryRun,
      accounts: results,
      skippedBalances,
      totals: {
        created: results.reduce((s, r) => s + r.created, 0),
        alreadySynced: results.reduce((s, r) => s + r.alreadySynced, 0),
        beforeCutover: results.reduce((s, r) => s + r.beforeCutover, 0),
      },
      duplicateRefs,
      sample: toCreate
        .filter((p) => createdRefs.has(p.externalRef))
        .slice(0, SAMPLE_LIMIT)
        .map((p) => ({
          bankAccountId: p.bankAccountId,
          txnDate: p.txnDate,
          type: p.type,
          amount: p.amount,
          currency: p.currency,
          partyName: p.partyName,
          description: p.description,
          externalRef: p.externalRef,
          needsReview: p.needsReview,
        })),
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
      .sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
  });
}
