/**
 * 交易 → 分錄（docs/general-ledger.md §2.2）。
 *
 * 先照 type 拆「腳」，每腳帶角色；政府帳再依角色把不屬於政府帳的腳換成股東往來，最後合併同科目同子帳。
 * 管理帳不換任何東西。
 */
import { round2 } from "./round";
import { line, type Ctx } from "./resolve";
import type { LedgerBankAccount, LedgerKind, LedgerTransaction, Posting, PostingLine, ReviewItem } from "./types";

type Role =
  | "bank" // 銀行帳戶那一腳：帳戶是隱形帳戶 → 政府帳換成股東往來
  | "recognition" // 認列腳：book = internal → 政府帳換成股東往來
  | "recognition_invoice" // 綁了開立發票的 ar：不看 book
  | "reimbursement" // 報帳的員工代墊：related advance 不在政府帳 → 換
  | "neutral"; // 不換（transfer／reimbursement 沒帳戶時的 unpaid_clearing）

type Leg = { role: Role; line: PostingLine; categoryDefault?: number; bankDefault?: number; uncategorized?: boolean };

export function review(
  code: ReviewItem["code"],
  severity: ReviewItem["severity"],
  ledger: ReviewItem["ledger"],
  sourceType: ReviewItem["sourceType"],
  sourceId: number | null,
  date: string | null,
  amount: number | null,
  params: ReviewItem["params"] = {},
): ReviewItem {
  return { code, severity, ledger, sourceType, sourceId, date, amount, params };
}

/** 交易金額在某個銀行帳戶上的原幣金額。帳戶幣別跟交易不同時用匯率推回去，推不出來就 null。 */
export function nativeFor(ctx: Ctx, txn: LedgerTransaction, bank: LedgerBankAccount, functionalAmount: number): number | null {
  const cur = bank.currency.toUpperCase();
  if (cur === txn.currency.toUpperCase()) return round2(txn.amount);
  if (cur === ctx.functional) return functionalAmount;
  const hit = ctx.fx.rateAt(cur, txn.txnDate);
  return hit ? round2(functionalAmount / hit.rate) : null;
}

/** 合併同科目、同子帳、同幣別的行；淨額 0 的行丟掉。 */
export function mergeLines(lines: PostingLine[]): PostingLine[] {
  const order: string[] = [];
  const acc = new Map<string, { base: PostingLine; net: number; fx: number | null }>();
  for (const l of lines) {
    const k = [l.glAccountId, l.partyId, l.employeeId, l.bankAccountId, l.currency].join("|");
    let cur = acc.get(k);
    if (!cur) {
      cur = { base: l, net: 0, fx: null };
      acc.set(k, cur);
      order.push(k);
    }
    cur.net += l.debit - l.credit;
    if (l.fxAmount != null) cur.fx = (cur.fx ?? 0) + l.fxAmount;
  }
  const out: PostingLine[] = [];
  for (const k of order) {
    const { base, net, fx } = acc.get(k)!;
    const n = round2(net);
    const f = fx == null ? null : round2(fx);
    if (n === 0 && !f) continue;
    out.push({ ...base, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0, fxAmount: f });
  }
  return out;
}

/** 有效、有發票日的開立發票才會入帳（§2.3）；只有這種 income 才貸 ar。 */
export function postableIssuedInvoice(ctx: Ctx, invoiceId: number | null) {
  if (invoiceId == null) return null;
  const inv = ctx.invoices.get(invoiceId);
  if (!inv || inv.direction !== "issued" || inv.status !== "valid" || !inv.invoiceDate) return null;
  if (inv.amountGross == null && inv.amountNet == null) return null;
  return inv;
}

export type TxnPostResult = { posting: Posting | null; review: ReviewItem[]; functionalAmount: number | null };

