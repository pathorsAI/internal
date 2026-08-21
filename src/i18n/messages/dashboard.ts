import type { Dictionary } from "./dictionary";

const dashboard = {
  title: { "zh-TW": "總覽", en: "Overview" },
  description: { "zh-TW": "內外帳與財務概況", en: "Dual books and financial summary" },
  currency: {
    TWD: { "zh-TW": "台幣", en: "TWD" },
    USD: { "zh-TW": "美金", en: "USD" },
  },
  kind: {
    bank: { "zh-TW": "銀行", en: "Bank" },
    wise: { "zh-TW": "Wise / 虛擬", en: "Wise / virtual" },
    cash: { "zh-TW": "現金", en: "Cash" },
  },
  stats: {
    income: { "zh-TW": "收入", en: "Income" },
    expense: { "zh-TW": "支出", en: "Expense" },
    net: { "zh-TW": "淨額", en: "Net" },
  },
  assets: {
    title: { "zh-TW": "資產總覽", en: "Assets overview" },
    empty: { "zh-TW": "尚無帳戶", en: "No accounts yet" },
    totalAssets: { "zh-TW": "{currency} 總資產", en: "Total {currency}" },
  },
  flow: {
    title: { "zh-TW": "收支概況", en: "Cash flow" },
    empty: { "zh-TW": "尚無收支資料", en: "No cash flow data yet" },
  },
  recent: {
    title: { "zh-TW": "最近交易", en: "Recent transactions" },
    viewAll: { "zh-TW": "查看全部", en: "View all" },
    empty: { "zh-TW": "尚無交易", en: "No transactions yet" },
    uncategorized: { "zh-TW": "未分類", en: "Uncategorized" },
  },
  trend: {
    title: { "zh-TW": "收支趨勢", en: "Trends" },
    allAccounts: { "zh-TW": "全部帳戶", en: "All accounts" },
    months6: { "zh-TW": "6 個月", en: "6 months" },
    months12: { "zh-TW": "12 個月", en: "12 months" },
    flowTitle: { "zh-TW": "每月收支", en: "Monthly cash flow" },
    flowTitleWithAccount: { "zh-TW": "每月收支（{account}）", en: "Monthly cash flow ({account})" },
    flowEmpty: { "zh-TW": "此範圍尚無收支資料", en: "No cash flow data for this range" },
    balanceTitle: { "zh-TW": "帳戶餘額走勢", en: "Account balance trend" },
    balanceTitleWithAccount: { "zh-TW": "帳戶餘額走勢（{account}）", en: "Account balance trend ({account})" },
    balanceEmpty: { "zh-TW": "此範圍尚無餘額資料", en: "No balance data for this range" },
    tooltip: {
      income: { "zh-TW": "收入", en: "Income" },
      expense: { "zh-TW": "支出", en: "Expense" },
      balance: { "zh-TW": "餘額", en: "Balance" },
    },
  },
  error: {
    message: { "zh-TW": "載入失敗，請重試。", en: "Failed to load. Please try again." },
    retry: { "zh-TW": "重新載入", en: "Reload" },
  },
} satisfies Dictionary;

export default dashboard;
