import type { Dictionary } from "./dictionary";

const reports = {
  title: { "zh-TW": "報表", en: "Reports" },
  description: { "zh-TW": "應收帳齡、營業稅期、合約完整性，以及成本與專案損益", en: "Receivables ageing, VAT periods, contract coverage, and cost & project P&L" },
  missingClient: { "zh-TW": "（未指定客戶）", en: "(no client)" },
  partyLabel: {
    vendor: { "zh-TW": "廠商", en: "Vendor" },
    customer: { "zh-TW": "客戶", en: "Client" },
    gov: { "zh-TW": "政府機關", en: "Government" },
    other: { "zh-TW": "其他", en: "Other" },
  },
  vendorCosts: {
    title: { "zh-TW": "廠商 / infra 成本", en: "Vendor / infra cost" },
    summary: { "zh-TW": "依交易對象彙總的支出（含代墊，TWD）— 合計 {total}", en: "Spend by counterparty (incl. advances, TWD) — total {total}" },
    columns: {
      counterparty: { "zh-TW": "交易對象", en: "Counterparty" },
      type: { "zh-TW": "類型", en: "Type" },
      txnCount: { "zh-TW": "交易數", en: "Transactions" },
      amount: { "zh-TW": "支出 (TWD)", en: "Spend (TWD)" },
    },
    empty: { "zh-TW": "尚無支出資料", en: "No spend data yet" },
  },
  projectPnl: {
    title: { "zh-TW": "專案損益 (P&L)", en: "Project P&L" },
    description: { "zh-TW": "每個專案的收入、支出與淨額（TWD）", en: "Income, expense, and net per project (TWD)" },
    columns: {
      project: { "zh-TW": "專案", en: "Project" },
      client: { "zh-TW": "客戶", en: "Client" },
      income: { "zh-TW": "收入", en: "Income" },
      expense: { "zh-TW": "支出", en: "Expense" },
      net: { "zh-TW": "淨額", en: "Net" },
    },
    empty: { "zh-TW": "尚無專案", en: "No projects yet" },
  },
  aging: {
    title: { "zh-TW": "應收帳齡", en: "Receivables ageing" },
    noneOutstanding: { "zh-TW": "沒有未收的款項", en: "Nothing outstanding" },
    totalLine: { "zh-TW": "{amounts} 未收", en: "{amounts} outstanding" },
    totalRow: { "zh-TW": "合計（{currency}）", en: "Total ({currency})" },
    columns: {
      customer: { "zh-TW": "客戶", en: "Client" },
      total: { "zh-TW": "合計", en: "Total" },
    },
    empty: {
      message: { "zh-TW": "沒有未收的款項", en: "Nothing outstanding" },
      hint: { "zh-TW": "已請款的項目都收齊了", en: "Every billed item has been collected" },
    },
    buckets: {
      current: { "zh-TW": "未逾期", en: "Current" },
      d1_30: { "zh-TW": "1–30 天", en: "1–30 days" },
      d31_60: { "zh-TW": "31–60 天", en: "31–60 days" },
      d61_90: { "zh-TW": "61–90 天", en: "61–90 days" },
      d90p: { "zh-TW": "90 天以上", en: "90+ days" },
    },
  },
  contractCoverage: {
    title: { "zh-TW": "合約完整性", en: "Contract coverage" },
    allScheduled: { "zh-TW": "每張合約的金額都排進請款了", en: "Every contract's amount is fully scheduled" },
    gapsSummary: { "zh-TW": "{count} 張合約有錢還沒排進請款", en: "{count} contracts have unscheduled amounts" },
    columns: {
      contract: { "zh-TW": "合約", en: "Contract" },
      client: { "zh-TW": "客戶", en: "Client" },
      amount: { "zh-TW": "合約金額", en: "Contract amount" },
      scheduled: { "zh-TW": "已排程", en: "Scheduled" },
      billed: { "zh-TW": "已請款", en: "Billed" },
      paid: { "zh-TW": "已收款", en: "Paid" },
      unscheduled: { "zh-TW": "未排", en: "Unscheduled" },
    },
    unsetAmount: { "zh-TW": "未設金額", en: "No amount set" },
    gap: {
      short: { "zh-TW": "缺 {amount}", en: "Short {amount}" },
      over: { "zh-TW": "超排 {amount}", en: "Over {amount}" },
      done: { "zh-TW": "已排完", en: "Fully scheduled" },
    },
    empty: {
      message: { "zh-TW": "尚無合約", en: "No contracts yet" },
      hint: { "zh-TW": "到合約頁新增，設好請款方式就會自動展開排程", en: "Add one on the contracts page — billing schedules expand automatically once billing terms are set" },
    },
    goToContracts: { "zh-TW": "到合約頁補排請款", en: "Schedule billing on contracts page" },
  },
  taxPeriod: {
    label: { "zh-TW": "{year} 年 {startMonth}-{endMonth} 月（第 {period} 期）", en: "{year} · months {startMonth}–{endMonth} (period {period})" },
    current: { "zh-TW": "本期", en: "Current" },
    previous: { "zh-TW": "上一期", en: "Previous" },
    count: { "zh-TW": "{count} 筆", en: "{count} invoices" },
    shouldIssue: { "zh-TW": "本期該開", en: "Should issue this period" },
    issued: { "zh-TW": "已開（銷項有效）", en: "Issued (valid output tax)" },
    pending: { "zh-TW": "已建、Simpany 待開", en: "Created, awaiting Simpany" },
    missing: { "zh-TW": "該開連紀錄都沒有", en: "Should issue, no record at all" },
    goReconcile: { "zh-TW": "去對帳", en: "Go to reconciliation" },
  },
} satisfies Dictionary;

export default reports;
