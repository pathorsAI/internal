import type { Dictionary } from "./dictionary";

const payroll = {
  title: { "zh-TW": "薪資", en: "Payroll" },
  description: { "zh-TW": "到「員工」頁對每位員工發放薪資；這裡是發放紀錄", en: "Pay each employee's salary from the Employees page; this is the payment history" },
  goToEmployees: { "zh-TW": "去員工頁發薪", en: "Go to Employees to pay salary" },
  table: {
    title: { "zh-TW": "發放紀錄", en: "Payment history" },
    columns: {
      period: { "zh-TW": "月份", en: "Period" },
      employee: { "zh-TW": "員工", en: "Employee" },
      taxable: { "zh-TW": "應稅", en: "Taxable" },
      nontaxable: { "zh-TW": "免稅", en: "Tax-free" },
      netPay: { "zh-TW": "實發", en: "Net pay" },
      transaction: { "zh-TW": "交易", en: "Transaction" },
      actions: { "zh-TW": "動作", en: "Actions" },
    },
    empty: { "zh-TW": "尚無發放紀錄", en: "No payment history yet" },
    posted: { "zh-TW": "已入帳", en: "Posted" },
  },
  delete: {
    title: { "zh-TW": "撤銷這筆發放？", en: "Reverse this payment?" },
    description: { "zh-TW": "會一併刪除它產生的薪資支出交易。", en: "This also deletes the salary expense transaction it created." },
  },
} satisfies Dictionary;

export default payroll;
