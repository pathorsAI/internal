"use server";

/**
 * 總帳的寫入（docs/general-ledger.md）：設定、科目表、對應、匯率、手動分錄、財產、月結。
 *
 * neon-http 沒有互動式 transaction，所以「表頭＋多列」一律寫成單一句 CTE（INSERT … RETURNING 接
 * INSERT … SELECT），需要好幾句的（結帳）用 runBatch 包成同一個交易。借貸平衡由 DB 的 deferred
 * trigger 在 commit 時再擋一次（JOURNAL_UNBALANCED），已結帳月份由 trigger 擋（PERIOD_CLOSED）。
 */
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, runBatch } from "./index";
import {
  bankAccounts,
  categories,
  fiscalPeriods,
  fixedAssets,
  fxRates,
  glAccounts,
  journalEntries,
  orgAccountingSettings,
  transactions,
} from "./schema";
import type { ActionState } from "./mutations";
import { getAccountingSettings, hasJournalData, loadLedgerInputs, todayInTaipei } from "./ledger";
import { logWeb } from "./activity";
import { canManageOrg, requireOrg, requireOrgWithRole } from "@/lib/session";
import { computeSnapshot } from "@/lib/ledger";
import { getJurisdiction, JURISDICTION_CODES } from "@/lib/ledger/jurisdictions";
import type { CashFlowClass, GlAccountType, LedgerKind, Posting, VatRegime } from "@/lib/ledger/types";

const PATHS = ["/dashboard/accounting", "/dashboard/settings/accounting", "/dashboard/reports/statements"];
function revalidateLedger() {
  for (const p of PATHS) revalidatePath(p);
}

type T = Awaited<ReturnType<typeof getTranslations<"accounting">>>;

const GL_TYPES: ReadonlySet<GlAccountType> = new Set(["asset", "liability", "equity", "revenue", "expense"]);
const CASH_FLOWS: ReadonlySet<CashFlowClass> = new Set(["cash", "operating", "investing", "financing", "none"]);
const VAT_REGIMES: ReadonlySet<VatRegime> = new Set(["general", "small_scale", "none"]);
const ENTRY_LEDGERS = ["both", "government", "management"] as const;
const ENTRY_KINDS = ["manual", "opening", "adjustment"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const cents = (v: number) => Math.round(v * 100);
const money = (v: number) => (cents(v) / 100).toFixed(2);

function rowsOf<R>(res: unknown): R[] {
  return ((Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? []) as R[];
}

/** drizzle 會把 driver 的錯包一層（DrizzleQueryError），原始訊息在 cause。 */
function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(typeof cur === "string" ? cur : (JSON.stringify(cur) ?? ""));
      break;
    }
  }
  return parts.join(" | ");
}

function fail(e: unknown, t: T, fallback: string): ActionState {
  const text = errorText(e);
  if (text.includes("PERIOD_CLOSED")) return { ok: false, error: t("errors.periodClosed") };
  if (text.includes("JOURNAL_UNBALANCED")) return { ok: false, error: t("errors.unbalanced") };
  if (text.includes("uq_gl_code")) return { ok: false, error: t("errors.codeTaken") };
  if (text.includes("uq_fa_source_txn")) return { ok: false, error: t("errors.sourceTxnTaken") };
  // redirect() 之類的 Next 控制流程不能吞掉
  if (e && typeof e === "object" && "digest" in e) throw e;
  return { ok: false, error: e instanceof Error && !text.startsWith("Failed query") ? e.message : fallback };
}

async function manager(t: T) {
  const ctx = await requireOrgWithRole();
  if (!canManageOrg(ctx.role)) return { ...ctx, denied: { ok: false, error: t("errors.forbidden") } as ActionState };
  return { ...ctx, denied: null };
}

async function accountIdsOf(orgId: string, ids: number[]): Promise<Map<number, { type: string; systemKey: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: glAccounts.id, type: glAccounts.type, systemKey: glAccounts.systemKey })
    .from(glAccounts)
    .where(and(eq(glAccounts.organizationId, orgId), inArray(glAccounts.id, ids)));
  return new Map(rows.map((r) => [r.id, { type: r.type, systemKey: r.systemKey }]));
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

