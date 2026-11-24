import { describe, expect, test } from "bun:test";
import {
  addDaysYmd,
  assignTransactions,
  buildRecap,
  chargeDatesInMonth,
  currentPeriodWindow,
  isBankFee,
  nextChargeDate,
  periodStatuses,
  previousPeriod,
  renderRecapMessages,
  renderReminderMessages,
  splitMessages,
  sumByCurrency,
  toRecurringExpense,
  type LedgerTransaction,
  type RecurringExpense,
} from "./recurring-expenses";

const BANK_A = { id: 10, name: "公司戶 - A 銀行（台幣）" };
const WISE = { id: 20, name: "Wise - USD" };

// 付款方式（payment_methods）：卡費最後從哪個帳本帳戶扣。
const CARD_A = {
  paymentMethodId: 31,
  paymentMethodLabel: "MasterCard •5678",
  paymentMethodLast4: "5678",
  expectedAccountId: BANK_A.id,
  expectedAccountName: BANK_A.name,
};
const WISE_CARD = {
  paymentMethodId: 32,
  paymentMethodLabel: "Wise 卡 •1234",
  paymentMethodLast4: "1234",
  expectedAccountId: WISE.id,
  expectedAccountName: WISE.name,
};

function expense(
  partial: Partial<RecurringExpense> & Pick<RecurringExpense, "id" | "name">,
): RecurringExpense {
  return {
    schedule: "usage",
    partyIds: [],
    paymentMethodId: null,
    paymentMethodLabel: null,
    paymentMethodLast4: null,
    expectedAccountId: null,
    expectedAccountName: null,
    expectedAmount: null,
    currency: null,
    billingUrl: null,
    ...partial,
  } as RecurringExpense;
}

function txn(
  partial: Partial<LedgerTransaction> & Pick<LedgerTransaction, "id" | "amount">,
): LedgerTransaction {
  return {
    txnDate: "2026-09-10",
    type: "expense",
    currency: "TWD",
    fromAccountId: BANK_A.id,
    fromAccountName: BANK_A.name,
    cardLast4: null,
    partyId: null,
    partyName: null,
    description: null,
    settleEmployeeName: null,
    vendorBillingAccountId: null,
    invoiceAccountIds: [],
    ...partial,
  };
}

describe("nextChargeDate / chargeDatesInMonth", () => {
  const monthEnd = { schedule: "fixed", anchorDate: "2026-01-31", intervalMonths: 1 } as const;

  test("clamps the anchor day to the end of shorter months, per month", () => {
    expect(nextChargeDate(monthEnd, "2026-02-01")).toBe("2026-02-28");
    expect(nextChargeDate(monthEnd, "2026-03-01")).toBe("2026-03-31");
    expect(nextChargeDate(monthEnd, "2028-02-01")).toBe("2028-02-29");
  });

  test("a charge date itself counts as on-or-after", () => {
    expect(nextChargeDate(monthEnd, "2026-02-28")).toBe("2026-02-28");
    expect(nextChargeDate(monthEnd, "2026-03-01")).toBe("2026-03-31");
  });

  test("interval_months = 12 charges once a year", () => {
    const yearly = { schedule: "fixed", anchorDate: "2025-03-10", intervalMonths: 12 } as const;
    expect(nextChargeDate(yearly, "2026-01-01")).toBe("2026-03-10");
    expect(nextChargeDate(yearly, "2026-03-11")).toBe("2027-03-10");
    expect(chargeDatesInMonth(yearly, "2026-03")).toEqual(["2026-03-10"]);
    expect(chargeDatesInMonth(yearly, "2026-04")).toEqual([]);
  });

  test("an anchor in the future is the first charge; nothing before it", () => {
    const future = { schedule: "fixed", anchorDate: "2026-11-01", intervalMonths: 1 } as const;
    expect(nextChargeDate(future, "2026-09-01")).toBe("2026-11-01");
    expect(chargeDatesInMonth(future, "2026-09")).toEqual([]);
    expect(chargeDatesInMonth(future, "2026-12")).toEqual(["2026-12-01"]);
  });

  test("usage-based expenses have no charge date", () => {
    expect(nextChargeDate({ schedule: "usage" }, "2026-10-12")).toBeNull();
    expect(chargeDatesInMonth({ schedule: "usage" }, "2026-10")).toEqual([]);
  });

  test("calendar helpers", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-10")).toBe("2026-09");
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
  });
});

