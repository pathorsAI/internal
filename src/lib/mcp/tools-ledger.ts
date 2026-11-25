import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { loadLedgerInputs, todayInTaipei } from "@/db/ledger";
import { ENTRY_KINDS, ENTRY_LEDGERS, insertJournalEntry, type JournalEntryError, type JournalLineInput } from "@/db/ledger-journal";
import { glAccounts } from "@/db/schema";
import { user } from "@/db/auth-schema";
import {
  balanceSheet,
  cashFlowStatement,
  equityChanges,
  incomeStatement,
  reviewItems,
  runChecks,
  trialBalance,
  vatReport,
} from "@/lib/ledger";
import type { LedgerKind, Period } from "@/lib/ledger/types";
import { messages } from "@/i18n/messages";
import { loose, rowLabel } from "@/app/dashboard/reports/statements/labels";
import { optDate, optString, ORG_ARG, requireNumber, resolveOrg, rowSchema, type JsonSchemaObject, type ToolDef } from "./shared";

/**
 * 總帳報表（docs/general-ledger.md §3），唯讀。數字由 src/lib/ledger 即時從交易、發票算出來，
 * 跟網頁「報表 > 財務報表」、Excel 匯出同一套函式。
 */

const REPORTS = ["balance_sheet", "income_statement", "cash_flow", "equity_changes", "trial_balance"] as const;
type Report = (typeof REPORTS)[number];

const LEDGER_ARG = {
  ledger: {
    type: "string",
    enum: ["government", "management"],
    description:
      "government (default) = 政府帳: only government-visible bank accounts and reportable items, with the off-book side posted to 股東往來 (due to shareholders). management = 管理帳: everything, including off-book accounts such as Wise.",
  },
} as const;

/** 報表列的顯示名稱一律用 zh-TW（台灣財報用語），跟網頁預設語系一致。 */
const tStatements = loose(
  createTranslator({ locale: "zh-TW", messages: messages["zh-TW"], namespace: "statements" }),
);

function ledgerArg(args: Record<string, unknown>): LedgerKind {
  const v = optString(args, "ledger");
  if (v === undefined || v === "government") return "government";
  if (v === "management") return "management";
  throw new Error('"ledger" must be government or management.');
}

const PERIOD_SCHEMA = rowSchema({ from: { type: "string" }, to: { type: "string" } });

const CHECK_ROW = rowSchema({
  code: { type: "string" },
  status: { type: "string", enum: ["pass", "warn", "fail"] },
  params: { type: "object", description: "Numbers behind the check (differences, counts)." },
});

const STATEMENT_RESULT: JsonSchemaObject = {
  type: "object",
  properties: {
    report: { type: "string", enum: [...REPORTS] },
    ledger: { type: "string", enum: ["government", "management"] },
    currency: { type: "string", description: "Functional currency; every amount is in it." },
    period: PERIOD_SCHEMA,
    comparePeriod: { anyOf: [PERIOD_SCHEMA, { type: "null" }] },
    rows: {
      type: "array",
      description:
        "balance_sheet / income_statement / cash_flow: { key, kind (header|account|subtotal|total), name, code, glAccountId, level, amount, compareAmount }. trial_balance: { glAccountId, code, name, type, opening, debit, credit, closing } (balances debit-positive). equity_changes: { key, name, capital, retained, other, total }.",
      items: { type: "object" },
    },
    checks: { type: "array", items: CHECK_ROW },
  },
  required: ["report", "ledger", "currency", "period", "comparePeriod", "rows", "checks"],
  additionalProperties: false,
};

const REVIEW_ROW = rowSchema({
  code: { type: "string" },
  title: { type: "string", description: "Short zh-TW name of the issue." },
  severity: { type: "string", enum: ["error", "warning", "info"] },
  ledger: { type: "string", enum: ["government", "management", "both"] },
  sourceType: { type: "string" },
  sourceId: { type: ["number", "null"] },
  date: { type: ["string", "null"] },
  amount: { type: ["number", "null"] },
  params: { type: "object" },
});

const VAT_ROW = rowSchema({
  label: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  invoiceTaxableNet: { type: "number" },
  invoiceZeroRatedNet: { type: "number" },
  invoiceExemptNet: { type: "number" },
  invoiceOutputTax: { type: "number" },
  invoiceInputTax: { type: "number" },
  glRevenue: { type: "number" },
  glOutputTax: { type: "number" },
  glInputTax: { type: "number" },
  taxDue: { type: "number" },
  difference: { type: "number" },
});

