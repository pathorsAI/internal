import type { Dictionary } from "./dictionary";

/** 收款分配（migrations/0041）：「分配收款」Sheet 與寫入錯誤。 */
const allocations = {
  trigger: { "zh-TW": "分配收款", en: "Allocate payment" },
  triggerShort: { "zh-TW": "分配", en: "Allocate" },
  sheet: {
    title: { "zh-TW": "分配收款", en: "Allocate payment" },
    description: {
      "zh-TW": "把這筆入帳分給一個或多個應收。匯款被扣的手續費／匯差可以記在「手續費」，那一項就算收齊。",
      en: "Split this payment across one or more receivables. A bank fee or FX shortfall can be entered as a fee, so that receivable counts as collected.",
    },
    loading: { "zh-TW": "載入中…", en: "Loading…" },
    loadFailed: { "zh-TW": "載入失敗", en: "Failed to load" },
    txnAmount: { "zh-TW": "入帳金額", en: "Payment amount" },
    allocated: { "zh-TW": "已分配", en: "Allocated" },
    unallocated: { "zh-TW": "未分配", en: "Unallocated" },
    fees: { "zh-TW": "吸收的手續費", en: "Absorbed fees" },
    overAllocated: { "zh-TW": "分配超過入帳金額", en: "More than the payment amount is allocated" },
    empty: {
      "zh-TW": "還沒有分配。沒有分配時，這筆照它原本綁的合約／請款項目／訂閱期別整筆計算。",
      en: "No allocations yet. Without allocations, the payment counts in full toward the contract / billing item / subscription period it is linked to.",
    },
    addLine: { "zh-TW": "新增一列", en: "Add line" },
    removeLine: { "zh-TW": "移除這列", en: "Remove line" },
    absorb: { "zh-TW": "把剩下的差額記為手續費，吸收", en: "Absorb the remaining shortfall as a fee" },
    absorbHint: {
      "zh-TW": "會記在「{line}」這一列：手續費＝它還沒收的 − 這次分給它的。",
      en: "Goes on “{line}”: fee = what it still owes − what this payment gives it.",
    },
    absorbNothing: { "zh-TW": "選的這一列沒有差額可以吸收", en: "The chosen line has no shortfall to absorb" },
    absorbLine: { "zh-TW": "記在哪一列", en: "Absorb on line" },
    save: { "zh-TW": "儲存", en: "Save" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    clearAll: { "zh-TW": "清除全部分配", en: "Clear all allocations" },
  },
  line: {
    target: { "zh-TW": "應收", en: "Receivable" },
    targetPlaceholder: { "zh-TW": "選一個應收", en: "Pick a receivable" },
    amount: { "zh-TW": "金額", en: "Amount" },
    fee: { "zh-TW": "手續費", en: "Fee" },
    outstanding: { "zh-TW": "尚未收 {amount}", en: "{amount} outstanding" },
    shortfall: { "zh-TW": "還差 {amount}", en: "{amount} short" },
    settled: { "zh-TW": "收齊", en: "Settled" },
    over: { "zh-TW": "多收 {amount}", en: "{amount} over" },
  },
  group: {
    customer: { "zh-TW": "這個客戶", en: "This customer" },
    other: { "zh-TW": "其他客戶", en: "Other customers" },
    current: { "zh-TW": "目前的分配", en: "Current allocations" },
  },
  kind: {
    subscription_period: { "zh-TW": "訂閱期別", en: "Subscription period" },
    billing_item: { "zh-TW": "請款項目", en: "Billing item" },
    contract: { "zh-TW": "合約", en: "Contract" },
  },
  toast: {
    saved: { "zh-TW": "已儲存收款分配", en: "Allocations saved" },
    cleared: { "zh-TW": "已清除收款分配", en: "Allocations cleared" },
    saveFailed: { "zh-TW": "儲存失敗", en: "Failed to save" },
  },
  error: {
    invalidTarget: { "zh-TW": "第 {line} 列沒有選應收", en: "Line {line} has no receivable selected" },
    invalidPeriod: { "zh-TW": "第 {line} 列的期別不是合法日期", en: "Line {line} has an invalid period date" },
    negativeAmount: { "zh-TW": "第 {line} 列的金額不能是負的", en: "Line {line}: the amount can't be negative" },
    negativeFee: { "zh-TW": "第 {line} 列的手續費不能是負的", en: "Line {line}: the fee can't be negative" },
    emptyLine: { "zh-TW": "第 {line} 列的金額加手續費要大於 0", en: "Line {line}: amount + fee must be more than 0" },
    duplicateTarget: { "zh-TW": "第 {line} 列的應收重複了，請合併成一列", en: "Line {line} repeats a receivable — merge them into one line" },
    overAllocated: { "zh-TW": "分配的金額加起來超過入帳金額", en: "The allocated amounts add up to more than the payment" },
    transactionNotFound: { "zh-TW": "找不到這筆交易", en: "Transaction not found" },
    notIncome: { "zh-TW": "只有收入交易可以分配", en: "Only income transactions can be allocated" },
    targetNotFound: { "zh-TW": "第 {line} 列的應收找不到（可能已刪除）", en: "Line {line}: receivable not found (it may have been deleted)" },
    currencyMismatch: { "zh-TW": "第 {line} 列的應收幣別跟這筆入帳不同", en: "Line {line}: the receivable's currency differs from the payment's" },
    splitTransaction: {
      "zh-TW": "這筆入帳已經分給多個應收，請用「分配收款」調整",
      en: "This payment is already split across receivables — use “Allocate payment” to change it",
    },
  },
} satisfies Dictionary;

export default allocations;