export function postTransaction(ctx: Ctx, txn: LedgerTransaction, ledger: LedgerKind): TxnPostResult {
  const reviews: ReviewItem[] = [];
  const date = txn.txnDate.slice(0, 10);
  const conv = ctx.fx.toFunctional(txn.amount, txn.currency, txn.amountTwd, date);
  if (!conv) {
    reviews.push(review("missing_fx", "error", ledger, "transaction", txn.id, date, txn.amount, { currency: txn.currency }));
    return { posting: null, review: reviews, functionalAmount: null };
  }
  const F = conv.amount;
  if (conv.estimated) reviews.push(review("fx_estimated", "warning", ledger, "transaction", txn.id, date, F, { currency: txn.currency }));

  const legs = buildLegs(ctx, txn, F);

  let swapped = false;
  if (ledger === "government") {
    const shareholder = ctx.sys("shareholder");
    for (const leg of legs) {
      if (!shouldSwap(ctx, txn, leg)) continue;
      swapped = true;
      leg.line = line(shareholder, leg.line.debit - leg.line.credit);
      leg.categoryDefault = undefined;
      leg.bankDefault = undefined;
      leg.uncategorized = false;
    }
  }

  const lines = mergeLines(legs.map((l) => l.line));
  const shareholderId = ctx.sys("shareholder");
  if (lines.length === 0 || lines.every((l) => l.glAccountId === shareholderId)) {
    return { posting: null, review: reviews, functionalAmount: F };
  }

  for (const leg of legs) {
    if (leg.uncategorized) reviews.push(review("uncategorized", "warning", ledger, "transaction", txn.id, date, F, { type: txn.type }));
    if (leg.categoryDefault != null)
      reviews.push(
        review("unmapped_default", "info", ledger, "transaction", txn.id, date, F, {
          mapping: "category",
          mappingId: leg.categoryDefault,
          name: ctx.categories.get(leg.categoryDefault)?.name ?? "",
          code: ctx.accounts.get(leg.line.glAccountId)?.code ?? "",
        }),
      );
    if (leg.bankDefault != null)
      reviews.push(
        review("unmapped_default", "info", ledger, "transaction", txn.id, date, F, {
          mapping: "bank_account",
          mappingId: leg.bankDefault,
          name: ctx.banks.get(leg.bankDefault)?.name ?? "",
          code: ctx.accounts.get(leg.line.glAccountId)?.code ?? "",
        }),
      );
  }
  if (swapped) reviews.push(review("shareholder_plug", "info", "government", "transaction", txn.id, date, F, { type: txn.type, book: txn.book }));

  return {
    posting: {
      key: `transaction:${txn.id}:${ledger}`,
      ledger,
      date,
      sourceType: "transaction",
      sourceId: txn.id,
      memo: txn.description ?? "",
      fromSnapshot: false,
      lines,
    },
    review: reviews,
    functionalAmount: F,
  };
}

function shouldSwap(ctx: Ctx, txn: LedgerTransaction, leg: Leg): boolean {
  switch (leg.role) {
    case "bank": {
      const bank = leg.line.bankAccountId != null ? ctx.banks.get(leg.line.bankAccountId) : undefined;
      return bank?.ledgerScope === "management";
    }
    case "recognition":
      // 綁了開立發票的收款不看 book：發票政府一定看得到
      if (txn.type === "income" && postableIssuedInvoice(ctx, txn.invoiceId)) return false;
      return txn.book === "internal" && (txn.type === "income" || txn.type === "expense" || txn.type === "advance");
    case "reimbursement": {
      const related = txn.relatedToId != null ? ctx.txns.get(txn.relatedToId) : undefined;
      return related?.book === "internal";
    }
    default:
      return false;
  }
}