// 對象（parties）id
const P = { openai: 1001, gcp: 1002, neon: 1003, anthropic: 1004, livekit: 1005, github: 1006, digitalocean: 1007, bankA: 2001, family: 2002 };

describe("assignTransactions", () => {
  const openai = expense({ id: 1, name: "OpenAI", partyIds: [P.openai] });
  const gcp = expense({ id: 2, name: "Google Cloud", partyIds: [P.gcp] });

  test("vendor_billing_account_id wins over the party", () => {
    const row = txn({ id: 1, amount: 1, partyId: P.openai, vendorBillingAccountId: 2 });
    expect([...assignTransactions([openai, gcp], [row]).keys()]).toEqual([2]);
  });

  test("a row linked to an account outside the list is not guessed by party", () => {
    const row = txn({ id: 1, amount: 1, partyId: P.openai, vendorBillingAccountId: 99 });
    expect(assignTransactions([openai, gcp], [row]).size).toBe(0);
  });

  test("a row an account's cloud invoice is matched to belongs to that account", () => {
    const row = txn({ id: 1, amount: 1, partyId: P.bankA, invoiceAccountIds: [7, 2] });
    expect([...assignTransactions([openai, gcp], [row]).keys()]).toEqual([2]);
  });

  test("falls back to the party only when exactly one account has it; never by name", () => {
    const shared = expense({ id: 3, name: "OpenAI (team)", partyIds: [P.openai] });
    const byParty = txn({ id: 1, amount: 1, partyId: P.gcp });
    const ambiguous = txn({ id: 2, amount: 1, partyId: P.openai });
    const byNameOnly = txn({ id: 3, amount: 1, partyName: "OpenAI", description: "OPENAI" });
    const out = assignTransactions([openai, gcp, shared], [byParty, ambiguous, byNameOnly]);
    expect([...out.entries()].map(([k, v]) => [k, v.map((t) => t.id)])).toEqual([[2, [1]]]);
  });
});

describe("isBankFee", () => {
  const openai = expense({ id: 1, name: "OpenAI", partyIds: [P.openai] });

  test("a bank row with a fee description is a fee", () => {
    expect(isBankFee(openai, { partyId: P.bankA, description: "OPENAI 國外交易服務費" })).toBe(true);
    expect(isBankFee(openai, { partyId: null, description: "OPENAI 手續費" })).toBe(true);
  });

  test("the vendor's own row is a charge even when its description mentions a fee", () => {
    expect(isBankFee(openai, { partyId: P.openai, description: "OpenAI 服務費" })).toBe(false);
  });

  test("a bank row without a fee keyword is a charge", () => {
    expect(isBankFee(openai, { partyId: P.bankA, description: "OPENAI 扣款" })).toBe(false);
  });
});

test("toRecurringExpense: an account without a schedule is not a recurring expense", () => {
  const base = {
    id: 1,
    name: "x",
    partyIds: [],
    paymentMethodId: null,
    paymentMethodLabel: null,
    paymentMethodLast4: null,
    expectedAccountId: null,
    expectedAccountName: null,
    anchorDate: null,
    intervalMonths: 1,
    expectedAmount: "12.50",
    currency: "USD",
    billingUrl: null,
  };
  expect(toRecurringExpense({ ...base, schedule: null })).toBeNull();
  expect(toRecurringExpense({ ...base, schedule: "fixed" })?.schedule).toBe("usage");
  expect(toRecurringExpense({ ...base, schedule: "usage" })?.expectedAmount).toBe(12.5);
});

