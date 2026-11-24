/**
 * 營業稅（政府帳）。發票端與總帳端並列，一期一列。
 * 總帳端只看「銷項稅額的貸方」與「進項稅額的借方」：申報後的沖轉分錄（借銷項、貸進項）不該讓當期稅額歸零。
 */
import { buildInternal } from "../build";
import { addDays, addMonths } from "../periods";
import { createCtx } from "../resolve";
import { round2 } from "../round";
import type { LedgerInputs, VatPeriodRow } from "../types";
import { orderedSections } from "./common";

export function vatReport(inputs: LedgerInputs, year: number): VatPeriodRow[] {
  const ctx = createCtx(inputs);
  const rule = ctx.module.vatRules[inputs.settings.vatRegime];
  if (!rule || rule.periodMonths <= 0) return [];
  // 營業收入 = 第一個「貸方為正」的損益區塊（核心不寫死科目）
  const revenueSection = orderedSections(ctx, "income_statement").find((s) => s.sign === -1)?.key;
  const outputId = ctx.sys("output_vat");
  const inputId = ctx.sys("input_vat");
  const { postings } = buildInternal(inputs, "government", `${year}-12-31`, { ctx });

  const rows: VatPeriodRow[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let start = `${year}-01-01`; start.slice(0, 4) === String(year); start = addMonths(start, rule.periodMonths)) {
    const end = addDays(addMonths(start, rule.periodMonths), -1);
    const r: VatPeriodRow = {
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
    for (const inv of inputs.invoices) {
      if (inv.status !== "valid" || !inv.invoiceDate) continue;
      const d = inv.invoiceDate.slice(0, 10);
      if (d < start || d > end) continue;
      const tax = inv.tax ?? 0;
      const net = inv.amountNet ?? (inv.amountGross ?? 0) - tax;
      if (inv.direction === "issued") {
        if (inv.taxTreatment === "taxable") r.invoiceTaxableNet += net;
        else if (inv.taxTreatment === "zero_rated") r.invoiceZeroRatedNet += net;
        else r.invoiceExemptNet += net;
        r.invoiceOutputTax += tax;
      } else r.invoiceInputTax += tax;
    }
    for (const p of postings) {
      if (p.date < start || p.date > end) continue;
      for (const l of p.lines) {
        if (revenueSection && ctx.sectionOf(l.glAccountId)?.key === revenueSection) r.glRevenue += l.credit - l.debit;
        if (l.glAccountId === outputId) r.glOutputTax += l.credit;
        if (l.glAccountId === inputId) r.glInputTax += l.debit;
      }
    }
    for (const k of Object.keys(r) as (keyof VatPeriodRow)[]) if (typeof r[k] === "number") (r[k] as number) = round2(r[k] as number);
    r.taxDue =
      rule.regime === "small_scale"
        ? round2(Math.max(0, rule.rate * r.glRevenue - rule.inputCreditRatio * r.invoiceInputTax))
        : round2(r.invoiceOutputTax - r.invoiceInputTax);
    r.difference = round2(r.invoiceTaxableNet + r.invoiceZeroRatedNet + r.invoiceExemptNet - r.glRevenue);
    rows.push(r);
  }
  return rows;
}
