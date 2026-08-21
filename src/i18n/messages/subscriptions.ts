import type { Dictionary } from "./dictionary";

const subscriptions = {
  status: {
    active: { "zh-TW": "進行中", en: "Active" },
    paused: { "zh-TW": "暫停", en: "Paused" },
    ended: { "zh-TW": "結束", en: "Ended" },
  },
  periodStatus: {
    paid: { "zh-TW": "已收", en: "Paid" },
    partial: { "zh-TW": "部分", en: "Partial" },
    overdue: { "zh-TW": "逾期", en: "Overdue" },
    upcoming: { "zh-TW": "未到期", en: "Upcoming" },
  },
  interval: {
    monthly: { "zh-TW": "每月", en: "Monthly" },
    yearly: { "zh-TW": "每年", en: "Yearly" },
    quarterly: { "zh-TW": "每季", en: "Quarterly" },
    everyNMonths: { "zh-TW": "每 {months} 個月", en: "Every {months} months" },
  },
  list: {
    title: { "zh-TW": "訂閱 / 月費", en: "Subscriptions" },
    description: { "zh-TW": "客戶定期收費的方案，點列可編輯", en: "Recurring billing plans for clients — click a row to edit" },
    newButton: { "zh-TW": "新增訂閱", en: "Add subscription" },
    rowDescription: { "zh-TW": "訂閱 / 月費", en: "Subscription" },
    columns: {
      plan: { "zh-TW": "方案", en: "Plan" },
      customer: { "zh-TW": "客戶", en: "Client" },
      project: { "zh-TW": "專案", en: "Project" },
      amount: { "zh-TW": "金額", en: "Amount" },
      frequency: { "zh-TW": "頻率", en: "Frequency" },
      status: { "zh-TW": "狀態", en: "Status" },
    },
    empty: { "zh-TW": "尚無訂閱，點右上角新增", en: "No subscriptions yet — add one from the top right" },
  },
  schedule: {
    heading: { "zh-TW": "各期收款", en: "Collection by period" },
    empty: { "zh-TW": "尚無收款期別", en: "No billing periods yet" },
    columns: {
      period: { "zh-TW": "期別", en: "Period" },
      expected: { "zh-TW": "應收", en: "Expected" },
      paid: { "zh-TW": "已收", en: "Collected" },
      status: { "zh-TW": "狀態", en: "Status" },
    },
    outstandingTotal: { "zh-TW": "未收合計：", en: "Outstanding total:" },
  },
  newDialog: {
    trigger: { "zh-TW": "新增訂閱", en: "Add subscription" },
    title: { "zh-TW": "新增訂閱 / 月費", en: "Add subscription" },
    description: { "zh-TW": "客戶定期收費的方案，「每隔幾個月收一次」", en: "A recurring billing plan for a client — set how many months between charges" },
    project: {
      label: { "zh-TW": "專案", en: "Project" },
      placeholder: { "zh-TW": "— 未指定 —", en: "— None —" },
    },
    name: {
      label: { "zh-TW": "方案名稱", en: "Plan name" },
      placeholder: { "zh-TW": "例：基礎月費、維運合約", en: "e.g. Basic plan, maintenance contract" },
    },
    amount: { "zh-TW": "金額", en: "Amount" },
    currency: { "zh-TW": "幣別", en: "Currency" },
    intervalMonths: { "zh-TW": "每隔幾個月收一次", en: "Months between charges" },
    status: { "zh-TW": "狀態", en: "Status" },
    startDate: { "zh-TW": "開始日期", en: "Start date" },
    endDate: { "zh-TW": "結束日期", en: "End date" },
    datePlaceholderNone: { "zh-TW": "— 無 —", en: "— None —" },
    note: {
      label: { "zh-TW": "備註", en: "Note" },
      placeholder: { "zh-TW": "選填", en: "Optional" },
    },
    submit: { "zh-TW": "儲存", en: "Save" },
    submitting: { "zh-TW": "儲存中…", en: "Saving…" },
    toast: {
      added: { "zh-TW": "已新增訂閱", en: "Subscription added" },
    },
  },
  editForm: {
    cancel: { "zh-TW": "取消", en: "Cancel" },
    submit: { "zh-TW": "儲存變更", en: "Save changes" },
    submitting: { "zh-TW": "儲存中…", en: "Saving…" },
    toast: {
      updated: { "zh-TW": "已更新", en: "Updated" },
    },
  },
} satisfies Dictionary;

export default subscriptions;