describe("currentPeriodWindow / periodStatuses", () => {
  const monthly = expense({
    id: 1,
    name: "Neon",
    partyIds: [P.neon],
    schedule: "fixed",
    anchorDate: "2026-01-15",
    intervalMonths: 1,
  });
  const usage = expense({ id: 2, name: "OpenAI", partyIds: [P.openai] });
  const future = expense({ id: 3, name: "LiveKit", schedule: "fixed", anchorDate: "2026-12-01", intervalMonths: 1 });
  const yearly = expense({ id: 4, name: "Domain", schedule: "fixed", anchorDate: "2025-03-10", intervalMonths: 12 });

  test("fixed: from the last charge date minus the grace days to the next one minus the grace days", () => {
    expect(currentPeriodWindow(monthly, "2026-10-20")).toEqual({
      start: "2026-10-08",
      endExclusive: "2026-11-08",
      chargeDate: "2026-10-15",
      nextChargeDate: "2026-11-15",
    });
    expect(currentPeriodWindow(monthly, "2026-10-15")?.chargeDate).toBe("2026-10-15");
    expect(currentPeriodWindow(monthly, "2026-10-14")?.chargeDate).toBe("2026-09-15");
    expect(currentPeriodWindow(yearly, "2026-11-25")).toMatchObject({ chargeDate: "2026-03-10", nextChargeDate: "2027-03-10" });
  });

  test("usage: the calendar month; fixed before the first charge: none", () => {
    expect(currentPeriodWindow(usage, "2026-10-20")).toEqual({
      start: "2026-10-01",
      endExclusive: "2026-11-01",
      chargeDate: null,
      nextChargeDate: null,
    });
    expect(currentPeriodWindow(future, "2026-10-20")).toBeNull();
  });

  test("paid via a linked transaction, via a matched invoice, unpaid, upcoming", () => {
    const rows = [
      txn({ id: 10, amount: 1, txnDate: "2026-10-12", vendorBillingAccountId: 1 }),
      txn({ id: 11, amount: 1, txnDate: "2026-10-02", vendorBillingAccountId: 1 }), // 上一期
    ];
    const statuses = periodStatuses([monthly, usage, future, yearly], "2026-10-20", rows, [
      { billingAccountId: 4, invoiceDate: "2026-03-09", transactionId: 77 },
    ]);
    expect(statuses.get(1)).toMatchObject({ state: "paid", via: "transaction", transactionIds: [10], nextChargeDate: "2026-11-15" });
    expect(statuses.get(2)).toMatchObject({ state: "unpaid", via: null, windowStart: "2026-10-01" });
    expect(statuses.get(3)).toMatchObject({ state: "upcoming", nextChargeDate: "2026-12-01" });
    expect(statuses.get(4)).toMatchObject({ state: "paid", via: "invoice", transactionIds: [77] });
  });
});

test("sumByCurrency puts TWD first, then currency codes alphabetically", () => {
  expect(
    sumByCurrency([
      { currency: "USD", amount: 0.1 },
      { currency: "EUR", amount: 3 },
      { currency: "TWD", amount: 2 },
      { currency: "USD", amount: 0.2 },
    ]),
  ).toEqual([
    { currency: "TWD", amount: 2 },
    { currency: "EUR", amount: 3 },
    { currency: "USD", amount: 0.3 },
  ]);
});

// 帳本裡的樣態：Wise 的卡片交易（兩張卡）、A 銀行的 OpenAI 扣款 + 國外交易服務費（人連到 OpenAI 帳戶）、
// 只有手續費列的 GitHub、員工代墊的緊急儲值、設定用 Wise 卡卻從 A 銀行扣的 Anthropic。
const expenses: RecurringExpense[] = [
  expense({ id: 1, name: "OpenAI", partyIds: [P.openai], ...CARD_A }),
  expense({
    id: 2,
    name: "Google Cloud",
    partyIds: [P.gcp],
    ...WISE_CARD,
    schedule: "fixed",
    anchorDate: "2026-01-15",
    intervalMonths: 1,
  }),
  expense({ id: 3, name: "Neon", partyIds: [P.neon], ...WISE_CARD, schedule: "fixed", anchorDate: "2026-01-05", intervalMonths: 1 }),
  expense({ id: 4, name: "Anthropic", partyIds: [P.anthropic], ...WISE_CARD, schedule: "fixed", anchorDate: "2026-01-20", intervalMonths: 1 }),
  expense({ id: 5, name: "LiveKit", partyIds: [P.livekit], schedule: "fixed", anchorDate: "2026-11-01", intervalMonths: 1 }),
  expense({ id: 6, name: "GitHub", partyIds: [P.github], ...CARD_A }),
  expense({ id: 7, name: "DigitalOcean", partyIds: [P.digitalocean], ...WISE_CARD }),
];