export type AccountingSettingsInput = {
  jurisdiction: string;
  framework: string;
  vatRegime: VatRegime;
  fiscalYearStartMonth: number;
  booksStartDate: string | null;
  openingEquityAccountId: number | null;
};

export async function saveAccountingSettings(input: AccountingSettingsInput): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    if (!JURISDICTION_CODES.includes(input.jurisdiction)) return { ok: false, error: t("errors.invalid") };
    const mod = getJurisdiction(input.jurisdiction);
    if (!mod.frameworks.some((f) => f.code === input.framework)) return { ok: false, error: t("errors.invalid") };
    if (!VAT_REGIMES.has(input.vatRegime)) return { ok: false, error: t("errors.invalid") };
    const fy = Number(input.fiscalYearStartMonth);
    if (!Number.isInteger(fy) || fy < 1 || fy > 12) return { ok: false, error: t("errors.invalid") };
    const booksStart = input.booksStartDate || null;
    if (booksStart !== null && !isDate(booksStart)) return { ok: false, error: t("errors.invalidDate") };

    const current = await getAccountingSettings(orgId);
    if (current.jurisdiction !== input.jurisdiction && (await hasJournalData(orgId))) {
      return { ok: false, error: t("errors.jurisdictionLocked") };
    }
    if (input.openingEquityAccountId !== null) {
      const acc = (await accountIdsOf(orgId, [input.openingEquityAccountId])).get(input.openingEquityAccountId);
      if (acc?.type !== "equity") return { ok: false, error: t("errors.openingEquityInvalid") };
    }

    const values = {
      jurisdiction: input.jurisdiction,
      framework: input.framework,
      vatRegime: input.vatRegime,
      fiscalYearStartMonth: fy,
      functionalCurrency: mod.functionalCurrency,
      booksStartDate: booksStart,
      openingEquityAccountId: input.openingEquityAccountId,
      updatedAt: sql`now()`,
    };
    await getDb()
      .insert(orgAccountingSettings)
      .values({ organizationId: orgId, ...values })
      .onConflictDoUpdate({ target: orgAccountingSettings.organizationId, set: values });
    await logWeb(
      orgId,
      "update",
      "accounting_settings",
      null,
      `jurisdiction=${input.jurisdiction} framework=${input.framework} vat=${input.vatRegime} fy=${fy} start=${booksStart ?? "-"}`,
    );
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

// ---------------------------------------------------------------------------
// 科目表
// ---------------------------------------------------------------------------

export type GlAccountInput = {
  code: string;
  name: string;
  nameEn?: string | null;
  type: GlAccountType;
  section: string;
  cashFlow: CashFlowClass;
};

async function validateGlAccount(orgId: string, input: GlAccountInput, t: T): Promise<string | null> {
  const code = input.code?.trim();
  const name = input.name?.trim();
  if (!code || !/^[0-9A-Za-z.-]{1,20}$/.test(code)) return t("errors.codeInvalid");
  if (!name) return t("errors.nameRequired");
  if (!GL_TYPES.has(input.type) || !CASH_FLOWS.has(input.cashFlow)) return t("errors.invalid");
  const settings = await getAccountingSettings(orgId);
  const section = getJurisdiction(settings.jurisdiction).sections.find((s) => s.key === input.section);
  if (!section) return t("errors.sectionInvalid");
  const balanceSheet = input.type === "asset" || input.type === "liability" || input.type === "equity";
  if ((section.statement === "balance_sheet") !== balanceSheet) return t("errors.sectionMismatch");
  return null;
}

