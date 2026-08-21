import type { Dictionary } from "./dictionary";

const reconciliation = {
  title: { "zh-TW": "對帳", en: "Reconciliation" },
  description: { "zh-TW": "比對帳面餘額與帳戶實際餘額，確保記帳對得上", en: "Compare book balance against the account's actual balance to make sure the books check out" },
  card: {
    lastReconciled: { "zh-TW": "上次對帳：{date}", en: "Last reconciled: {date}" },
    never: { "zh-TW": "尚未對帳", en: "Not reconciled yet" },
    currentBookBalance: { "zh-TW": "目前帳面餘額", en: "Current book balance" },
  },
  columns: {
    asOfDate: { "zh-TW": "截止日", en: "As of" },
    account: { "zh-TW": "帳戶", en: "Account" },
    bookBalance: { "zh-TW": "帳面餘額", en: "Book balance" },
    statementBalance: { "zh-TW": "實際餘額", en: "Actual balance" },
    diff: { "zh-TW": "差額", en: "Difference" },
    status: { "zh-TW": "狀態", en: "Status" },
    note: { "zh-TW": "備註", en: "Note" },
  },
  empty: { "zh-TW": "尚無對帳紀錄", en: "No reconciliation records yet" },
  editTitle: { "zh-TW": "編輯對帳紀錄", en: "Edit reconciliation record" },
  status: {
    matched: { "zh-TW": "已對平", en: "Matched" },
    mismatched: { "zh-TW": "有差額", en: "Mismatched" },
  },
  accountOption: { "zh-TW": "{name}（{currency}）", en: "{name} ({currency})" },
  new: {
    trigger: { "zh-TW": "新增對帳", en: "Add reconciliation" },
    title: { "zh-TW": "新增對帳紀錄", en: "Add reconciliation record" },
    description: { "zh-TW": "填入該帳戶在截止日的實際餘額，系統會自動與帳面餘額比對差額", en: "Enter the account's actual balance as of the date; the difference from the book balance is calculated automatically" },
  },
  form: {
    account: { "zh-TW": "帳戶", en: "Account" },
    accountPlaceholder: { "zh-TW": "— 請選擇 —", en: "— Select —" },
    asOfDate: { "zh-TW": "截止日期", en: "As of date" },
    statementBalance: { "zh-TW": "對帳單實際餘額", en: "Actual statement balance" },
    statementBalancePlaceholder: { "zh-TW": "銀行 / 帳戶顯示的餘額", en: "The balance shown by the bank / account" },
    note: { "zh-TW": "備註", en: "Note" },
    notePlaceholder: { "zh-TW": "選填", en: "Optional" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    save: { "zh-TW": "儲存", en: "Save" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
  },
  toast: {
    created: { "zh-TW": "已新增對帳紀錄", en: "Reconciliation record added" },
    updated: { "zh-TW": "已更新", en: "Updated" },
  },
} satisfies Dictionary;

export default reconciliation;
