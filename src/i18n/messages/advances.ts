import type { Dictionary } from "./dictionary";

const advances = {
  title: { "zh-TW": "代墊", en: "Advances" },
  description: { "zh-TW": "員工先付、公司尚未撥款的費用", en: "Expenses employees paid for before the company reimbursed them" },
  tooltipAria: { "zh-TW": "代墊說明", en: "About advances" },
  tooltipContent: { "zh-TW": "員工已代墊並納入帳務（進項），公司尚未撥款", en: "The employee already paid and it's booked (as an input), the company hasn't reimbursed it yet" },
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
    amountLabel: { "zh-TW": "金額（依代墊，不可改）", en: "Amount (fixed by the advance, can't change)" },
    confirm: { "zh-TW": "確認撥款", en: "Confirm reimbursement" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
  },
  toast: {
    recorded: { "zh-TW": "已記錄撥款", en: "Reimbursement recorded" },
  },
} satisfies Dictionary;

export default advances;