export async function createGlAccount(input: GlAccountInput): Promise<ActionState & { id?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    const invalid = await validateGlAccount(orgId, input, t);
    if (invalid) return { ok: false, error: invalid };
    const [row] = await getDb()
      .insert(glAccounts)
      .values({
        organizationId: orgId,
        code: input.code.trim(),
        name: input.name.trim(),
        nameEn: input.nameEn?.trim() || null,
        type: input.type,
        section: input.section,
        cashFlow: input.cashFlow,
      })
      .returning({ id: glAccounts.id });
    await logWeb(orgId, "create", "gl_account", row.id, `${input.code.trim()} ${input.name.trim()}`);
    revalidateLedger();
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function updateGlAccount(id: number, input: GlAccountInput & { isActive: boolean }): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    const existing = (await accountIdsOf(orgId, [id])).get(id);
    if (!existing) return { ok: false, error: t("errors.notFound") };
    if (existing.systemKey) {
      if (!input.isActive) return { ok: false, error: t("errors.systemAccountActive") };
      if (input.type !== existing.type) return { ok: false, error: t("errors.systemAccountType") };
    }
    const invalid = await validateGlAccount(orgId, input, t);
    if (invalid) return { ok: false, error: invalid };
    await getDb()
      .update(glAccounts)
      .set({
        code: input.code.trim(),
        name: input.name.trim(),
        nameEn: input.nameEn?.trim() || null,
        type: input.type,
        section: input.section,
        cashFlow: input.cashFlow,
        isActive: input.isActive,
      })
      .where(and(eq(glAccounts.organizationId, orgId), eq(glAccounts.id, id)));
    await logWeb(orgId, "update", "gl_account", id, `${input.code.trim()} ${input.name.trim()}${input.isActive ? "" : " (inactive)"}`);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

// ---------------------------------------------------------------------------
// 對應
// ---------------------------------------------------------------------------

export async function setCategoryGlAccount(categoryId: number, glAccountId: number | null): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    if (glAccountId !== null && !(await accountIdsOf(orgId, [glAccountId])).has(glAccountId)) {
      return { ok: false, error: t("errors.notFound") };
    }
    const updated = await getDb()
      .update(categories)
      .set({ glAccountId })
      .where(and(eq(categories.organizationId, orgId), eq(categories.id, categoryId), isNull(categories.deletedAt)))
      .returning({ id: categories.id });
    if (updated.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(orgId, "update", "category", categoryId, `gl_account_id=${glAccountId ?? "default"}`);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function setBankAccountLedger(
  bankAccountId: number,
  input: { ledgerScope: LedgerKind; glAccountId: number | null },
): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    if (input.ledgerScope !== "government" && input.ledgerScope !== "management") {
      return { ok: false, error: t("errors.invalid") };
    }
    if (input.glAccountId !== null && !(await accountIdsOf(orgId, [input.glAccountId])).has(input.glAccountId)) {
      return { ok: false, error: t("errors.notFound") };
    }
    const updated = await getDb()
      .update(bankAccounts)
      .set({ ledgerScope: input.ledgerScope, glAccountId: input.glAccountId })
      .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, bankAccountId), isNull(bankAccounts.deletedAt)))
      .returning({ id: bankAccounts.id });
    if (updated.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(
      orgId,
      "update",
      "bank_account",
      bankAccountId,
      `ledger_scope=${input.ledgerScope} gl_account_id=${input.glAccountId ?? "default"}`,
    );
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

// ---------------------------------------------------------------------------
// 匯率
// ---------------------------------------------------------------------------

/** 一行一筆：「YYYY-MM-DD 匯率」，中間用空白、tab 或逗號隔開。空行與 # 開頭略過。 */
function parseRateLines(text: string): { rows: { date: string; rate: number }[]; badLines: number[] } {
  const rows = new Map<string, number>();
  const badLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    const date = parts[0]?.replaceAll("/", "-");
    const rate = Number(parts[1]?.replaceAll("_", ""));
    if (parts.length !== 2 || !isDate(date) || !Number.isFinite(rate) || rate <= 0 || rate >= 1e8) {
      badLines.push(i + 1);
      return;
    }
    rows.set(date, Math.round(rate * 1e6) / 1e6);
  });
  return { rows: [...rows].map(([date, rate]) => ({ date, rate })), badLines };
}