function resolvePeriod(report: Report, args: Record<string, unknown>, today: string, fyStartMonth: number): Period {
  const to = optDate(args, "to") ?? optDate(args, "as_of") ?? today;
  let from = optDate(args, "from");
  if (!from) {
    // 預設從 to 所在會計年度的第一天起算
    const y = Number(to.slice(0, 4));
    const m = Number(to.slice(5, 7));
    const startYear = m >= fyStartMonth ? y : y - 1;
    from = `${startYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
  }
  if (report === "balance_sheet") return { from, to };
  if (from > to) throw new Error('"from" must be on or before "to".');
  return { from, to };
}

export const ledgerTools: Record<string, ToolDef> = {
  get_financial_statement: {
    description:
      "Financial statements from the general ledger (總帳), computed on the fly from transactions and invoices: balance_sheet 資產負債表 (as of `to`/`as_of`), income_statement 綜合損益表, cash_flow 現金流量表 (indirect method), equity_changes 權益變動表, trial_balance 試算表 — for the 政府帳 (government, default) or 管理帳 (management) ledger. Period defaults to the start of the fiscal year through today. Optional compare_from / compare_to adds a comparison column (balance sheet compares as of compare_to). Also returns the ledger checks (entries balance, assets = liabilities + equity, bank reconciliation, employee sub-ledger, open receivables); see list_ledger_review_items for data problems behind a warning.",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "string", enum: [...REPORTS] },
        ...LEDGER_ARG,
        from: { type: "string", description: "YYYY-MM-DD. Defaults to the start of the fiscal year containing `to`." },
        to: { type: "string", description: "YYYY-MM-DD, inclusive. Defaults to today (Asia/Taipei)." },
        as_of: { type: "string", description: "Alias of `to` (natural for balance_sheet)." },
        compare_from: { type: "string", description: "YYYY-MM-DD; with compare_to, adds a comparison column." },
        compare_to: { type: "string", description: "YYYY-MM-DD." },
        ...ORG_ARG,
      },
      required: ["report"],
      additionalProperties: false,
    },
    outputSchema: STATEMENT_RESULT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const report = optString(args, "report") as Report | undefined;
      if (!report || !REPORTS.includes(report)) throw new Error(`"report" must be one of: ${REPORTS.join(", ")}.`);
      const ledger = ledgerArg(args);
      const inputs = await loadLedgerInputs(orgId);
      const period = resolvePeriod(report, args, todayInTaipei(), inputs.settings.fiscalYearStartMonth);
      const compareTo = optDate(args, "compare_to");
      const compareFrom = optDate(args, "compare_from");
      let comparePeriod: Period | null = null;
      if (compareTo) {
        comparePeriod = { from: compareFrom ?? compareTo, to: compareTo };
        if (report !== "balance_sheet" && !compareFrom) throw new Error('"compare_from" is required with "compare_to".');
      }

      let rows: Record<string, unknown>[];
      if (report === "trial_balance") {
        rows = trialBalance(inputs, ledger, period);
      } else if (report === "equity_changes") {
        rows = equityChanges(inputs, ledger, period).map((r) => ({ ...r, name: tStatements(`labels.equity.${r.key}`) }));
      } else {
        let statement;
        if (report === "balance_sheet") statement = balanceSheet(inputs, ledger, period.to, comparePeriod?.to ?? null);
        else if (report === "income_statement") statement = incomeStatement(inputs, ledger, period, comparePeriod);
        else statement = cashFlowStatement(inputs, ledger, period, comparePeriod);
        rows = statement.rows.map((r) => ({
          key: r.key,
          kind: r.kind,
          name: rowLabel(tStatements, r),
          code: r.code,
          glAccountId: r.glAccountId,
          level: r.level,
          amount: r.amount,
          compareAmount: r.compareAmount,
        }));
      }
      return {
        report,
        ledger,
        currency: inputs.settings.functionalCurrency,
        period,
        comparePeriod: report === "trial_balance" || report === "equity_changes" ? null : comparePeriod,
        rows,
        checks: runChecks(inputs, ledger, period.to),
      };
    },
  },

  list_ledger_review_items: {
    description:
      "Data problems the general ledger found (待處理), as of a date (default today): uncategorized transactions, foreign-currency rows without a TWD amount or rate (not posted), estimated FX rates, issued invoices with no linked payment, receivables not fully settled, entries the government ledger posted via 股東往來, default account mappings, opening balances, one-sided currency exchanges. Each item has severity (error / warning / info), which ledger it affects, and the source (transaction / invoice / …) with its id so it can be fixed with the transaction or invoice tools.",
    inputSchema: {
      type: "object",
      properties: {
        as_of: { type: "string", description: "YYYY-MM-DD. Defaults to today (Asia/Taipei)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string" },
        items: { type: "array", items: REVIEW_ROW },
        count: { type: "number" },
        byCode: { type: "object", description: "code → number of items." },
      },
      required: ["asOf", "items", "count", "byCode"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const asOf = optDate(args, "as_of") ?? todayInTaipei();
      const inputs = await loadLedgerInputs(orgId);
      const items = reviewItems(inputs, asOf).map((r) => {
        const key = `review.codes.${r.code}.title`;
        return {
          code: r.code,
          title: tStatements.has(key) ? tStatements(key) : r.code,
          severity: r.severity,
          ledger: r.ledger,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          date: r.date,
          amount: r.amount,
          params: r.params,
        };
      });
      const byCode: Record<string, number> = {};
      for (const i of items) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
      return { asOf, items, count: items.length, byCode };
    },
  },

  get_vat_report: {
    description:
      "營業稅 (VAT) report for one calendar year from the general ledger: one row per filing period (bi-monthly for 一般營業人 / Form 401, quarterly for 小規模營業人), with invoice-side sales (taxable / zero-rated / exempt), output and input VAT, the ledger-side revenue and VAT, the tax due, and the difference between invoiced sales and ledger revenue (anything over NT$1 deserves a look). `regime` comes from the organization's accounting settings.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Calendar year, e.g. 2026." },
        ...ORG_ARG,
      },
      required: ["year"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        regime: { type: "string", enum: ["general", "small_scale", "none"] },
        currency: { type: "string" },
        items: { type: "array", items: VAT_ROW },
        count: { type: "number" },
      },
      required: ["year", "regime", "currency", "items", "count"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const year = requireNumber(args, "year");
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('"year" must be a year between 2000 and 2100.');
      const inputs = await loadLedgerInputs(orgId);
      const items = inputs.settings.vatRegime === "none" ? [] : vatReport(inputs, year);
      return {
        year,
        regime: inputs.settings.vatRegime,
        currency: inputs.settings.functionalCurrency,
        items,
        count: items.length,
      };
    },
  },
  create_journal_entry: {
    description:
      "Write a manual journal entry (傳票) into the general ledger: accruals such as unpaid salary (借 6111 薪資支出 / 貸 2191 應付薪資), reversals when the accrual is paid, opening balances or year-end adjustments. Lines name accounts by `accountCode` (the chart-of-accounts code, e.g. \"6111\") or `glAccountId`; each line has either a debit or a credit, at least two lines, and total debits must equal total credits. `ledger`: both (default) = 政府帳 and 管理帳, government = 政府帳 only, management = 管理帳 only. Bookkeeping only — no money moves. Rejected when the date falls in a closed accounting period. Confirm the lines with the user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Entry date, YYYY-MM-DD." },
        ledger: { type: "string", enum: [...ENTRY_LEDGERS], description: "Default both." },
        kind: { type: "string", enum: [...ENTRY_KINDS], description: "manual (default), opening or adjustment." },
        memo: { type: "string" },
        lines: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            properties: {
              accountCode: { type: "string", description: "Chart-of-accounts code, e.g. 6111." },
              glAccountId: { type: "number", description: "Alternative to accountCode." },
              debit: { type: "number" },
              credit: { type: "number" },
              memo: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        ...ORG_ARG,
      },
      required: ["date", "lines"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        ledger: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { code: { type: "string" }, name: { type: "string" }, debit: { type: "number" }, credit: { type: "number" } },
            required: ["code", "name", "debit", "credit"],
            additionalProperties: false,
          },
        },
      },
      required: ["id", "date", "ledger", "lines"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const rawLines = Array.isArray(args.lines) ? (args.lines as Record<string, unknown>[]) : [];
      const db = getDb();
      const accounts = await db
        .select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name })
        .from(glAccounts)
        .where(eq(glAccounts.organizationId, orgId));
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const lines: JournalLineInput[] = rawLines.map((l, i) => {
        const code = typeof l.accountCode === "string" ? l.accountCode.trim() : "";
        const acct = code ? byCode.get(code) : byId.get(Number(l.glAccountId));
        if (!acct) throw new Error(`Line ${i + 1}: unknown account ${code || String(l.glAccountId ?? "")} in this organization's chart of accounts.`);
        return {
          glAccountId: acct.id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: typeof l.memo === "string" ? l.memo : null,
        };
      });
      const ledger = (optString(args, "ledger") ?? "both") as (typeof ENTRY_LEDGERS)[number];
      const kind = (optString(args, "kind") ?? "manual") as (typeof ENTRY_KINDS)[number];
      const date = optDate(args, "date") ?? "";
      const [actor] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, ctx.userId)).limit(1);
      const res = await insertJournalEntry(orgId, actor?.name || actor?.email || "MCP", {
        date,
        ledger,
        kind,
        memo: optString(args, "memo") ?? null,
        lines,
      });
      if (!res.ok) throw new Error(JOURNAL_ERRORS[res.reason]);
      return {
        id: res.id,
        date,
        ledger,
        lines: lines.map((l) => {
          const a = byId.get(l.glAccountId)!;
          return { code: a.code, name: a.name, debit: l.debit, credit: l.credit };
        }),
      };
    },
  },
};

const JOURNAL_ERRORS: Record<JournalEntryError, string> = {
  invalidDate: '"date" must be a valid YYYY-MM-DD date.',
  invalid: '"ledger" or "kind" is not one of the allowed values.',
  linesMin: "A journal entry needs at least two lines.",
  lineAccount: "Every line needs an account from this organization's chart of accounts.",
  lineOneSide: "Each line must have either a debit or a credit (positive), not both.",
  unbalanced: "Total debits must equal total credits.",
};
