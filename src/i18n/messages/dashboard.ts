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
  spend: {
    title: { "zh-TW": "支出去向", en: "Where the money went" },
    byParty: { "zh-TW": "依廠商", en: "By vendor" },
    byCategory: { "zh-TW": "依分類", en: "By category" },
    range: {
      month: { "zh-TW": "本月", en: "This month" },
      "3m": { "zh-TW": "近 3 個月", en: "Last 3 months" },
      "12m": { "zh-TW": "近 12 個月", en: "Last 12 months" },
    },
    total: { "zh-TW": "{range}支出合計（台幣）", en: "{range} · total spend (TWD)" },
    other: { "zh-TW": "其他", en: "Other" },
    unassignedParty: { "zh-TW": "未指定對象", en: "No counterparty" },
    uncategorized: { "zh-TW": "未分類", en: "Uncategorized" },
    empty: { "zh-TW": "這段期間沒有支出", en: "No spending in this period" },
    unconverted: {
      "zh-TW": "另有 {count} 筆外幣支出沒有台幣金額，未計入",
      en: "{count, plural, one {# foreign-currency expense has} other {# foreign-currency expenses have}} no TWD amount and {count, plural, one {is} other {are}} not included",
    },
    tooltip: {
      amount: { "zh-TW": "金額", en: "Amount" },
      share: { "zh-TW": "占比", en: "Share" },
      count: { "zh-TW": "筆數", en: "Transactions" },
      otherParties: { "zh-TW": "共 {count} 個交易對象", en: "{count, plural, one {# counterparty} other {# counterparties}}" },
      otherCategories: { "zh-TW": "共 {count} 個分類", en: "{count, plural, one {# category} other {# categories}}" },
    },
  },
  error: {
    message: { "zh-TW": "載入失敗，請重試。", en: "Failed to load. Please try again." },
    retry: { "zh-TW": "重新載入", en: "Reload" },
  },
} satisfies Dictionary;

export default dashboard;