export async function upsertFxRates(input: { currency: string; text: string }): Promise<ActionState & { count?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const currency = input.currency?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: t("errors.currencyInvalid") };
    const settings = await getAccountingSettings(orgId);
    if (currency === settings.functionalCurrency) return { ok: false, error: t("errors.currencyFunctional") };
    const { rows, badLines } = parseRateLines(input.text ?? "");
    if (badLines.length > 0) {
      return { ok: false, error: t("errors.rateLines", { lines: badLines.slice(0, 8).join(", ") }) };
    }
    if (rows.length === 0) return { ok: false, error: t("errors.rateEmpty") };
    await getDb()
      .insert(fxRates)
      .values(rows.map((r) => ({ organizationId: orgId, currency, rateDate: r.date, rate: String(r.rate), source: "manual" })))
      .onConflictDoUpdate({
        target: [fxRates.organizationId, fxRates.currency, fxRates.rateDate],
        set: { rate: sql`excluded.rate`, source: sql`excluded.source` },
      });
    await logWeb(orgId, "update", "fx_rate", null, `${currency} ×${rows.length}`);
    revalidateLedger();
    return { ok: true, count: rows.length };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

const isWiseDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 該幣別最早一筆交易的日期；沒有交易就是今天。 */
async function earliestTxnDate(orgId: string, currency: string): Promise<string> {
  const [row] = await getDb()
    .select({ d: sql<string>`min(${transactions.txnDate})` })
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.currency, currency), isNull(transactions.deletedAt)));
  return row?.d ?? todayInTaipei();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 從 Wise 抓 from..to 的每日匯率（日期 → 匯率）。Wise 一次最多回幾百筆：每 180 天一段。 */
async function fetchWiseDailyRates(
  orgId: string,
  currency: string,
  functionalCurrency: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const { getWiseClient } = await import("@/lib/integrations/wise");
  const { client } = await getWiseClient(orgId);
  const byDate = new Map<string, number>();
  for (let start = from; start <= to; ) {
    let end = addDays(start, 180);
    if (end >= to) end = to;
    const rates = await client.getDailyRates(currency, functionalCurrency, `${start}T00:00:00+0000`, `${end}T23:59:59+0000`);
    for (const r of rates) if (r.rate > 0) byDate.set(r.time.slice(0, 10), r.rate);
    start = addDays(end, 1);
  }
  return byDate;
}

/**
 * 從已連接的 Wise 匯入每日匯率（1 外幣 = ? 本位幣）。Wise 只給讀取權限，這支只打 GET /v1/rates。
 * 預設範圍：總帳起始日（沒有就最早一筆該幣別交易）到今天；已有的日期覆寫成 Wise 的值（手動輸入的不覆寫）。
 */
export async function importFxRatesFromWise(input: { currency: string; from?: string; to?: string }): Promise<ActionState & { count?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const currency = input.currency?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: t("errors.currencyInvalid") };
    const settings = await getAccountingSettings(orgId);
    if (currency === settings.functionalCurrency) return { ok: false, error: t("errors.currencyFunctional") };
    let from = isWiseDate(input.from) ? input.from : settings.booksStartDate;
    if (!from) from = await earliestTxnDate(orgId, currency);
    const to = isWiseDate(input.to) ? input.to : todayInTaipei();
    if (from > to) return { ok: false, error: t("errors.invalid") };
    const byDate = await fetchWiseDailyRates(orgId, currency, settings.functionalCurrency, from, to);
    if (byDate.size === 0) return { ok: false, error: t("errors.rateEmpty") };
    await getDb()
      .insert(fxRates)
      .values([...byDate].map(([date, rate]) => ({ organizationId: orgId, currency, rateDate: date, rate: String(rate), source: "wise" })))
      .onConflictDoUpdate({
        target: [fxRates.organizationId, fxRates.currency, fxRates.rateDate],
        set: { rate: sql`excluded.rate`, source: sql`excluded.source` },
        setWhere: sql`${fxRates.source} <> 'manual'`,
      });
    await logWeb(orgId, "update", "fx_rate", null, `${currency} from Wise ×${byDate.size}`);
    revalidateLedger();
    return { ok: true, count: byDate.size };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function deleteFxRate(id: number): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const deleted = await getDb()
      .delete(fxRates)
      .where(and(eq(fxRates.organizationId, orgId), eq(fxRates.id, id)))
      .returning({ currency: fxRates.currency, rateDate: fxRates.rateDate });
    if (deleted.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(orgId, "delete", "fx_rate", id, `${deleted[0].currency.trim()} ${deleted[0].rateDate}`);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.deleteFailed"));
  }
}

