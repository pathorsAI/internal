/**
 * 總帳的資料存取（docs/general-ledger.md）。只在 server 端用（server component、server action、API route）。
 *
 * posting engine（src/lib/ledger）是純函式，分錄每次即時從來源算；這裡負責：
 *   - 把 engine 要的原始資料一次讀齊（loadLedgerInputs）
 *   - 設定、科目表、匯率、手動分錄、財產、結帳狀態的查詢
 * 寫入在 src/db/ledger-mutations.ts。每一句都帶 organization_id 條件。
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import { organization } from "./auth-schema";
import {
  accountReconciliations,
  bankAccounts,
  categories,
  employees,
  fiscalPeriods,
  fixedAssets,
  fxRates,
  glAccounts,
  invoices,
  journalEntries,
  journalLines,
  orgAccountingSettings,
  parties,
  transactions,
} from "./schema";
import { getJurisdiction } from "@/lib/ledger/jurisdictions";
import type {
  AccountingSettings,
  CashFlowClass,
  FixedAsset,
  GlAccount,
  GlAccountType,
  LedgerInputs,
  LedgerKind,
  LedgerTransaction,
  LedgerInvoice,
  SourceType,
  StoredEntry,
  SystemKey,
  VatRegime,
} from "@/lib/ledger/types";

const n = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** 台北時區的今天（YYYY-MM-DD）。 */
export function todayInTaipei(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

/** 某年某月的最後一天（YYYY-MM-DD）。 */
export function monthEnd(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 設定與科目表
// ---------------------------------------------------------------------------

/** 有設定列就用它；沒有就用預設（營業稅制依 organization.tax_treatment：none → 小規模）。 */
export async function getAccountingSettings(orgId: string): Promise<AccountingSettings> {
  const db = getDb();
  const [[row], [org]] = await Promise.all([
    db.select().from(orgAccountingSettings).where(eq(orgAccountingSettings.organizationId, orgId)).limit(1),
    db.select({ taxTreatment: organization.taxTreatment }).from(organization).where(eq(organization.id, orgId)).limit(1),
  ]);
  if (row) {
    return {
      jurisdiction: row.jurisdiction,
      framework: row.framework,
      vatRegime: row.vatRegime as VatRegime,
      fiscalYearStartMonth: row.fiscalYearStartMonth,
      functionalCurrency: row.functionalCurrency.trim(),
      booksStartDate: row.booksStartDate,
      openingEquityAccountId: row.openingEquityAccountId,
    };
  }
  const mod = getJurisdiction(null);
  return {
    jurisdiction: mod.code,
    framework: mod.defaultFramework,
    vatRegime: org?.taxTreatment === "none" ? "small_scale" : "general",
    fiscalYearStartMonth: mod.defaultFiscalYearStartMonth,
    functionalCurrency: mod.functionalCurrency,
    booksStartDate: null,
    openingEquityAccountId: null,
  };
}

/** 組織還沒有科目表就照國家模組的範本建一份（重複呼叫無害）。回傳是否有新建。 */
export async function ensureChartOfAccounts(orgId: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: glAccounts.id })
    .from(glAccounts)
    .where(eq(glAccounts.organizationId, orgId))
    .limit(1);
  if (existing) return false;
  const [row] = await db
    .select({ jurisdiction: orgAccountingSettings.jurisdiction })
    .from(orgAccountingSettings)
    .where(eq(orgAccountingSettings.organizationId, orgId))
    .limit(1);
  const mod = getJurisdiction(row?.jurisdiction);
  await db
    .insert(glAccounts)
    .values(
      mod.chartTemplate.map((a) => ({
        organizationId: orgId,
        code: a.code,
        name: a.name,
        nameEn: a.nameEn,
        type: a.type,
        section: a.section,
        cashFlow: a.cashFlow,
        systemKey: a.systemKey ?? null,
      })),
    )
    // (organization_id, code) 或 system_key 撞到都略過：兩個請求同時建也不會出錯
    .onConflictDoNothing();
  return true;
}

function toGlAccount(r: typeof glAccounts.$inferSelect): GlAccount {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    nameEn: r.nameEn,
    type: r.type as GlAccountType,
    section: r.section,
    cashFlow: r.cashFlow as CashFlowClass,
    systemKey: (r.systemKey as SystemKey | null) ?? null,
    isActive: r.isActive,
  };
}

