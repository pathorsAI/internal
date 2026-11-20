import type { Dictionary } from "./dictionary";

const advances = {
  title: { "zh-TW": "代墊／應付未還", en: "Advances & payables" },
  description: {
    "zh-TW": "員工或其他公司先替我們付、還沒還的費用",
    en: "Expenses an employee or another company paid on our behalf that we haven't repaid yet",
  },
  tooltipAria: { "zh-TW": "代墊說明", en: "About advances" },
  tooltipContent: {
    "zh-TW": "代墊已納入帳務（進項），還沒撥款還給代墊人。代墊人可以是員工，也可以是公司（例如關係企業先替我們付）。",
    en: "The advance is already booked (as an input) and hasn't been repaid yet. The payer can be an employee or a company (e.g. an affiliate that paid first).",
  },
  byPayee: {
    title: { "zh-TW": "依代墊人加總", en: "Totals by payer" },
    count: { "zh-TW": "筆數", en: "Entries" },
    unassigned: { "zh-TW": "（未填代墊人）", en: "(No payer)" },
  },
  companyBadge: { "zh-TW": "公司", en: "Company" },
  card: {
    totalLabel: { "zh-TW": "目前未還總額", en: "Total outstanding" },
  },
  columns: {
    date: { "zh-TW": "日期", en: "Date" },
    payer: { "zh-TW": "代墊人", en: "Payer" },
    vendorPurpose: { "zh-TW": "廠商 / 用途", en: "Vendor / purpose" },
    category: { "zh-TW": "分類", en: "Category" },
    amount: { "zh-TW": "金額", en: "Amount" },
    action: { "zh-TW": "動作", en: "Action" },
  },
  empty: { "zh-TW": "沒有未還的代墊", en: "No outstanding advances" },
  defaultPayer: { "zh-TW": "代墊人", en: "Payer" },
  recordButton: { "zh-TW": "記錄撥款", en: "Record reimbursement" },
  accountOption: { "zh-TW": "{name}（{currency}）", en: "{name} ({currency})" },
  dialog: {
    title: { "zh-TW": "記錄撥款", en: "Record reimbursement" },
    description: { "zh-TW": "還給 {settleName}（原費用：{vendorName}）", en: "Repay {settleName} (original expense: {vendorName})" },
    payDate: { "zh-TW": "撥款日期", en: "Payment date" },
    fromAccount: { "zh-TW": "付款帳戶", en: "Payment account" },
    fromAccountPlaceholder: { "zh-TW": "— 選擇帳戶 —", en: "— Select account —" },
    fromAccountHint: {
      "zh-TW": "撥款幣別跟著代墊走，只能選 {currency} 帳戶",
      en: "The reimbursement follows the advance's currency, so only {currency} accounts can be used",
    },
    noMatchingAccount: {
      "zh-TW": "目前沒有 {currency} 帳戶，請先到「銀行帳戶」建立一個。",
      en: "There is no {currency} account yet — create one on the Bank accounts page first.",
    },
    toAccount: { "zh-TW": "匯入帳戶", en: "Paid into" },
    toAccountNone: { "zh-TW": "不記錄", en: "Don't record" },
    amountLabel: { "zh-TW": "金額（依代墊，不可改）", en: "Amount (fixed by the advance, can't change)" },
    confirm: { "zh-TW": "確認撥款", en: "Confirm reimbursement" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
  },
  toast: {
    recorded: { "zh-TW": "已記錄撥款", en: "Reimbursement recorded" },
  },
} satisfies Dictionary;

export default advances;