/**
 * 外幣交易補上台幣金額：amount × 交易日當天或之前最近一筆匯率。找不到匯率、或落在已結帳月份的略過。
 * 一句 UPDATE 做完，回傳補了幾筆、略過幾筆。
 */
export async function fillMissingAmountTwd(): Promise<ActionState & { filled?: number; skipped?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const { functionalCurrency } = await getAccountingSettings(orgId);
    const res = await getDb().execute(sql`
      WITH cand AS MATERIALIZED (
        SELECT t.id, t.amount, t.txn_date,
          (SELECT r.rate FROM ${fxRates} r
            WHERE r.organization_id = t.organization_id AND r.currency = t.currency AND r.rate_date <= t.txn_date
            ORDER BY r.rate_date DESC LIMIT 1) AS rate
        FROM ${transactions} t
        WHERE t.organization_id = ${orgId} AND t.deleted_at IS NULL AND t.amount_twd IS NULL
          AND t.currency <> ${functionalCurrency}
      ),
      upd AS (
        UPDATE ${transactions} t
        SET amount_twd = round(c.amount * c.rate, 2), updated_at = now()
        FROM cand c
        WHERE t.id = c.id AND t.organization_id = ${orgId} AND c.rate IS NOT NULL
          AND NOT period_is_closed(${orgId}, c.txn_date)
        RETURNING t.id
      )
      SELECT (SELECT count(*) FROM upd)::int AS filled, (SELECT count(*) FROM cand)::int AS total
    `);
    const [row] = rowsOf<{ filled: number | string; total: number | string }>(res);
    const filled = Number(row?.filled ?? 0);
    const skipped = Number(row?.total ?? 0) - filled;
    await logWeb(orgId, "update", "transaction", null, `fill amount_twd: filled=${filled} skipped=${skipped}`);
    revalidateLedger();
    revalidatePath("/dashboard/transactions");
    return { ok: true, filled, skipped };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

// ---------------------------------------------------------------------------
// 手動分錄
// ---------------------------------------------------------------------------

export type JournalLineInput = { glAccountId: number; debit: number; credit: number; memo?: string | null };
export type JournalEntryInput = {
  date: string;
  ledger: (typeof ENTRY_LEDGERS)[number];
  kind?: (typeof ENTRY_KINDS)[number];
  memo?: string | null;
  lines: JournalLineInput[];
};

/** 驗證並正規化分錄的行（金額取到分）。回傳錯誤訊息或乾淨的行。 */
function normalizeLines(lines: JournalLineInput[], t: T): { error: string } | { lines: JournalLineInput[] } {
  if (!Array.isArray(lines) || lines.length < 2) return { error: t("errors.linesMin") };
  const out: JournalLineInput[] = [];
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const debit = cents(Number(l.debit) || 0);
    const credit = cents(Number(l.credit) || 0);
    if (!Number.isInteger(l.glAccountId) || l.glAccountId <= 0) return { error: t("errors.lineAccount") };
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) return { error: t("errors.lineOneSide") };
    dr += debit;
    cr += credit;
    out.push({ glAccountId: l.glAccountId, debit: debit / 100, credit: credit / 100, memo: l.memo?.trim() || null });
  }
  if (dr !== cr) return { error: t("errors.unbalanced") };
  return { lines: out };
}