/** 科目表（依代碼排序）。第一次呼叫會先建範本。 */
export async function listGlAccounts(orgId: string): Promise<GlAccount[]> {
  await ensureChartOfAccounts(orgId);
  const rows = await getDb()
    .select()
    .from(glAccounts)
    .where(eq(glAccounts.organizationId, orgId))
    .orderBy(asc(glAccounts.code));
  return rows.map(toGlAccount);
}

/** 有沒有手動分錄或結帳快照（有的話就不能換國家模組）。 */
export async function hasJournalData(orgId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.organizationId, orgId), isNull(journalEntries.deletedAt)))
    .limit(1);
  return !!row;
}

// ---------------------------------------------------------------------------
// engine 輸入
// ---------------------------------------------------------------------------

async function loadStoredEntries(orgId: string): Promise<StoredEntry[]> {
  const db = getDb();
  const [headers, lines] = await Promise.all([
    db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.organizationId, orgId), isNull(journalEntries.deletedAt)))
      .orderBy(asc(journalEntries.entryDate), asc(journalEntries.id)),
    db
      .select({
        entryId: journalLines.entryId,
        glAccountId: journalLines.glAccountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
        currency: journalLines.currency,
        fxAmount: journalLines.fxAmount,
        partyId: journalLines.partyId,
        employeeId: journalLines.employeeId,
        bankAccountId: journalLines.bankAccountId,
        memo: journalLines.memo,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalEntries.organizationId, orgId), isNull(journalEntries.deletedAt)))
      .orderBy(asc(journalLines.id)),
  ]);
  const byEntry = new Map<number, StoredEntry["lines"]>();
  for (const l of lines) {
    const list = byEntry.get(l.entryId) ?? [];
    list.push({
      glAccountId: l.glAccountId,
      debit: n(l.debit),
      credit: n(l.credit),
      currency: l.currency?.trim() ?? null,
      fxAmount: nOrNull(l.fxAmount),
      partyId: l.partyId,
      employeeId: l.employeeId,
      bankAccountId: l.bankAccountId,
      memo: l.memo,
    });
    byEntry.set(l.entryId, list);
  }
  return headers.map((h) => ({
    id: h.id,
    ledger: h.ledger as LedgerKind | "both",
    kind: h.kind as StoredEntry["kind"],
    entryDate: h.entryDate,
    memo: h.memo,
    snapshotYear: h.snapshotYear,
    snapshotMonth: h.snapshotMonth,
    sourceType: (h.sourceType as SourceType | null) ?? null,
    sourceId: h.sourceId,
    lines: byEntry.get(h.id) ?? [],
  }));
}

