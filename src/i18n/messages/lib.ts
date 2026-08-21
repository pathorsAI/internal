import type { Dictionary } from "./dictionary";

const lib = {
  records: {
    advanceSettled: { "zh-TW": "撥款還代墊", en: "Advance reimbursed" },
    salary: { "zh-TW": "{period} 薪資 - {name}", en: "{period} salary - {name}" },
    orgFallback: { "zh-TW": "組織", en: "Organization" },
  },
  activity: {
    calendarConnected: { "zh-TW": "連結 Google 日曆", en: "Google Calendar connected" },
    calendarSynced: { "zh-TW": "同步 Google 日曆", en: "Google Calendar synced" },
    calendarDisconnected: { "zh-TW": "中斷 Google 日曆連結", en: "Google Calendar disconnected" },
    advanceReimbursed: { "zh-TW": "員工代墊撥款", en: "Employee advance reimbursed" },
    salaryPaid: { "zh-TW": "發放薪資", en: "Salary paid" },
    paymentMatched: { "zh-TW": "收款配對 #{id}", en: "Payment matched #{id}" },
    paymentMatchedPeriod: { "zh-TW": "{period} 收款配對 #{id}", en: "{period} payment matched #{id}" },
  },
  installment: {
    full: { "zh-TW": "全額", en: "Full amount" },
    first: { "zh-TW": "頭款", en: "First payment" },
    final: { "zh-TW": "尾款", en: "Final payment" },
    signing: { "zh-TW": "簽約金", en: "Signing fee" },
    interim: { "zh-TW": "期中款", en: "Interim payment" },
    nth: { "zh-TW": "第 {n} 期", en: "Installment {n}" },
  },
  calendar: {
    notConnected: { "zh-TW": "尚未連結 Google 日曆", en: "Google Calendar is not connected" },
    grantExpired: { "zh-TW": "Google 日曆授權已失效，請到組織設定重新連結", en: "The Google Calendar authorization has expired. Reconnect it in organization settings." },
    title: { "zh-TW": "請款提醒 · {org}", en: "Billing reminders · {org}" },
    client: { "zh-TW": "客戶", en: "client" },
    link: { "zh-TW": "請款看板：/billing", en: "Billing board: /billing" },
    checkFailed: { "zh-TW": "確認日曆失敗（{status}）", en: "Could not verify the calendar ({status})" },
    createFailed: { "zh-TW": "建立日曆失敗（{status}）：{body}", en: "Could not create the calendar ({status}): {body}" },
    updateEventFailed: { "zh-TW": "更新事件失敗（{status}）：{body}", en: "Could not update the event ({status}): {body}" },
    createEventFailed: { "zh-TW": "建立事件失敗（{status}）：{body}", en: "Could not create the event ({status}): {body}" },
    deleteEventFailed: { "zh-TW": "刪除事件失敗（{status}）", en: "Could not delete the event ({status})" },
    due: {
      summary: { "zh-TW": "請款：{who} · {title}（{money}）", en: "Bill: {who} · {title} ({money})" },
      description: { "zh-TW": "應向 {who} 請款 {money}。", en: "Bill {who} for {money}." },
    },
    payment: {
      summary: { "zh-TW": "收款追蹤：{who} · {title}（未收 {outstanding}）", en: "Collection: {who} · {title} ({outstanding} outstanding)" },
      description: { "zh-TW": "已於 {billedOn} 請款，尚未收齊 {outstanding}。", en: "Billed on {billedOn}; {outstanding} still outstanding." },
    },
    invoice: {
      summary: { "zh-TW": "開發票：{who} · {title}（{money}）", en: "Invoice: {who} · {title} ({money})" },
      description: { "zh-TW": "需開立發票給 {who}，金額 {money}。", en: "Issue an invoice to {who} for {money}." },
    },
  },
} satisfies Dictionary;

export default lib;