export async function createJournalEntry(input: JournalEntryInput): Promise<ActionState & { id?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, session } = await requireOrg();
    if (!isDate(input.date)) return { ok: false, error: t("errors.invalidDate") };
    if (!ENTRY_LEDGERS.includes(input.ledger)) return { ok: false, error: t("errors.invalid") };
    const kind = input.kind ?? "manual";
    if (!ENTRY_KINDS.includes(kind)) return { ok: false, error: t("errors.invalid") };
    const normalized = normalizeLines(input.lines, t);
    if ("error" in normalized) return { ok: false, error: normalized.error };
    const ids = [...new Set(normalized.lines.map((l) => l.glAccountId))];
    if ((await accountIdsOf(orgId, ids)).size !== ids.length) return { ok: false, error: t("errors.lineAccount") };

    const payload = JSON.stringify(
      normalized.lines.map((l) => ({ glAccountId: l.glAccountId, debit: money(l.debit), credit: money(l.credit), memo: l.memo })),
    );
    const createdBy = session.user.name || session.user.email;
    const res = await getDb().execute(sql`
      WITH e AS (
        INSERT INTO ${journalEntries} (organization_id, ledger, kind, entry_date, memo, created_by)
        VALUES (${orgId}, ${input.ledger}, ${kind}, ${input.date}::date, ${input.memo?.trim() || null}, ${createdBy})
        RETURNING id
      )
      INSERT INTO journal_lines (entry_id, gl_account_id, debit, credit, memo)
      SELECT e.id, (l->>'glAccountId')::bigint, (l->>'debit')::numeric, (l->>'credit')::numeric, l->>'memo'
      FROM e, jsonb_array_elements(${payload}::text::jsonb) AS l
      RETURNING entry_id
    `);
    const id = Number(rowsOf<{ entry_id: number | string }>(res)[0]?.entry_id);
    await logWeb(orgId, "create", "journal_entry", id || null, `${input.date} ${input.ledger} ${input.memo ?? ""}`.trim());
    revalidateLedger();
    return { ok: true, id };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function deleteJournalEntry(id: number): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const deleted = await getDb()
      .update(journalEntries)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          eq(journalEntries.id, id),
          isNull(journalEntries.deletedAt),
          sql`${journalEntries.kind} <> 'snapshot'`,
        ),
      )
      .returning({ id: journalEntries.id, entryDate: journalEntries.entryDate });
    if (deleted.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(orgId, "delete", "journal_entry", id, deleted[0].entryDate);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.deleteFailed"));
  }
}

// ---------------------------------------------------------------------------
// 財產目錄
// ---------------------------------------------------------------------------

export type FixedAssetInput = {
  name: string;
  acquiredOn: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  assetAccountId: number | null;
  sourceTransactionId: number | null;
  disposedOn: string | null;
  note?: string | null;
};

async function validateFixedAsset(orgId: string, input: FixedAssetInput, t: T): Promise<string | null> {
  if (!input.name?.trim()) return t("errors.nameRequired");
  if (!isDate(input.acquiredOn)) return t("errors.invalidDate");
  if (input.disposedOn && (!isDate(input.disposedOn) || input.disposedOn < input.acquiredOn)) return t("errors.disposedBeforeAcquired");
  const cost = Number(input.cost);
  const salvage = Number(input.salvageValue) || 0;
  if (!Number.isFinite(cost) || cost <= 0) return t("errors.costInvalid");
  if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost) return t("errors.salvageInvalid");
  const life = Number(input.usefulLifeMonths);
  if (!Number.isInteger(life) || life < 1 || life > 600) return t("errors.lifeInvalid");
  if (input.assetAccountId !== null) {
    const acc = (await accountIdsOf(orgId, [input.assetAccountId])).get(input.assetAccountId);
    if (acc?.type !== "asset") return t("errors.assetAccountInvalid");
  }
  if (input.sourceTransactionId !== null) {
    const [txn] = await getDb()
      .select({ type: transactions.type })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.id, input.sourceTransactionId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    if (txn?.type !== "expense") return t("errors.sourceTxnInvalid");
  }
  return null;
}