const wiseCard = (cardLast4: string) =>
  ({ currency: "USD", fromAccountId: WISE.id, fromAccountName: WISE.name, cardLast4 }) as const;

const september: LedgerTransaction[] = [
  txn({ id: 101, amount: 1000, partyId: P.openai, partyName: "OpenAI", description: "OPENAI" }),
  txn({ id: 102, amount: 15, partyId: P.bankA, partyName: "A 銀行", description: "OPENAI 國外交易服務費", vendorBillingAccountId: 1 }),
  txn({ id: 103, amount: 36.9, ...wiseCard("1234"), partyId: P.gcp, partyName: "Google*Cloud Abc123", vendorBillingAccountId: 2 }),
  txn({
    id: 104,
    amount: 1200,
    type: "advance",
    fromAccountId: null,
    fromAccountName: null,
    partyId: P.openai,
    partyName: "OpenAI",
    description: "openai 緊急儲值",
    settleEmployeeName: "王小明",
  }),
  txn({ id: 105, amount: 3000, partyId: P.anthropic, partyName: "Anthropic", description: "ANTHROPIC" }),
  txn({ id: 106, amount: 200, partyId: P.family, partyName: "全家", description: "文具" }),
  txn({ id: 107, amount: 30, partyId: P.bankA, partyName: "A 銀行", description: "GITHUB 國外交易手續費", vendorBillingAccountId: 6 }),
  txn({ id: 108, amount: 48, ...wiseCard("9012"), partyId: P.digitalocean, partyName: "DigitalOcean.com", invoiceAccountIds: [7] }),
];

const recap = buildRecap({
  period: "2026-09",
  expenses,
  transactions: september,
  outstandingAdvances: [
    { employeeName: "王小明", txnDate: "2026-09-12", amount: 1200, currency: "TWD" },
    { employeeName: "李小華", txnDate: "2026-09-20", amount: 570, currency: "TWD" },
    { employeeName: "王小明", txnDate: "2026-01-10", amount: 1500, currency: "TWD" },
    { employeeName: "李小華", txnDate: "2026-05-03", amount: 800, currency: "TWD" },
    { employeeName: "王小明", txnDate: "2026-10-02", amount: 300, currency: "TWD" },
  ],
  needsReviewCount: 12,
});

