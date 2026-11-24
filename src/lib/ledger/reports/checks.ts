/** 檢查、待處理清單、科目對應（設定頁）。 */
import { buildInternal } from "../build";
import { createCtx, type Ctx } from "../resolve";
import { isZero, round2 } from "../round";
import type { Check, LedgerInputs, LedgerKind, LedgerTransaction, Posting, ReviewItem } from "../types";
import { balanceSheet } from "./balance-sheet";

type CheckEnv = { inputs: LedgerInputs; ledger: LedgerKind; asOf: string; ctx: Ctx; postings: Posting[] };

/** 1. 每張分錄借貸平衡 */
function entriesBalancedCheck({ postings }: CheckEnv): Check {
  const unbalanced = postings.filter((p) => !isZero(p.lines.reduce((s, l) => s + l.debit - l.credit, 0)));
  return {
    code: "entries_balanced",
    status: unbalanced.length ? "fail" : "pass",
    params: { count: unbalanced.length, keys: unbalanced.slice(0, 5).map((p) => p.key).join(", ") },
  };
}

/** 2. 資產 = 負債 + 權益 */
function balanceSheetCheck({ inputs, ledger, asOf }: CheckEnv): Check {
  const bs = balanceSheet(inputs, ledger, asOf, null);
  const assets = bs.rows.find((r) => r.key === "totals.assets")?.amount ?? 0;
  const le = bs.rows.find((r) => r.key === "totals.liabilities_equity")?.amount ?? 0;
  return { code: "balance_sheet_balances", status: isZero(assets - le) ? "pass" : "fail", params: { assets, liabilitiesEquity: le, diff: round2(assets - le) } };
}

/** 3. 銀行對帳：對帳單日的原幣帳面 vs 對帳單 */
function bankReconciliationChecks({ inputs, ledger, asOf, ctx, postings }: CheckEnv): Check[] {
  const out: Check[] = [];
  for (const rec of inputs.reconciliations) {
    const recDate = rec.asOfDate.slice(0, 10);
    if (recDate > asOf) continue;
    const bank = ctx.banks.get(rec.accountId);
    if (!bank || (ledger === "government" && bank.ledgerScope !== "government")) continue;
    const gl = round2(bankGlBalance(postings, bank.id, !ctx.fx.isFunctional(bank.currency), recDate));
    const diff = round2(gl - rec.statementBalance);
    out.push({
      code: "bank_reconciliation",
      status: isZero(diff) ? "pass" : "fail",
      params: { account: bank.name, accountId: bank.id, asOfDate: recDate, currency: bank.currency, gl, statement: rec.statementBalance, diff },
    });
  }
  return out;
}

/** 某銀行帳戶到某日的帳面餘額；外幣帳戶用原幣金額。 */
function bankGlBalance(postings: Posting[], bankId: number, foreign: boolean, upTo: string): number {
  let gl = 0;
  for (const p of postings) {
    if (p.date > upTo) continue;
    for (const l of p.lines) if (l.bankAccountId === bankId) gl += foreign ? (l.fxAmount ?? 0) : l.debit - l.credit;
  }
  return gl;
}

/** 某科目的 Σ(貸 − 借)（貸方為正），可只看部分分錄；init 是累加的起點。 */
function creditBalance(postings: Posting[], glAccountId: number, pred: (p: Posting) => boolean = () => true, init = 0): number {
  let s = init;
  for (const p of postings) {
    if (!pred(p)) continue;
    for (const l of p.lines) if (l.glAccountId === glAccountId) s += l.credit - l.debit;
  }
  return s;
}

/** 一筆交易對「未還代墊」的影響：這本帳裡的代墊加、沖它的報帳減。 */
function advanceDelta({ ledger, asOf, ctx }: CheckEnv, t: LedgerTransaction): number {
  const d = t.txnDate.slice(0, 10);
  if (d > asOf || (ctx.booksStart && d < ctx.booksStart)) return 0;
  const conv = ctx.fx.toFunctional(t.amount, t.currency, t.amountTwd, d);
  if (!conv) return 0;
  const allBooks = ledger === "management";
  if (t.type === "advance") return allBooks || t.book !== "internal" ? conv.amount : 0;
  if (t.type === "reimbursement") {
    const related = t.relatedToId == null ? undefined : ctx.txns.get(t.relatedToId);
    return allBooks || related?.book !== "internal" ? -conv.amount : 0;
  }
  return 0;
}