function assetValues(input: FixedAssetInput) {
  return {
    name: input.name.trim(),
    acquiredOn: input.acquiredOn,
    cost: money(Number(input.cost)),
    salvageValue: money(Number(input.salvageValue) || 0),
    usefulLifeMonths: Number(input.usefulLifeMonths),
    assetAccountId: input.assetAccountId,
    sourceTransactionId: input.sourceTransactionId,
    disposedOn: input.disposedOn || null,
    note: input.note?.trim() || null,
  };
}

export async function createFixedAsset(input: FixedAssetInput): Promise<ActionState & { id?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const invalid = await validateFixedAsset(orgId, input, t);
    if (invalid) return { ok: false, error: invalid };
    const [row] = await getDb()
      .insert(fixedAssets)
      .values({ organizationId: orgId, ...assetValues(input) })
      .returning({ id: fixedAssets.id });
    await logWeb(orgId, "create", "fixed_asset", row.id, `${input.name.trim()} ${money(Number(input.cost))}`);
    revalidateLedger();
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function updateFixedAsset(id: number, input: FixedAssetInput): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const invalid = await validateFixedAsset(orgId, input, t);
    if (invalid) return { ok: false, error: invalid };
    const updated = await getDb()
      .update(fixedAssets)
      .set(assetValues(input))
      .where(and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.id, id), isNull(fixedAssets.deletedAt)))
      .returning({ id: fixedAssets.id });
    if (updated.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(orgId, "update", "fixed_asset", id, input.name.trim());
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.saveFailed"));
  }
}

export async function deleteFixedAsset(id: number): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId } = await requireOrg();
    const deleted = await getDb()
      .update(fixedAssets)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.id, id), isNull(fixedAssets.deletedAt)))
      .returning({ name: fixedAssets.name });
    if (deleted.length === 0) return { ok: false, error: t("errors.notFound") };
    await logWeb(orgId, "delete", "fixed_asset", id, deleted[0].name);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.deleteFailed"));
  }
}

// ---------------------------------------------------------------------------
// 月結
// ---------------------------------------------------------------------------

function validPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2999 && Number.isInteger(month) && month >= 1 && month <= 12;
}

/** engine 的 Posting → 快照 payload。外幣評價與手動分錄不存（每次 build 會重算／本來就存著）。 */
function snapshotPayload(postings: Posting[]) {
  return postings
    .filter((p) => p.sourceType !== "fx_revaluation" && p.sourceType !== "manual" && p.lines.length > 0)
    .map((p) => ({
      ledger: p.ledger,
      date: p.date,
      memo: p.memo || null,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      lines: p.lines.map((l) => ({
        glAccountId: l.glAccountId,
        debit: money(l.debit),
        credit: money(l.credit),
        currency: l.currency,
        fxAmount: l.fxAmount === null ? null : money(l.fxAmount),
        partyId: l.partyId,
        employeeId: l.employeeId,
        bankAccountId: l.bankAccountId,
        memo: l.memo,
      })),
    }));
}

/**
 * 結帳：把該月兩本帳 engine 算出的分錄存成快照，月份改成 closed。同一個交易裡：
 *   1. 守門：這個月不能已經是 closed（除以零讓整批失敗）
 *   2. 刪掉這個月殘留的舊快照
 *   3. 一句 CTE 寫入所有快照表頭與分錄行（先用 sequence 配好 id，表頭與行才對得起來）
 *   4. fiscal_periods upsert 成 closed
 */