describe("buildRecap", () => {
  // A 銀行那組的交易沒有卡號：末四碼退回付款方式，但只算設定從 A 銀行扣的卡
  // （OpenAI、GitHub 的 •5678）；Anthropic 設定的是 Wise 卡，不算進來。
  test("groups by the paying account, splits bank fees out of the count, sorts lines by amount", () => {
    expect(recap.groups.map(({ label, last4s, subtotals, lines }) => ({ label, last4s, subtotals, lines }))).toEqual([
      {
        label: "Wise - USD",
        last4s: ["1234", "9012"],
        subtotals: [{ currency: "USD", amount: 84.9 }],
        lines: [
          { expenseId: 7, name: "DigitalOcean", transactionIds: [108], count: 1, feeCount: 0, totals: [{ currency: "USD", amount: 48 }], fees: [] },
          { expenseId: 2, name: "Google Cloud", transactionIds: [103], count: 1, feeCount: 0, totals: [{ currency: "USD", amount: 36.9 }], fees: [] },
        ],
      },
      {
        label: "公司戶 - A 銀行（台幣）",
        last4s: ["5678"],
        subtotals: [{ currency: "TWD", amount: 4045 }],
        lines: [
          { expenseId: 4, name: "Anthropic", transactionIds: [105], count: 1, feeCount: 0, totals: [{ currency: "TWD", amount: 3000 }], fees: [] },
          {
            expenseId: 1,
            name: "OpenAI",
            transactionIds: [101, 102],
            count: 1,
            feeCount: 1,
            totals: [{ currency: "TWD", amount: 1015 }],
            fees: [{ currency: "TWD", amount: 15 }],
          },
          {
            expenseId: 6,
            name: "GitHub",
            transactionIds: [107],
            count: 0,
            feeCount: 1,
            totals: [{ currency: "TWD", amount: 30 }],
            fees: [{ currency: "TWD", amount: 30 }],
          },
        ],
      },
      {
        label: "員工代墊 - 王小明",
        last4s: [],
        subtotals: [{ currency: "TWD", amount: 1200 }],
        lines: [{ expenseId: 1, name: "OpenAI", transactionIds: [104], count: 1, feeCount: 0, totals: [{ currency: "TWD", amount: 1200 }], fees: [] }],
      },
    ]);
    expect(recap.grandTotals).toEqual([
      { currency: "TWD", amount: 5245 },
      { currency: "USD", amount: 84.9 },
    ]);
  });

  test("an account group shows no number when no card data and no payment method settles from it", () => {
    const fromWise = txn({ id: 1, amount: 10, partyId: P.openai, fromAccountId: WISE.id, fromAccountName: WISE.name });
    const noMethod = txn({ id: 2, amount: 10, partyId: P.livekit });
    const model = buildRecap({
      period: "2026-09",
      expenses,
      transactions: [fromWise, noMethod],
      outstandingAdvances: [],
      needsReviewCount: 0,
    });
    expect(model.groups.map((g) => [g.label, g.last4s])).toEqual([
      ["Wise - USD", []],
      ["公司戶 - A 銀行（台幣）", []],
    ]);
  });

  test("a payment method without a settling account never flags a mismatch", () => {
    const loose = expense({ id: 1, name: "OpenAI", partyIds: [P.openai], paymentMethodId: 33, paymentMethodLabel: "Visa •9012", paymentMethodLast4: "9012" });
    const row = txn({ id: 1, amount: 10, partyId: P.openai, fromAccountId: WISE.id, fromAccountName: WISE.name });
    const model = buildRecap({ period: "2026-09", expenses: [loose], transactions: [row], outstandingAdvances: [], needsReviewCount: 0 });
    expect(model.accountMismatch).toEqual([]);
    expect(model.groups.map((g) => g.last4s)).toEqual([[]]);
  });

  test("flags a fixed charge with no matching row, but not usage or not-yet-started ones", () => {
    expect(recap.missing).toEqual([{ expenseId: 3, name: "Neon", chargeDates: ["2026-09-05"] }]);
  });

  test("a cloud invoice of the account matched in the month counts as paid", () => {
    const model = buildRecap({
      period: "2026-09",
      expenses,
      transactions: september,
      matchedInvoices: [
        { billingAccountId: 3, invoiceDate: "2026-09-01", transactionId: 555 },
        { billingAccountId: 5, invoiceDate: "2026-08-31", transactionId: 556 },
      ],
      outstandingAdvances: [],
      needsReviewCount: 0,
    });
    expect(model.missing).toEqual([]);
  });

  test("flags rows paid from somewhere other than the configured account", () => {
    expect(recap.accountMismatch).toEqual([
      { expenseId: 1, name: "OpenAI", expectedAccountName: "公司戶 - A 銀行（台幣）", actualPayers: ["員工代墊 - 王小明"] },
      { expenseId: 4, name: "Anthropic", expectedAccountName: "Wise - USD", actualPayers: ["公司戶 - A 銀行（台幣）"] },
    ]);
  });

  test("splits outstanding advances into this period per employee and one older total; later ones are left out", () => {
    expect(recap.newAdvances).toEqual([
      { employeeName: "王小明", totals: [{ currency: "TWD", amount: 1200 }] },
      { employeeName: "李小華", totals: [{ currency: "TWD", amount: 570 }] },
    ]);
    expect(recap.olderAdvances).toEqual({ count: 2, totals: [{ currency: "TWD", amount: 2300 }] });
    expect(recap.needsReviewCount).toBe(12);
  });
});

