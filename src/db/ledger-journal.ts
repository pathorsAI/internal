/**
 * 手動分錄與薪資單付款綁定的寫入核心，網頁（ledger-mutations.ts 的 server action）與 MCP 工具共用。
 *
 * 這支不是 "use server" 檔：呼叫端自己負責驗證身分與組織（網頁用 requireOrg，MCP 用 resolveOrg），
 * 這裡只拿明確的 orgId 寫入。驗證失敗回傳 reason，讓兩邊各自翻成自己的訊息。
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import { glAccounts, journalEntries, payrollRuns, payslips } from "./schema";

export const ENTRY_LEDGERS = ["both", "government", "management"] as const;
export const ENTRY_KINDS = ["manual", "opening", "adjustment"] as const;

export type JournalLineInput = { glAccountId: number; debit: number; credit: number; memo?: string | null };
export type JournalEntryInput = {
  date: string;
  ledger: (typeof ENTRY_LEDGERS)[number];
  kind?: (typeof ENTRY_KINDS)[number];
  memo?: string | null;
  lines: JournalLineInput[];
};

export type JournalEntryError = "invalidDate" | "invalid" | "linesMin" | "lineAccount" | "lineOneSide" | "unbalanced";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (v: number) => Math.round(v * 100);
const money = (v: number) => (cents(v) / 100).toFixed(2);

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function rowsOf<R>(res: unknown): R[] {
  return ((Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? []) as R[];
}

/** 驗證並正規化分錄的行（金額取到分）。 */
export function normalizeJournalLines(
  lines: JournalLineInput[],
): { error: JournalEntryError } | { lines: JournalLineInput[] } {
  if (!Array.isArray(lines) || lines.length < 2) return { error: "linesMin" };
  const out: JournalLineInput[] = [];
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const debit = cents(Number(l.debit) || 0);
    const credit = cents(Number(l.credit) || 0);
    if (!Number.isInteger(l.glAccountId) || l.glAccountId <= 0) return { error: "lineAccount" };
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) return { error: "lineOneSide" };
    dr += debit;
    cr += credit;
    out.push({ glAccountId: l.glAccountId, debit: debit / 100, credit: credit / 100, memo: l.memo?.trim() || null });
  }
  if (dr !== cr) return { error: "unbalanced" };
  return { lines: out };
}

/** 這些科目 id 裡屬於這個組織的。 */
export async function orgAccountIds(orgId: string, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: glAccounts.id })
    .from(glAccounts)
    .where(and(eq(glAccounts.organizationId, orgId), inArray(glAccounts.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/** 寫一張手動分錄（表頭＋各行一句 SQL）。借貸不平、科目不屬於這個組織都會先擋下來。 */
export async function insertJournalEntry(
  orgId: string,
  createdBy: string,
  input: JournalEntryInput,
): Promise<{ ok: true; id: number } | { ok: false; reason: JournalEntryError }> {
  if (!isIsoDate(input.date)) return { ok: false, reason: "invalidDate" };
  if (!ENTRY_LEDGERS.includes(input.ledger)) return { ok: false, reason: "invalid" };
  const kind = input.kind ?? "manual";
  if (!ENTRY_KINDS.includes(kind)) return { ok: false, reason: "invalid" };
  const normalized = normalizeJournalLines(input.lines);
  if ("error" in normalized) return { ok: false, reason: normalized.error };
  const ids = [...new Set(normalized.lines.map((l) => l.glAccountId))];
  if ((await orgAccountIds(orgId, ids)).size !== ids.length) return { ok: false, reason: "lineAccount" };

  const payload = JSON.stringify(
    normalized.lines.map((l) => ({ glAccountId: l.glAccountId, debit: money(l.debit), credit: money(l.credit), memo: l.memo })),
  );
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
  return { ok: true, id: Number(rowsOf<{ entry_id: number | string }>(res)[0]?.entry_id) };
}

/**
 * 解開薪資單與付款交易的綁定（薪資單改回未付）。交易本身不動，例如它其實是另一個月的付款。
 * 回傳被解開的交易 id；薪資單不存在或本來就未付回傳 null。
 */
export async function unlinkPayslipPayment(
  orgId: string,
  payslipId: number,
): Promise<{ payslipId: number; transactionId: number; periodYear: number; periodMonth: number } | null> {
  const db = getDb();
  const [slip] = await db
    .select({
      id: payslips.id,
      paidTransactionId: payslips.paidTransactionId,
      periodYear: payrollRuns.periodYear,
      periodMonth: payrollRuns.periodMonth,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .where(
      and(
        eq(payslips.id, payslipId),
        eq(payrollRuns.organizationId, orgId),
        isNull(payslips.deletedAt),
        isNull(payrollRuns.deletedAt),
      ),
    )
    .limit(1);
  if (!slip?.paidTransactionId) return null;
  await db.update(payslips).set({ paidTransactionId: null, paidToAccountId: null }).where(eq(payslips.id, slip.id));
  return { payslipId: slip.id, transactionId: slip.paidTransactionId, periodYear: slip.periodYear, periodMonth: slip.periodMonth };
}
