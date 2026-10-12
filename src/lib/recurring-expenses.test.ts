import { describe, expect, test } from "bun:test";
import {
  addDaysYmd,
  assignTransactions,
  buildRecap,
  chargeDatesInMonth,
  isBankFee,
  matchesExpense,
  nextChargeDate,
  previousPeriod,
  renderRecapMessages,
  renderReminderMessages,
  splitMessages,
  sumByCurrency,
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
    matchPattern: null,
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
    partyName: null,
    description: null,
    settleEmployeeName: null,
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

describe("matchesExpense", () => {
  test("`*` is literal and matching ignores case, on party name", () => {
    const gcp = expense({ id: 1, name: "Google Cloud", matchPattern: "google*cloud|gcp" });
    expect(matchesExpense(gcp, { partyName: "Google*Cloud Abc123", description: null })).toBe(true);
  });

  test("matches the description too (bank fee rows)", () => {
    const openai = expense({ id: 1, name: "OpenAI", matchPattern: "openai" });
    expect(matchesExpense(openai, { partyName: "A 銀行", description: "OPENAI 國外交易服務費" })).toBe(true);
  });

  test("unrelated rows do not match; empty pattern parts are ignored", () => {
    const neon = expense({ id: 1, name: "Neon", matchPattern: " | |neon" });
    expect(matchesExpense(neon, { partyName: "全家", description: "文具" })).toBe(false);
    expect(matchesExpense(neon, { partyName: "Neon Inc", description: null })).toBe(true);
  });

  test("falls back to the name when there is no usable pattern", () => {
    const livekit = expense({ id: 1, name: "LiveKit", matchPattern: " | " });
    expect(matchesExpense(livekit, { partyName: null, description: "LIVEKIT INC" })).toBe(true);
  });

  test("a row matching two expenses goes to the lower id", () => {
    const cloud = expense({ id: 7, name: "Any cloud", matchPattern: "cloud" });
    const google = expense({ id: 3, name: "Google", matchPattern: "google" });
    const row = txn({ id: 1, amount: 1, partyName: "Google Cloud" });
    expect([...assignTransactions([cloud, google], [row]).keys()]).toEqual([3]);
  });
});

describe("isBankFee", () => {
  const openai = expense({ id: 1, name: "OpenAI", matchPattern: "openai" });

  test("a bank row matched only through a fee description is a fee", () => {
    expect(isBankFee(openai, { partyName: "A 銀行", description: "OPENAI 國外交易服務費" })).toBe(true);
    expect(isBankFee(openai, { partyName: "A 銀行", description: "OPENAI 手續費" })).toBe(true);
  });

  test("the vendor's own row is a charge even when its description mentions a fee", () => {
    expect(isBankFee(openai, { partyName: "OpenAI", description: "OpenAI 服務費" })).toBe(false);
  });

  test("a description match without a fee keyword is a charge", () => {
    expect(isBankFee(openai, { partyName: "A 銀行", description: "OPENAI 扣款" })).toBe(false);
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

// 帳本裡的樣態：Wise 的卡片交易（兩張卡）、A 銀行的 OpenAI 扣款 + 國外交易服務費、
// 只有手續費列的 GitHub、員工代墊的緊急儲值、設定用 Wise 卡卻從 A 銀行扣的 Anthropic。
const expenses: RecurringExpense[] = [
  expense({ id: 1, name: "OpenAI", matchPattern: "openai", ...CARD_A }),
  expense({
    id: 2,
    name: "Google Cloud",
    matchPattern: "google*cloud|gcp",
    ...WISE_CARD,
    schedule: "fixed",
    anchorDate: "2026-01-15",
    intervalMonths: 1,
  }),
  expense({ id: 3, name: "Neon", ...WISE_CARD, schedule: "fixed", anchorDate: "2026-01-05", intervalMonths: 1 }),
  expense({ id: 4, name: "Anthropic", ...WISE_CARD, schedule: "fixed", anchorDate: "2026-01-20", intervalMonths: 1 }),
  expense({ id: 5, name: "LiveKit", schedule: "fixed", anchorDate: "2026-11-01", intervalMonths: 1 }),
  expense({ id: 6, name: "GitHub", ...CARD_A }),
  expense({ id: 7, name: "DigitalOcean", ...WISE_CARD }),
];

const wiseCard = (cardLast4: string) =>
  ({ currency: "USD", fromAccountId: WISE.id, fromAccountName: WISE.name, cardLast4 }) as const;

const september: LedgerTransaction[] = [
  txn({ id: 101, amount: 1000, partyName: "OpenAI", description: "OPENAI" }),
  txn({ id: 102, amount: 15, partyName: "A 銀行", description: "OPENAI 國外交易服務費" }),
  txn({ id: 103, amount: 36.9, ...wiseCard("1234"), partyName: "Google*Cloud Abc123" }),
  txn({
    id: 104,
    amount: 1200,
    type: "advance",
    fromAccountId: null,
    fromAccountName: null,
    partyName: "OpenAI",
    description: "openai 緊急儲值",
    settleEmployeeName: "王小明",
  }),
  txn({ id: 105, amount: 3000, partyName: "Anthropic", description: "ANTHROPIC" }),
  txn({ id: 106, amount: 200, partyName: "全家", description: "文具" }),
  txn({ id: 107, amount: 30, partyName: "A 銀行", description: "GITHUB 國外交易手續費" }),
  txn({ id: 108, amount: 48, ...wiseCard("9012"), partyName: "DigitalOcean.com" }),
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
    const fromWise = txn({ id: 1, amount: 10, partyName: "OpenAI", fromAccountId: WISE.id, fromAccountName: WISE.name });
    const noMethod = txn({ id: 2, amount: 10, partyName: "LiveKit" });
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
    const loose = expense({ id: 1, name: "OpenAI", paymentMethodId: 33, paymentMethodLabel: "Visa •9012", paymentMethodLast4: "9012" });
    const row = txn({ id: 1, amount: 10, partyName: "OpenAI", fromAccountId: WISE.id, fromAccountName: WISE.name });
    const model = buildRecap({ period: "2026-09", expenses: [loose], transactions: [row], outstandingAdvances: [], needsReviewCount: 0 });
    expect(model.accountMismatch).toEqual([]);
    expect(model.groups.map((g) => g.last4s)).toEqual([[]]);
  });

  test("flags a fixed charge with no matching row, but not usage or not-yet-started ones", () => {
    expect(recap.missing).toEqual([{ expenseId: 3, name: "Neon", chargeDates: ["2026-09-05"] }]);
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
      expense({ id: i + 1, name: `Vendor ${i + 1} with a fairly long display name`, matchPattern: `vendor-${i + 1}-` }),
    );
    const rows = many.map((e, i) =>
      txn({ id: 1000 + i, amount: 100, fromAccountId: 1 + (i % 3), fromAccountName: `Account ${1 + (i % 3)}`, partyName: `vendor-${i + 1}-x` }),
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