describe("renderRecapMessages", () => {
  const APP = "https://internal.pathors.com";

  test("renders the recap as one Discord message with masked links", () => {
    expect(renderRecapMessages(recap, { mentionRoleId: "999", appUrl: APP })).toEqual([
      [
        "## 📒 2026-09 固定支出回顧",
        "**合計** NT$5,245 + US$84.90 <@&999>",
        `### 💳 [Wise - USD ••••1234 / ••••9012](<${APP}/dashboard/transactions?account=20&period=2026-09>)`,
        "-# 小計 US$84.90",
        `- [DigitalOcean](<${APP}/dashboard/transactions?ids=108>)　US$48.00 · 1 筆`,
        `- [Google Cloud](<${APP}/dashboard/transactions?ids=103>)　US$36.90 · 1 筆`,
        `### 💳 [公司戶 - A 銀行（台幣） ••••5678](<${APP}/dashboard/transactions?account=10&period=2026-09>)`,
        "-# 小計 NT$4,045",
        `- [Anthropic](<${APP}/dashboard/transactions?ids=105>)　NT$3,000 · 1 筆`,
        `- [OpenAI](<${APP}/dashboard/transactions?ids=101,102>)　NT$1,015 · 1 筆（含手續費 NT$15）`,
        `- [GitHub](<${APP}/dashboard/transactions?ids=107>)　NT$30 · 手續費 1 筆`,
        "### 👤 員工代墊 - 王小明",
        "-# 小計 NT$1,200",
        `- [OpenAI](<${APP}/dashboard/transactions?ids=104>)　NT$1,200 · 1 筆`,
        "### ⚠️ 需要注意",
        "- **Neon** 預期 9/05 扣款，帳上沒看到",
        "- **OpenAI** 設定從 公司戶 - A 銀行（台幣） 扣，實際 員工代墊 - 王小明",
        "- **Anthropic** 設定從 Wise - USD 扣，實際 公司戶 - A 銀行（台幣）",
        "### 🧾 代墊待報帳",
        "- 本月新增：王小明 NT$1,200、李小華 NT$570",
        `- [更早未報帳 共 NT$2,300（2 筆）](<${APP}/dashboard/advances>)`,
        `[🔍 待確認的匯入交易 12 筆](<${APP}/dashboard/transactions?review=1>)`,
      ].join("\n"),
    ]);
  });

  test("without appUrl or a role, renders plain text and no mention", () => {
    expect(renderRecapMessages(recap, { mentionRoleId: null })).toEqual([
      [
        "## 📒 2026-09 固定支出回顧",
        "**合計** NT$5,245 + US$84.90",
        "### 💳 Wise - USD ••••1234 / ••••9012",
        "-# 小計 US$84.90",
        "- DigitalOcean　US$48.00 · 1 筆",
        "- Google Cloud　US$36.90 · 1 筆",
        "### 💳 公司戶 - A 銀行（台幣） ••••5678",
        "-# 小計 NT$4,045",
        "- Anthropic　NT$3,000 · 1 筆",
        "- OpenAI　NT$1,015 · 1 筆（含手續費 NT$15）",
        "- GitHub　NT$30 · 手續費 1 筆",
        "### 👤 員工代墊 - 王小明",
        "-# 小計 NT$1,200",
        "- OpenAI　NT$1,200 · 1 筆",
        "### ⚠️ 需要注意",
        "- **Neon** 預期 9/05 扣款，帳上沒看到",
        "- **OpenAI** 設定從 公司戶 - A 銀行（台幣） 扣，實際 員工代墊 - 王小明",
        "- **Anthropic** 設定從 Wise - USD 扣，實際 公司戶 - A 銀行（台幣）",
        "### 🧾 代墊待報帳",
        "- 本月新增：王小明 NT$1,200、李小華 NT$570",
        "- 更早未報帳 共 NT$2,300（2 筆）",
        "🔍 待確認的匯入交易 12 筆",
      ].join("\n"),
    ]);
  });

  test("a month with nothing matched omits every empty section", () => {
    const empty = buildRecap({ period: "2026-09", expenses: [], transactions: [], outstandingAdvances: [], needsReviewCount: 0 });
    expect(renderRecapMessages(empty, { mentionRoleId: "999", appUrl: APP })).toEqual([
      "## 📒 2026-09 固定支出回顧\n這個月沒有對到任何固定支出的交易。 <@&999>",
    ]);
  });

  test("splits long recaps on line boundaries without orphaning a header; only the first message mentions the role", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      expense({ id: i + 1, name: `Vendor ${i + 1} with a fairly long display name`, partyIds: [5000 + i] }),
    );
    const rows = many.map((e, i) =>
      txn({ id: 1000 + i, amount: 100, fromAccountId: 1 + (i % 3), fromAccountName: `Account ${1 + (i % 3)}`, partyId: 5000 + i }),
    );
    const model = buildRecap({ period: "2026-09", expenses: many, transactions: rows, outstandingAdvances: [], needsReviewCount: 0 });
    const messages = renderRecapMessages(model, { mentionRoleId: "999", appUrl: APP });

    expect(messages.length).toBe(4);
    expect(messages.every((m) => m.length <= 2000)).toBe(true);
    expect(messages.map((m) => m.includes("<@&999>"))).toEqual([true, false, false, false]);
    expect(messages.map((m) => /^(#|-# )/.test(m.split("\n").at(-1)!))).toEqual([false, false, false, false]);
    expect(messages.join("\n").split("\n").length).toBe(2 + 3 * 2 + 60);
  });

  test("splitMessages cuts between lines, keeps a header with its next line, hard-splits an overlong block", () => {
    expect(splitMessages(["aaaa", "bbbb", "cc"], 9)).toEqual(["aaaa\nbbbb", "cc"]);
    expect(splitMessages(["aaaa", "## h", "bb"], 9)).toEqual(["aaaa", "## h\nbb"]);
    expect(splitMessages(["xxxxx"], 2)).toEqual(["xx", "xx", "x"]);
  });
});

describe("renderReminderMessages", () => {
  test("one section per charge date, the payment method and its account, last month's total or the estimate, billing link", () => {
    const base = { paymentMethodLabel: null, expectedAccountName: null, lastMonth: [], expected: null, billingUrl: null };
    const messages = renderReminderMessages(
      [
        { ...base, expenseId: 3, name: "Neon", chargeDate: "2026-10-16", expected: { currency: "EUR", amount: 19 } },
        {
          ...base,
          expenseId: 8,
          name: "Vendor X",
          chargeDate: "2026-10-16",
          paymentMethodLabel: "Visa •9012",
          expected: { currency: "SGD", amount: 7 },
        },
        {
          ...base,
          expenseId: 2,
          name: "Google Cloud",
          chargeDate: "2026-10-15",
          paymentMethodLabel: "MasterCard •1234",
          expectedAccountName: BANK_A.name,
          lastMonth: [{ currency: "USD", amount: 1234.5 }],
          expected: { currency: "USD", amount: 30 },
          billingUrl: "https://console.cloud.google.com/billing",
        },
        { ...base, expenseId: 9, name: "Domain", chargeDate: "2026-10-16", lastMonth: [{ currency: "TWD", amount: 12074 }] },
      ],
      { mentionRoleId: "999" },
    );
    expect(messages).toEqual([
      [
        "### ⏰ 10/15（四）扣款提醒",
        "- **Google Cloud** → MasterCard •1234（公司戶 - A 銀行（台幣）） · 上月 US$1,234.50 · [帳單頁](<https://console.cloud.google.com/billing>) <@&999>",
        "### ⏰ 10/16（五）扣款提醒",
        "- **Neon** · 預估 €19.00",
        "- **Vendor X** → Visa •9012 · 預估 SGD 7.00",
        "- **Domain** · 上月 NT$12,074",
      ].join("\n"),
    ]);
  });
});