/** 4. 員工代墊子帳 = 未還代墊（這本帳裡的代墊 − 沖它的報帳） */
function employeeSubledgerCheck(env: CheckEnv): Check {
  const empId = env.ctx.sys("employee_payable");
  const glPayable = round2(creditBalance(env.postings, empId));
  let outstanding = 0;
  for (const t of env.inputs.transactions) outstanding += advanceDelta(env, t);
  // 手動分錄也會動到這個科目（例如期初），一併算進「應有」那邊
  outstanding = round2(creditBalance(env.postings, empId, (p) => p.sourceType === "manual", outstanding));
  return {
    code: "employee_subledger",
    status: isZero(glPayable - outstanding) ? "pass" : "warn",
    params: { gl: glPayable, outstanding, diff: round2(glPayable - outstanding) },
  };
}

/** 5. 應收未沖 */
function arOpenCheck({ ctx, postings }: CheckEnv): Check {
  const ar = round2(-creditBalance(postings, ctx.sys("ar")));
  return { code: "ar_open", status: isZero(ar) ? "pass" : "warn", params: { amount: ar } };
}

export function runChecks(inputs: LedgerInputs, ledger: LedgerKind, asOf: string): Check[] {
  const ctx = createCtx(inputs);
  const { postings } = buildInternal(inputs, ledger, asOf, { ctx });
  const env: CheckEnv = { inputs, ledger, asOf, ctx, postings };
  return [entriesBalancedCheck(env), balanceSheetCheck(env), ...bankReconciliationChecks(env), employeeSubledgerCheck(env), arOpenCheck(env)];
}

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

/**
 * 同一筆來源可能有兩種預設對應（分類、帳戶），用 mapping 區分；沒有 sourceId 的（外幣評價）用日期＋幣別。
 * 預設對應是設定問題不是單筆問題：每個分類／帳戶只列一次。
 */
function reviewKey(r: ReviewItem, perMapping: boolean): string {
  const mapping = r.params.mapping ?? "";
  const mappingId = r.params.mappingId ?? "";
  if (perMapping) return [r.code, mapping, mappingId].join("|");
  const noSource = r.sourceId == null ? `${r.date}|${r.params.currency ?? ""}` : "";
  return [r.code, r.sourceType, r.sourceId, mapping, mappingId, noSource].join("|");
}

function mergeReview(merged: Map<string, ReviewItem>, k: string, r: ReviewItem, perMapping: boolean): void {
  const prev = merged.get(k);
  if (!prev) merged.set(k, { ...r, ...(perMapping ? { sourceId: null } : {}), params: { ...r.params } });
  else if (prev.ledger !== r.ledger) prev.ledger = "both";
}

export function reviewItems(inputs: LedgerInputs, asOf: string): ReviewItem[] {
  const ctx = createCtx(inputs);
  const merged = new Map<string, ReviewItem>();
  // 預設對應：params.count 記用了幾筆
  const mappingUses = new Map<string, Set<number | null>>();
  for (const ledger of ["government", "management"] as const) {
    for (const r of buildInternal(inputs, ledger, asOf, { ctx }).review) {
      const perMapping = r.code === "unmapped_default";
      const k = reviewKey(r, perMapping);
      if (perMapping) {
        const uses = mappingUses.get(k) ?? new Set();
        uses.add(r.sourceId);
        mappingUses.set(k, uses);
      }
      mergeReview(merged, k, r, perMapping);
    }
  }
  for (const [k, uses] of mappingUses) {
    const item = merged.get(k);
    if (item) item.params.count = uses.size;
  }
  return [...merged.values()].sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || (a.date ?? "").localeCompare(b.date ?? "") || a.code.localeCompare(b.code) || (a.sourceId ?? 0) - (b.sourceId ?? 0),
  );
}

export function effectiveMappings(inputs: LedgerInputs): {
  categories: Record<number, { glAccountId: number | null; isDefault: boolean }>;
  bankAccounts: Record<number, { glAccountId: number | null; isDefault: boolean }>;
} {
  const ctx = createCtx(inputs);
  const norm = (id: number) => (id < 0 ? null : id);
  const categories: Record<number, { glAccountId: number | null; isDefault: boolean }> = {};
  for (const c of inputs.categories) {
    const m = ctx.categoryAccount(c);
    categories[c.id] = { glAccountId: norm(m.glAccountId), isDefault: m.isDefault };
  }
  const bankAccounts: Record<number, { glAccountId: number | null; isDefault: boolean }> = {};
  for (const b of inputs.bankAccounts) {
    const m = ctx.bankAccountGl(b);
    bankAccounts[b.id] = { glAccountId: norm(m.glAccountId), isDefault: m.isDefault };
  }
  return { categories, bankAccounts };
}
