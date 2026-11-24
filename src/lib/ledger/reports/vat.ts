/**
 * 營業稅（政府帳）。發票端與總帳端並列，一期一列。
 * 總帳端只看「銷項稅額的貸方」與「進項稅額的借方」：申報後的沖轉分錄（借銷項、貸進項）不該讓當期稅額歸零。
 */
import { buildInternal } from "../build";
import { addDays, addMonths } from "../periods";
import type { VatRule } from "../module";
import { createCtx, type Ctx } from "../resolve";
import { round2 } from "../round";
import type { LedgerInputs, LedgerInvoice, Posting, VatPeriodRow } from "../types";
import { orderedSections } from "./common";

type GlIds = { revenueSection: string | undefined; outputId: number; inputId: number };

function emptyRow(start: string, end: string): VatPeriodRow {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    label: `${start.slice(0, 4)}-${start.slice(5, 7)}/${pad(Number(end.slice(5, 7)))}`,
    from: start,
    to: end,
    invoiceTaxableNet: 0,
    invoiceZeroRatedNet: 0,
    invoiceExemptNet: 0,
    invoiceOutputTax: 0,
    invoiceInputTax: 0,
    glRevenue: 0,
    glOutputTax: 0,
    glInputTax: 0,
    taxDue: 0,
    difference: 0,
  };
}

/** 發票端：期內有效發票，開立的依課稅別分銷售額並累計銷項，收到的累計進項。 */
function addInvoice(r: VatPeriodRow, inv: LedgerInvoice): void {
  if (inv.status !== "valid" || !inv.invoiceDate) return;
  const d = inv.invoiceDate.slice(0, 10);
  if (d < r.from || d > r.to) return;
  const tax = inv.tax ?? 0;
  const net = inv.amountNet ?? (inv.amountGross ?? 0) - tax;
  if (inv.direction === "received") {
    r.invoiceInputTax += tax;
    return;
  }
  if (inv.taxTreatment === "taxable") r.invoiceTaxableNet += net;
  else if (inv.taxTreatment === "zero_rated") r.invoiceZeroRatedNet += net;
  else r.invoiceExemptNet += net;
  r.invoiceOutputTax += tax;
}

/** 總帳端：營業收入淨額、銷項稅額的貸方、進項稅額的借方。 */
function addPosting(r: VatPeriodRow, ctx: Ctx, ids: GlIds, p: Posting): void {
  if (p.date < r.from || p.date > r.to) return;
  for (const l of p.lines) {
    if (ids.revenueSection && ctx.sectionOf(l.glAccountId)?.key === ids.revenueSection) r.glRevenue += l.credit - l.debit;
    if (l.glAccountId === ids.outputId) r.glOutputTax += l.credit;
    if (l.glAccountId === ids.inputId) r.glInputTax += l.debit;
  }
}

function roundAmounts(r: VatPeriodRow): void {
  r.invoiceTaxableNet = round2(r.invoiceTaxableNet);
  r.invoiceZeroRatedNet = round2(r.invoiceZeroRatedNet);
  r.invoiceExemptNet = round2(r.invoiceExemptNet);
  r.invoiceOutputTax = round2(r.invoiceOutputTax);
  r.invoiceInputTax = round2(r.invoiceInputTax);
  r.glRevenue = round2(r.glRevenue);
  r.glOutputTax = round2(r.glOutputTax);
  r.glInputTax = round2(r.glInputTax);
}

function taxDue(rule: VatRule, r: VatPeriodRow): number {
  if (rule.regime === "small_scale") return round2(Math.max(0, rule.rate * r.glRevenue - rule.inputCreditRatio * r.invoiceInputTax));
  return round2(r.invoiceOutputTax - r.invoiceInputTax);
}

export function vatReport(inputs: LedgerInputs, year: number): VatPeriodRow[] {
  const ctx = createCtx(inputs);
  const rule = ctx.module.vatRules[inputs.settings.vatRegime];
  if (!rule || rule.periodMonths <= 0) return [];
  const ids: GlIds = {
    // 營業收入 = 第一個「貸方為正」的損益區塊（核心不寫死科目）
    revenueSection: orderedSections(ctx, "income_statement").find((s) => s.sign === -1)?.key,
    outputId: ctx.sys("output_vat"),
    inputId: ctx.sys("input_vat"),
  };
  const { postings } = buildInternal(inputs, "government", `${year}-12-31`, { ctx });

  const rows: VatPeriodRow[] = [];
  for (let start = `${year}-01-01`; start.slice(0, 4) === String(year); start = addMonths(start, rule.periodMonths)) {
    const r = emptyRow(start, addDays(addMonths(start, rule.periodMonths), -1));
    for (const inv of inputs.invoices) addInvoice(r, inv);
    for (const p of postings) addPosting(r, ctx, ids, p);
    roundAmounts(r);
    r.taxDue = taxDue(rule, r);
    r.difference = round2(r.invoiceTaxableNet + r.invoiceZeroRatedNet + r.invoiceExemptNet - r.glRevenue);
    rows.push(r);
  }
  return rows;
}
