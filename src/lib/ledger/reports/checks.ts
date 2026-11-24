/** 檢查、待處理清單、科目對應（設定頁）。 */
import { buildInternal } from "../build";
import { createCtx } from "../resolve";
import { isZero, round2 } from "../round";
import type { Check, LedgerInputs, LedgerKind, ReviewItem } from "../types";
import { balanceSheet } from "./balance-sheet";

export function runChecks(inputs: LedgerInputs, ledger: LedgerKind, asOf: string): Check[] {
  const ctx = createCtx(inputs);
  const { postings } = buildInternal(inputs, ledger, asOf, { ctx });
  const checks: Check[] = [];

  // 1. 每張分錄借貸平衡
  const unbalanced = postings.filter((p) => !isZero(p.lines.reduce((s, l) => s + l.debit - l.credit, 0)));
  checks.push({
    code: "entries_balanced",
    status: unbalanced.length ? "fail" : "pass",
    params: { count: unbalanced.length, keys: unbalanced.slice(0, 5).map((p) => p.key).join(", ") },
  });

  // 2. 資產 = 負債 + 權益
  const bs = balanceSheet(inputs, ledger, asOf, null);
  const assets = bs.rows.find((r) => r.key === "totals.assets")?.amount ?? 0;
  const le = bs.rows.find((r) => r.key === "totals.liabilities_equity")?.amount ?? 0;
  checks.push({ code: "balance_sheet_balances", status: isZero(assets - le) ? "pass" : "fail", params: { assets, liabilitiesEquity: le, diff: round2(assets - le) } });

  // 3. 銀行對帳：對帳單日的原幣帳面 vs 對帳單
  for (const rec of inputs.reconciliations) {
    if (rec.asOfDate.slice(0, 10) > asOf) continue;
    const bank = ctx.banks.get(rec.accountId);
    if (!bank || (ledger === "government" && bank.ledgerScope !== "government")) continue;
    const foreign = !ctx.fx.isFunctional(bank.currency);
    let gl = 0;
    for (const p of postings) {
      if (p.date > rec.asOfDate.slice(0, 10)) continue;
      for (const l of p.lines) if (l.bankAccountId === bank.id) gl += foreign ? (l.fxAmount ?? 0) : l.debit - l.credit;
    }
    gl = round2(gl);
    const diff = round2(gl - rec.statementBalance);
    checks.push({
      code: "bank_reconciliation",
      status: isZero(diff) ? "pass" : "fail",
      params: { account: bank.name, accountId: bank.id, asOfDate: rec.asOfDate.slice(0, 10), currency: bank.currency, gl, statement: rec.statementBalance, diff },
    });
  }

  // 4. 員工代墊子帳 = 未還代墊（這本帳裡的代墊 − 沖它的報帳）
  const empId = ctx.sys("employee_payable");
  let glPayable = 0;
  for (const p of postings) for (const l of p.lines) if (l.glAccountId === empId) glPayable += l.credit - l.debit;
  glPayable = round2(glPayable);
  let outstanding = 0;
  const start = ctx.booksStart;
  for (const t of inputs.transactions) {
    const d = t.txnDate.slice(0, 10);
    if (d > asOf || (start && d < start)) continue;
    const conv = ctx.fx.toFunctional(t.amount, t.currency, t.amountTwd, d);
    if (!conv) continue;
    if (t.type === "advance" && (ledger === "management" || t.book !== "internal")) outstanding += conv.amount;
    if (t.type === "reimbursement") {
      const related = t.relatedToId != null ? ctx.txns.get(t.relatedToId) : undefined;
      if (ledger === "management" || related?.book !== "internal") outstanding -= conv.amount;
    }
  }
  // 手動分錄也會動到這個科目（例如期初），一併算進「應有」那邊
  for (const p of postings) if (p.sourceType === "manual") for (const l of p.lines) if (l.glAccountId === empId) outstanding += l.credit - l.debit;
  outstanding = round2(outstanding);
  checks.push({
    code: "employee_subledger",
    status: isZero(glPayable - outstanding) ? "pass" : "warn",
    params: { gl: glPayable, outstanding, diff: round2(glPayable - outstanding) },
  });

  // 5. 應收未沖
  const arId = ctx.sys("ar");
  let ar = 0;
  for (const p of postings) for (const l of p.lines) if (l.glAccountId === arId) ar += l.debit - l.credit;
  ar = round2(ar);
  checks.push({ code: "ar_open", status: isZero(ar) ? "pass" : "warn", params: { amount: ar } });
  return checks;
}

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

export function reviewItems(inputs: LedgerInputs, asOf: string): ReviewItem[] {
  const ctx = createCtx(inputs);
  const merged = new Map<string, ReviewItem>();
  const mappingUses = new Map<string, Set<number | null>>();
  for (const ledger of ["government", "management"] as const) {
    for (const r of buildInternal(inputs, ledger, asOf, { ctx }).review) {
      // 同一筆來源可能有兩種預設對應（分類、帳戶），用 mapping 區分；沒有 sourceId 的（外幣評價）用日期＋幣別
      // 預設對應是設定問題不是單筆問題：每個分類／帳戶只列一次，params.count 記用了幾筆
      const perMapping = r.code === "unmapped_default";
      const k = perMapping
        ? [r.code, r.params.mapping ?? "", r.params.mappingId ?? ""].join("|")
        : [r.code, r.sourceType, r.sourceId, r.params.mapping ?? "", r.params.mappingId ?? "", r.sourceId == null ? `${r.date}|${r.params.currency ?? ""}` : ""].join("|");
      if (perMapping) {
        const uses = mappingUses.get(k) ?? new Set();
        uses.add(r.sourceId);
        mappingUses.set(k, uses);
      }
      const prev = merged.get(k);
      if (!prev) merged.set(k, { ...r, ...(perMapping ? { sourceId: null } : {}), params: { ...r.params } });
      else if (prev.ledger !== r.ledger) prev.ledger = "both";
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