function buildLegs(ctx: Ctx, txn: LedgerTransaction, F: number): Leg[] {
  const legs: Leg[] = [];
  const party = { partyId: txn.partyId };

  /** side = +1 借、-1 貸。沒帳戶（或帳戶不存在）→ unpaid_clearing。 */
  const bankLeg = (accountId: number | null, side: 1 | -1, clearingRole: Role) => {
    const bank = accountId != null ? ctx.banks.get(accountId) : undefined;
    if (!bank) {
      legs.push({ role: clearingRole, line: line(ctx.sys("unpaid_clearing"), side * F, party) });
      return;
    }
    const m = ctx.bankAccountGl(bank);
    const foreign = !ctx.fx.isFunctional(bank.currency);
    const native = foreign ? nativeFor(ctx, txn, bank, F) : null;
    legs.push({
      role: "bank",
      line: line(m.glAccountId, side * F, {
        bankAccountId: bank.id,
        currency: foreign ? bank.currency.toUpperCase() : null,
        fxAmount: foreign && native != null ? side * native : null,
      }),
      bankDefault: m.isDefault ? bank.id : undefined,
    });
  };

  const categoryLeg = (side: 1 | -1, amount: number, fallback: "uncategorized_income" | "uncategorized_expense") => {
    const cat = txn.categoryId != null ? ctx.categories.get(txn.categoryId) : undefined;
    if (!cat) {
      legs.push({ role: "recognition", line: line(ctx.sys(fallback), side * amount, party), uncategorized: true });
      return;
    }
    const m = ctx.categoryAccount(cat);
    legs.push({ role: "recognition", line: line(m.glAccountId, side * amount, party), categoryDefault: m.isDefault ? cat.id : undefined });
  };

  switch (txn.type) {
    case "income": {
      bankLeg(txn.toAccountId, 1, "recognition");
      if (postableIssuedInvoice(ctx, txn.invoiceId)) {
        legs.push({ role: "recognition_invoice", line: line(ctx.sys("ar"), -F, party) });
      } else categoryLeg(-1, F, "uncategorized_income");
      break;
    }
    case "expense": {
      let net = F;
      const inv = txn.invoiceId != null ? ctx.invoices.get(txn.invoiceId) : undefined;
      if (inv && inv.direction === "received" && inv.status === "valid" && (inv.tax ?? 0) > 0) {
        const gross = inv.amountGross ?? (inv.amountNet ?? 0) + (inv.tax ?? 0);
        if (Math.abs(gross - F) < 0.01) {
          const tax = round2(inv.tax ?? 0);
          legs.push({ role: "recognition", line: line(ctx.sys("input_vat"), tax, party) });
          net = round2(F - tax);
        }
      }
      const asset = ctx.assetsBySourceTxn.get(txn.id);
      if (asset) {
        const assetGl = asset.assetAccountId != null && ctx.accounts.has(asset.assetAccountId) ? asset.assetAccountId : ctx.sys("fixed_asset");
        legs.push({ role: "recognition", line: line(assetGl, net, party) });
      } else categoryLeg(1, net, "uncategorized_expense");
      bankLeg(txn.fromAccountId, -1, "recognition");
      break;
    }
    case "advance": {
      categoryLeg(1, F, "uncategorized_expense");
      legs.push({ role: "recognition", line: line(ctx.sys("employee_payable"), -F, { employeeId: txn.settleEmployeeId }) });
      break;
    }
    case "reimbursement": {
      const related = txn.relatedToId != null ? ctx.txns.get(txn.relatedToId) : undefined;
      const employeeId = txn.settleEmployeeId ?? related?.settleEmployeeId ?? null;
      legs.push({ role: "reimbursement", line: line(ctx.sys("employee_payable"), F, { employeeId }) });
      bankLeg(txn.fromAccountId, -1, "neutral");
      break;
    }
    case "transfer": {
      bankLeg(txn.toAccountId, 1, "neutral");
      bankLeg(txn.fromAccountId, -1, "neutral");
      break;
    }
  }
  return legs;
}

/** 這筆交易在這本帳裡算不算「在帳上」（用在員工子帳檢查等）。 */
export function txnInGovernment(txn: LedgerTransaction): boolean {
  return txn.book !== "internal";
}