export async function closePeriod(year: number, month: number): Promise<ActionState & { entries?: number }> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, session, denied } = await manager(t);
    if (denied) return denied;
    if (!validPeriod(year, month)) return { ok: false, error: t("errors.invalid") };

    const inputs = await loadLedgerInputs(orgId);
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    if (inputs.closedPeriods.includes(ym)) return { ok: false, error: t("errors.alreadyClosed") };
    const payload = snapshotPayload([
      ...computeSnapshot(inputs, "government", year, month),
      ...computeSnapshot(inputs, "management", year, month),
    ]);
    for (const p of payload) {
      const dr = p.lines.reduce((s, l) => s + cents(Number(l.debit)), 0);
      const cr = p.lines.reduce((s, l) => s + cents(Number(l.credit)), 0);
      if (dr !== cr) return { ok: false, error: t("errors.snapshotUnbalanced", { source: `${p.sourceType}:${p.sourceId ?? "-"}` }) };
    }
    const closedBy = session.user.name || session.user.email;
    const firstDay = `${ym}-01`;
    const json = JSON.stringify(payload);

    await runBatch((q) => {
      const guard = q.execute(sql`
        SELECT 1 / (CASE WHEN period_is_closed(${orgId}, ${firstDay}::date) THEN 0 ELSE 1 END) AS ok`);
      const clear = q
        .delete(journalEntries)
        .where(
          and(
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.kind, "snapshot"),
            eq(journalEntries.snapshotYear, year),
            eq(journalEntries.snapshotMonth, month),
          ),
        );
      const mark = q.execute(sql`
        INSERT INTO ${fiscalPeriods} (organization_id, year, month, status, closed_at, closed_by)
        VALUES (${orgId}, ${year}, ${month}, 'closed', now(), ${closedBy})
        ON CONFLICT (organization_id, year, month)
        DO UPDATE SET status = 'closed', closed_at = now(), closed_by = excluded.closed_by`);
      if (payload.length === 0) return [guard, clear, mark] as const;
      const insert = q.execute(sql`
        WITH src AS MATERIALIZED (
          SELECT nextval(pg_get_serial_sequence('journal_entries', 'id')) AS id, e.value AS e
          FROM jsonb_array_elements(${json}::text::jsonb) AS e
        ),
        ins AS (
          INSERT INTO journal_entries
            (id, organization_id, ledger, kind, entry_date, memo, snapshot_year, snapshot_month, source_type, source_id, created_by)
          OVERRIDING SYSTEM VALUE
          SELECT src.id, ${orgId}, src.e->>'ledger', 'snapshot', (src.e->>'date')::date, src.e->>'memo',
            ${year}, ${month}, src.e->>'sourceType', (src.e->>'sourceId')::bigint, ${closedBy}
          FROM src
          RETURNING id
        )
        INSERT INTO journal_lines (entry_id, gl_account_id, debit, credit, currency, fx_amount, party_id, employee_id, bank_account_id, memo)
        SELECT src.id, (l->>'glAccountId')::bigint, (l->>'debit')::numeric, (l->>'credit')::numeric,
          l->>'currency', (l->>'fxAmount')::numeric, (l->>'partyId')::bigint, (l->>'employeeId')::bigint, (l->>'bankAccountId')::bigint, l->>'memo'
        FROM src, jsonb_array_elements(src.e->'lines') AS l`);
      return [guard, clear, insert, mark] as const;
    });

    await logWeb(orgId, "update", "fiscal_period", null, `close ${ym} (${payload.length} entries)`);
    revalidateLedger();
    return { ok: true, entries: payload.length };
  } catch (e) {
    if (errorText(e).includes("division by zero")) return { ok: false, error: t("errors.alreadyClosed") };
    return fail(e, t, t("errors.closeFailed"));
  }
}

/** 重新開帳：刪掉該月快照，月份改回 open。 */
export async function reopenPeriod(year: number, month: number): Promise<ActionState> {
  const t = await getTranslations("accounting");
  try {
    const { orgId, denied } = await manager(t);
    if (denied) return denied;
    if (!validPeriod(year, month)) return { ok: false, error: t("errors.invalid") };
    await runBatch((q) => [
      q
        .delete(journalEntries)
        .where(
          and(
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.kind, "snapshot"),
            eq(journalEntries.snapshotYear, year),
            eq(journalEntries.snapshotMonth, month),
          ),
        ),
      q
        .update(fiscalPeriods)
        .set({ status: "open", closedAt: null, closedBy: null })
        .where(and(eq(fiscalPeriods.organizationId, orgId), eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month))),
    ]);
    await logWeb(orgId, "update", "fiscal_period", null, `reopen ${year}-${String(month).padStart(2, "0")}`);
    revalidateLedger();
    return { ok: true };
  } catch (e) {
    return fail(e, t, t("errors.reopenFailed"));
  }
}