/** posting engine 要的全部資料，幾句查詢平行讀完。 */
export async function loadLedgerInputs(orgId: string): Promise<LedgerInputs> {
  await ensureChartOfAccounts(orgId);
  const db = getDb();
  const [
    settings,
    [org],
    accountRows,
    categoryRows,
    bankRows,
    txnRows,
    invoiceRows,
    rateRows,
    entries,
    periodRows,
    assetRows,
    reconRows,
    partyRows,
    employeeRows,
  ] = await Promise.all([
    getAccountingSettings(orgId),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1),
    db.select().from(glAccounts).where(eq(glAccounts.organizationId, orgId)).orderBy(asc(glAccounts.code)),
    db
      .select({ id: categories.id, name: categories.name, kind: categories.kind, glAccountId: categories.glAccountId })
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), isNull(categories.deletedAt))),
    db
      .select({
        id: bankAccounts.id,
        name: bankAccounts.name,
        kind: bankAccounts.kind,
        currency: bankAccounts.currency,
        openingBalance: bankAccounts.openingBalance,
        ledgerScope: bankAccounts.ledgerScope,
        glAccountId: bankAccounts.glAccountId,
        isActive: bankAccounts.isActive,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.organizationId, orgId), isNull(bankAccounts.deletedAt))),
    db
      .select({
        id: transactions.id,
        txnDate: transactions.txnDate,
        type: transactions.type,
        book: transactions.book,
        amount: transactions.amount,
        currency: transactions.currency,
        amountTwd: transactions.amountTwd,
        categoryId: transactions.categoryId,
        fromAccountId: transactions.fromAccountId,
        toAccountId: transactions.toAccountId,
        partyId: transactions.partyId,
        settleEmployeeId: transactions.settleEmployeeId,
        relatedToId: transactions.relatedToId,
        invoiceId: transactions.invoiceId,
        description: transactions.description,
      })
      .from(transactions)
      .where(and(eq(transactions.organizationId, orgId), isNull(transactions.deletedAt)))
      .orderBy(asc(transactions.txnDate), asc(transactions.id)),
    db
      .select({
        id: invoices.id,
        direction: invoices.direction,
        status: invoices.status,
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        amountNet: invoices.amountNet,
        tax: invoices.tax,
        amountGross: invoices.amountGross,
        taxTreatment: invoices.taxTreatment,
        foreignCurrency: invoices.foreignCurrency,
        partyId: invoices.partyId,
      })
      .from(invoices)
      .where(and(eq(invoices.organizationId, orgId), isNull(invoices.deletedAt))),
    db
      .select({ currency: fxRates.currency, date: fxRates.rateDate, rate: fxRates.rate })
      .from(fxRates)
      .where(eq(fxRates.organizationId, orgId))
      .orderBy(asc(fxRates.currency), asc(fxRates.rateDate)),
    loadStoredEntries(orgId),
    db
      .select({ year: fiscalPeriods.year, month: fiscalPeriods.month })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.organizationId, orgId), eq(fiscalPeriods.status, "closed"))),
    db
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.organizationId, orgId), isNull(fixedAssets.deletedAt))),
    db
      .select({
        accountId: accountReconciliations.accountId,
        asOfDate: accountReconciliations.asOfDate,
        statementBalance: accountReconciliations.statementBalance,
      })
      .from(accountReconciliations)
      .where(and(eq(accountReconciliations.organizationId, orgId), isNull(accountReconciliations.deletedAt))),
    db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.organizationId, orgId)),
    db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.organizationId, orgId)),
  ]);

  return {
    orgId,
    orgName: org?.name ?? "",
    settings,
    accounts: accountRows.map(toGlAccount),
    categories: categoryRows,
    bankAccounts: bankRows.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      currency: b.currency.trim(),
      openingBalance: n(b.openingBalance),
      ledgerScope: b.ledgerScope as LedgerKind,
      glAccountId: b.glAccountId,
      isActive: b.isActive,
    })),
    transactions: txnRows.map((r) => ({
      id: r.id,
      txnDate: r.txnDate,
      type: r.type as LedgerTransaction["type"],
      book: r.book as LedgerTransaction["book"],
      amount: n(r.amount),
      currency: r.currency.trim(),
      amountTwd: nOrNull(r.amountTwd),
      categoryId: r.categoryId,
      fromAccountId: r.fromAccountId,
      toAccountId: r.toAccountId,
      partyId: r.partyId,
      settleEmployeeId: r.settleEmployeeId,
      relatedToId: r.relatedToId,
      invoiceId: r.invoiceId,
      description: r.description,
    })),
    invoices: invoiceRows.map((r) => ({
      id: r.id,
      direction: r.direction as LedgerInvoice["direction"],
      status: r.status as LedgerInvoice["status"],
      invoiceDate: r.invoiceDate,
      invoiceNumber: r.invoiceNumber,
      amountNet: nOrNull(r.amountNet),
      tax: nOrNull(r.tax),
      amountGross: nOrNull(r.amountGross),
      taxTreatment: r.taxTreatment as LedgerInvoice["taxTreatment"],
      foreignCurrency: r.foreignCurrency?.trim() || null,
      partyId: r.partyId,
    })),
    fxRates: rateRows.map((r) => ({ currency: r.currency.trim(), date: r.date, rate: n(r.rate) })),
    entries,
    closedPeriods: periodRows.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`).sort(),
    fixedAssets: assetRows.map(toFixedAsset),
    reconciliations: reconRows.map((r) => ({
      accountId: r.accountId,
      asOfDate: r.asOfDate,
      statementBalance: n(r.statementBalance),
    })),
    partyNames: Object.fromEntries(partyRows.map((p) => [p.id, p.name])),
    employeeNames: Object.fromEntries(employeeRows.map((e) => [e.id, e.name])),
  };
}

function toFixedAsset(r: typeof fixedAssets.$inferSelect): FixedAsset {
  return {
    id: r.id,
    name: r.name,
    acquiredOn: r.acquiredOn,
    cost: n(r.cost),
    salvageValue: n(r.salvageValue),
    usefulLifeMonths: r.usefulLifeMonths,
    assetAccountId: r.assetAccountId,
    sourceTransactionId: r.sourceTransactionId,
    disposedOn: r.disposedOn,
  };
}

// ---------------------------------------------------------------------------
// 頁面用的清單
// ---------------------------------------------------------------------------

export type FxRateRow = { id: number; currency: string; rateDate: string; rate: number; source: string };

export async function listFxRates(orgId: string): Promise<FxRateRow[]> {
  const rows = await getDb()
    .select({
      id: fxRates.id,
      currency: fxRates.currency,
      rateDate: fxRates.rateDate,
      rate: fxRates.rate,
      source: fxRates.source,
    })
    .from(fxRates)
    .where(eq(fxRates.organizationId, orgId))
    .orderBy(asc(fxRates.currency), desc(fxRates.rateDate));
  return rows.map((r) => ({ ...r, currency: r.currency.trim(), rate: n(r.rate) }));
}

/** 外幣交易還沒有台幣金額的筆數（匯率頁的提示）。 */
export async function countMissingAmountTwd(orgId: string, functionalCurrency: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        isNull(transactions.amountTwd),
        ne(transactions.currency, functionalCurrency),
      ),
    );
  return Number(row?.count ?? 0);
}

/** 交易用到的外幣（不含本位幣），匯入匯率用。 */
export async function listForeignCurrencies(orgId: string, functionalCurrency: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ currency: transactions.currency })
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), isNull(transactions.deletedAt), ne(transactions.currency, functionalCurrency)));
  return rows.map((r) => r.currency.trim()).sort();
}

export type ManualEntryRow = {
  id: number;
  ledger: LedgerKind | "both";
  kind: "manual" | "opening" | "adjustment";
  entryDate: string;
  memo: string | null;
  createdBy: string | null;
  createdAt: string;
  total: number;
  lines: {
    id: number;
    glAccountId: number;
    code: string;
    name: string;
    debit: number;
    credit: number;
    memo: string | null;
  }[];
};

/** 手動分錄（不含結帳快照），新的在前。 */
export async function listManualEntries(orgId: string, limit = 200): Promise<ManualEntryRow[]> {
  const db = getDb();
  const headers = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.organizationId, orgId),
        isNull(journalEntries.deletedAt),
        ne(journalEntries.kind, "snapshot"),
      ),
    )
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
    .limit(limit);
  if (headers.length === 0) return [];
  const lines = await db
    .select({
      id: journalLines.id,
      entryId: journalLines.entryId,
      glAccountId: journalLines.glAccountId,
      code: glAccounts.code,
      name: glAccounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(glAccounts, and(eq(glAccounts.id, journalLines.glAccountId), eq(glAccounts.organizationId, orgId)))
    .where(inArray(journalLines.entryId, headers.map((h) => h.id)))
    .orderBy(asc(journalLines.id));
  const byEntry = new Map<number, ManualEntryRow["lines"]>();
  for (const l of lines) {
    const list = byEntry.get(l.entryId) ?? [];
    list.push({ id: l.id, glAccountId: l.glAccountId, code: l.code, name: l.name, debit: n(l.debit), credit: n(l.credit), memo: l.memo });
    byEntry.set(l.entryId, list);
  }
  return headers.map((h) => {
    const entryLines = byEntry.get(h.id) ?? [];
    return {
      id: h.id,
      ledger: h.ledger as ManualEntryRow["ledger"],
      kind: h.kind as ManualEntryRow["kind"],
      entryDate: h.entryDate,
      memo: h.memo,
      createdBy: h.createdBy,
      createdAt: h.createdAt,
      total: Math.round(entryLines.reduce((s, l) => s + l.debit, 0) * 100) / 100,
      lines: entryLines,
    };
  });
}

export type FixedAssetRow = FixedAsset & {
  note: string | null;
  assetAccountCode: string | null;
  assetAccountName: string | null;
  /** 截至今天的累計折舊與帳面價值（直線法） */
  accumulatedDepreciation: number;
  bookValue: number;
  monthlyDepreciation: number;
};

/**
 * 直線法累計折舊（截至 asOf）。每月月底提一次，從取得當月起，到處分當月或攤完為止；
 * 最後一個月吸收尾差。跟 engine 的規則一致（docs/general-ledger.md §2.4），這裡只給畫面顯示用。
 */
export function straightLineDepreciation(asset: FixedAsset, asOf: string): { monthly: number; accumulated: number; months: number } {
  const depreciable = Math.max(0, asset.cost - asset.salvageValue);
  const monthly = Math.round((depreciable / asset.usefulLifeMonths) * 100) / 100;
  const [ay, am] = asset.acquiredOn.split("-").map(Number);
  let end = asOf;
  if (asset.disposedOn && asset.disposedOn < end) {
    const [dy, dm] = asset.disposedOn.split("-").map(Number);
    // 處分當月也提（月底那筆）
    const disposedMonthEnd = monthEnd(dy, dm);
    if (disposedMonthEnd < asOf) end = disposedMonthEnd;
  }
  // 從取得當月起逐月往後數（以「年×12＋月序」的月份序號走，避免手動進位）
  const startIndex = ay * 12 + (am - 1);
  let months = 0;
  while (
    months < asset.usefulLifeMonths &&
    monthEnd(Math.floor((startIndex + months) / 12), ((startIndex + months) % 12) + 1) <= end
  ) {
    months += 1;
  }
  const accumulated =
    months >= asset.usefulLifeMonths ? Math.round(depreciable * 100) / 100 : Math.round(monthly * months * 100) / 100;
  return { monthly, accumulated, months };
}

export async function listFixedAssets(orgId: string, asOf: string = todayInTaipei()): Promise<FixedAssetRow[]> {
  const rows = await getDb()
    .select({ asset: fixedAssets, code: glAccounts.code, name: glAccounts.name })
    .from(fixedAssets)
    .leftJoin(glAccounts, and(eq(glAccounts.id, fixedAssets.assetAccountId), eq(glAccounts.organizationId, orgId)))
    .where(and(eq(fixedAssets.organizationId, orgId), isNull(fixedAssets.deletedAt)))
    .orderBy(desc(fixedAssets.acquiredOn), desc(fixedAssets.id));
  return rows.map(({ asset, code, name }) => {
    const fa = toFixedAsset(asset);
    const dep = straightLineDepreciation(fa, asOf);
    return {
      ...fa,
      note: asset.note,
      assetAccountCode: code,
      assetAccountName: name,
      accumulatedDepreciation: dep.accumulated,
      bookValue: Math.round((fa.cost - dep.accumulated) * 100) / 100,
      monthlyDepreciation: dep.monthly,
    };
  });
}

export type FiscalPeriodRow = {
  year: number;
  month: number;
  status: "open" | "closed";
  closedAt: string | null;
  closedBy: string | null;
};

export async function listFiscalPeriods(orgId: string): Promise<FiscalPeriodRow[]> {
  const rows = await getDb()
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.organizationId, orgId))
    .orderBy(asc(fiscalPeriods.year), asc(fiscalPeriods.month));
  return rows.map((r) => ({
    year: r.year,
    month: r.month,
    status: r.status as FiscalPeriodRow["status"],
    closedAt: r.closedAt,
    closedBy: r.closedBy,
  }));
}

/** 每個月有幾筆交易（結帳頁提示「前面還有沒結的月份」用）。key = 'YYYY-MM'。 */
export async function countTransactionsByMonth(orgId: string, from: string, to: string): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({
      ym: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        sql`${transactions.txnDate} BETWEEN ${from} AND ${to}`,
      ),
    )
    .groupBy(sql`1`);
  return Object.fromEntries(rows.map((r) => [r.ym, Number(r.count)]));
}

/** 設定頁的分類、銀行帳戶清單（含停用的，未刪除）。 */
export async function listMappingSources(orgId: string) {
  const db = getDb();
  const [cats, banks] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        isActive: categories.isActive,
        glAccountId: categories.glAccountId,
      })
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.kind), asc(categories.name)),
    db
      .select({
        id: bankAccounts.id,
        name: bankAccounts.name,
        kind: bankAccounts.kind,
        currency: bankAccounts.currency,
        isActive: bankAccounts.isActive,
        ledgerScope: bankAccounts.ledgerScope,
        glAccountId: bankAccounts.glAccountId,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.organizationId, orgId), isNull(bankAccounts.deletedAt)))
      .orderBy(desc(bankAccounts.isActive), asc(bankAccounts.name)),
  ]);
  return {
    categories: cats,
    bankAccounts: banks.map((b) => ({ ...b, currency: b.currency.trim(), ledgerScope: b.ledgerScope as LedgerKind })),
  };
}
