import type { Dictionary } from "./dictionary";

/** 報表 > 財務報表（docs/general-ledger.md §3）、列印頁、Excel 匯出、MCP 報表工具共用。 */
const statements = {
  title: { "zh-TW": "財務報表", en: "Financial statements" },
  reports: {
    bs: { "zh-TW": "資產負債表", en: "Balance sheet" },
    is: { "zh-TW": "綜合損益表", en: "Income statement" },
    cf: { "zh-TW": "現金流量表", en: "Cash flow statement" },
    eq: { "zh-TW": "權益變動表", en: "Statement of changes in equity" },
    tb: { "zh-TW": "試算表", en: "Trial balance" },
    vat: { "zh-TW": "營業稅", en: "VAT" },
    review: { "zh-TW": "待處理", en: "To review" },
    notes: { "zh-TW": "附註", en: "Notes" },
  },
  ledger: {
    government: { "zh-TW": "政府帳", en: "Government ledger" },
    management: { "zh-TW": "管理帳", en: "Management ledger" },
  },
  ledgerNote: {
    government: {
      "zh-TW": "政府帳：只含政府看得到的帳戶與要申報的收支；不屬政府帳的那一側記到股東往來。",
      en: "Government ledger: only government-visible accounts and reportable items; the side that isn't in this ledger goes to due to shareholders.",
    },
    management: {
      "zh-TW": "管理帳：全部交易、全部帳戶（含隱形帳戶），是公司真實的狀況。",
      en: "Management ledger: every transaction and every account (including off-book ones) — the real picture.",
    },
  },
  presets: {
    this_month: { "zh-TW": "本月", en: "This month" },
    last_month: { "zh-TW": "上月", en: "Last month" },
    this_quarter: { "zh-TW": "本季", en: "This quarter" },
    last_quarter: { "zh-TW": "上季", en: "Last quarter" },
    ytd: { "zh-TW": "今年至今", en: "Year to date" },
    this_year: { "zh-TW": "本年度", en: "This fiscal year" },
    last_year: { "zh-TW": "上年度", en: "Last fiscal year" },
    custom: { "zh-TW": "自訂…", en: "Custom…" },
  },
  compare: {
    none: { "zh-TW": "不比較", en: "No comparison" },
    prev: { "zh-TW": "比上一期", en: "vs previous period" },
    yoy: { "zh-TW": "比去年同期", en: "vs same period last year" },
  },
  controls: {
    period: { "zh-TW": "期間", en: "Period" },
    asOf: { "zh-TW": "截至 {date}", en: "As of {date}" },
    asOfLabel: { "zh-TW": "截止日", en: "As of" },
    from: { "zh-TW": "起日", en: "From" },
    to: { "zh-TW": "迄日", en: "To" },
    apply: { "zh-TW": "套用", en: "Apply" },
    compare: { "zh-TW": "比較", en: "Compare" },
    year: { "zh-TW": "年度", en: "Year" },
    yearLabel: { "zh-TW": "{year} 年", en: "{year}" },
    excel: { "zh-TW": "Excel", en: "Excel" },
    print: { "zh-TW": "列印／PDF", en: "Print / PDF" },
  },
  checks: {
    title: { "zh-TW": "檢查", en: "Checks" },
    status: {
      pass: { "zh-TW": "通過", en: "Pass" },
      warn: { "zh-TW": "要留意", en: "Needs attention" },
      fail: { "zh-TW": "不通過", en: "Failed" },
    },
    codes: {
      entries_balanced: { "zh-TW": "分錄借貸平衡", en: "Entries balance" },
      balance_sheet_balances: { "zh-TW": "資產＝負債＋權益", en: "Assets = liabilities + equity" },
      bank_reconciliation: { "zh-TW": "銀行對帳", en: "Bank reconciliation" },
      employee_subledger: { "zh-TW": "員工代墊子帳", en: "Employee advances sub-ledger" },
      ar_open: { "zh-TW": "應收未沖", en: "Open receivables" },
    },
    review: {
      "zh-TW": "{count, plural, =0 {沒有待處理} other {# 筆待處理}}",
      en: "{count, plural, =0 {Nothing to review} one {# item to review} other {# items to review}}",
    },
  },
  table: {
    code: { "zh-TW": "代碼", en: "Code" },
    name: { "zh-TW": "會計項目", en: "Account" },
    item: { "zh-TW": "項目", en: "Item" },
    change: { "zh-TW": "變動 %", en: "Change %" },
    asOf: { "zh-TW": "{date}", en: "{date}" },
    empty: { "zh-TW": "這段期間沒有分錄", en: "No entries in this period" },
    drillHint: { "zh-TW": "點科目看分錄明細", en: "Click an account for its entries" },
  },
  tb: {
    opening: { "zh-TW": "期初餘額", en: "Opening" },
    debit: { "zh-TW": "借方", en: "Debit" },
    credit: { "zh-TW": "貸方", en: "Credit" },
    closing: { "zh-TW": "期末餘額", en: "Closing" },
    total: { "zh-TW": "合計", en: "Total" },
    balanced: { "zh-TW": "借貸平衡", en: "Debits equal credits" },
    unbalanced: { "zh-TW": "借貸不平衡", en: "Debits and credits differ" },
    signNote: { "zh-TW": "餘額借方為正、貸方為負。", en: "Balances: debit positive, credit negative." },
  },
  drill: {
    description: {
      "zh-TW": "{ledger} · {period} · 餘額借方為正、貸方為負",
      en: "{ledger} · {period} · balance: debit positive, credit negative",
    },
    ledger: {
      government: { "zh-TW": "政府帳", en: "Government ledger" },
      management: { "zh-TW": "管理帳", en: "Management ledger" },
    },
    columns: {
      date: { "zh-TW": "日期", en: "Date" },
      memo: { "zh-TW": "摘要", en: "Memo" },
      counter: { "zh-TW": "對方科目", en: "Counter account" },
      debit: { "zh-TW": "借方", en: "Debit" },
      credit: { "zh-TW": "貸方", en: "Credit" },
      balance: { "zh-TW": "餘額", en: "Balance" },
      source: { "zh-TW": "來源", en: "Source" },
    },
    total: { "zh-TW": "合計（{count} 筆）", en: "Total ({count} lines)" },
    empty: { "zh-TW": "這段期間這個科目沒有分錄", en: "No entries for this account in this period" },
    error: { "zh-TW": "讀不到這個科目的明細", en: "Couldn't load this account's entries" },
  },
  source: {
    transaction: { "zh-TW": "交易", en: "Transaction" },
    invoice: { "zh-TW": "發票", en: "Invoice" },
    opening: { "zh-TW": "期初", en: "Opening" },
    depreciation: { "zh-TW": "折舊", en: "Depreciation" },
    fx_revaluation: { "zh-TW": "外幣評價", en: "FX revaluation" },
    manual: { "zh-TW": "手動分錄", en: "Manual entry" },
  },
  vat: {
    title: { "zh-TW": "{year} 年營業稅", en: "VAT {year}" },
    regime: {
      general: { "zh-TW": "一般營業人（401，雙月申報）", en: "General VAT business (Form 401, bi-monthly)" },
      small_scale: { "zh-TW": "小規模營業人（國稅局查定，每季）", en: "Small-scale business (assessed quarterly)" },
      none: { "zh-TW": "免營業稅", en: "Not VAT-registered" },
    },
    noRegime: {
      "zh-TW": "會計設定是「免營業稅」，沒有營業稅報表。",
      en: "Accounting settings say this organization isn't VAT-registered, so there is no VAT report.",
    },
    columns: {
      period: { "zh-TW": "期別", en: "Period" },
      invoiceTaxableNet: { "zh-TW": "應稅銷售額", en: "Taxable sales" },
      invoiceZeroRatedNet: { "zh-TW": "零稅率銷售額", en: "Zero-rated sales" },
      invoiceExemptNet: { "zh-TW": "免稅銷售額", en: "Exempt sales" },
      invoiceOutputTax: { "zh-TW": "銷項稅額（發票）", en: "Output VAT (invoices)" },
      invoiceInputTax: { "zh-TW": "進項稅額（發票）", en: "Input VAT (invoices)" },
      glRevenue: { "zh-TW": "營業收入（總帳）", en: "Revenue (ledger)" },
      glOutputTax: { "zh-TW": "銷項稅額（總帳）", en: "Output VAT (ledger)" },
      glInputTax: { "zh-TW": "進項稅額（總帳）", en: "Input VAT (ledger)" },
      taxDue: { "zh-TW": "應納稅額", en: "VAT due" },
      difference: { "zh-TW": "發票與總帳差額", en: "Invoices vs ledger" },
    },
    total: { "zh-TW": "全年合計", en: "Year total" },
    empty: { "zh-TW": "這一年沒有發票或收入", en: "No invoices or revenue this year" },
    note: {
      general: {
        "zh-TW": "應納稅額＝銷項稅額－進項稅額。差額是發票銷售額與總帳收入的差，超過 1 元會標出來。",
        en: "VAT due = output VAT − input VAT. The difference compares invoiced sales with ledger revenue; anything over NT$1 is flagged.",
      },
      small_scale: {
        "zh-TW": "應納稅額是查定稅額的推估（銷售額 × 1%，減進項稅額的 10%），以國稅局核定為準。",
        en: "VAT due estimates the assessed tax (sales × 1%, less 10% of input VAT); the tax office's assessment prevails.",
      },
      none: { "zh-TW": "", en: "" },
    },
  },
  review: {
    empty: { "zh-TW": "沒有要處理的項目，帳都對得上。", en: "Nothing to review — the books are clean." },
    groupSummary: {
      "zh-TW": "{count} 筆 · 合計 {amount, number}",
      en: "{count, plural, one {# item} other {# items}} · total {amount, number}",
    },
    truncated: { "zh-TW": "只列出前 {shown} 筆（共 {count} 筆）", en: "Showing the first {shown} of {count}" },
    severity: {
      error: { "zh-TW": "要修正", en: "Fix" },
      warning: { "zh-TW": "要確認", en: "Check" },
      info: { "zh-TW": "資訊", en: "Info" },
    },
    ledger: {
      government: { "zh-TW": "政府帳", en: "Government" },
      management: { "zh-TW": "管理帳", en: "Management" },
      both: { "zh-TW": "兩本帳", en: "Both" },
    },
    columns: {
      date: { "zh-TW": "日期", en: "Date" },
      ledger: { "zh-TW": "帳別", en: "Ledger" },
      detail: { "zh-TW": "內容", en: "Detail" },
      amount: { "zh-TW": "金額", en: "Amount" },
      source: { "zh-TW": "來源", en: "Source" },
    },
    codes: {
      uncategorized: {
        title: { "zh-TW": "未分類", en: "Uncategorized" },
        description: {
          "zh-TW": "{count} 筆交易沒有分類，暫記在「待分類收入／費用」；補上分類，報表就會歸到正確的科目。",
          en: "{count, plural, one {# transaction has} other {# transactions have}} no category and sit in uncategorized income / expense; add a category to post them to the right account.",
        },
      },
      missing_fx: {
        title: { "zh-TW": "缺匯率，沒有入帳", en: "Missing FX rate — not posted" },
        description: {
          "zh-TW": "{count} 筆外幣交易沒有台幣金額，也找不到匯率，所以沒有入帳；補上台幣金額或匯率。",
          en: "{count, plural, one {# foreign-currency transaction has} other {# foreign-currency transactions have}} no local amount and no FX rate, so nothing was posted; add the local amount or a rate.",
        },
      },
      fx_estimated: {
        title: { "zh-TW": "匯率是推估的", en: "FX rate estimated" },
        description: {
          "zh-TW": "{count} 筆外幣交易用的是 7 天以前最近的一筆匯率；金額大的建議補上當天匯率或台幣金額。",
          en: "{count, plural, one {# foreign-currency transaction uses} other {# foreign-currency transactions use}} the latest rate more than 7 days earlier; for large amounts add that day's rate or the local amount.",
        },
      },
      invoice_unlinked: {
        title: { "zh-TW": "發票沒綁收款", en: "Invoice not linked to a payment" },
        description: {
          "zh-TW": "{count} 張開立發票沒有收款交易綁它，收入改以收款認列、發票本身沒入帳；到待連結把收款綁上。",
          en: "{count, plural, one {# issued invoice has} other {# issued invoices have}} no payment linked, so revenue is recognised on receipt and the invoice isn't posted; link the payment on the pending-links page.",
        },
      },
      ar_residual: {
        title: { "zh-TW": "應收沒沖完", en: "Receivable not fully settled" },
        description: {
          "zh-TW": "{count} 張發票的收款合計跟含稅金額對不上，差額留在應收帳款；確認是少收、手續費還是匯差。",
          en: "{count, plural, one {# invoice's payments don't} other {# invoices' payments don't}} add up to the gross amount; the gap stays in receivables — check whether it's short-paid, a fee or FX.",
        },
      },
      shareholder_plug: {
        title: { "zh-TW": "以股東往來沖轉", en: "Posted via due to shareholders" },
        description: {
          "zh-TW": "{count} 筆在政府帳上有一側不屬政府帳，改記股東往來（股東代墊或取用）；這是設計，不一定是錯。",
          en: "{count, plural, one {# entry has} other {# entries have}} one side outside the government ledger, posted to due to shareholders instead (paid or taken by the shareholder); expected, not necessarily wrong.",
        },
      },
      unmapped_default: {
        title: { "zh-TW": "使用預設科目", en: "Default account used" },
        description: {
          "zh-TW": "{count} 筆交易的分類或帳戶沒有指定會計項目，套用了預設科目；到會計設定確認對應。",
          en: "{count, plural, one {# transaction uses} other {# transactions use}} a category or bank account with no mapped ledger account, so the default applies; review the mapping in accounting settings.",
        },
      },
      opening_balance: {
        title: { "zh-TW": "期初餘額", en: "Opening balance" },
        description: {
          "zh-TW": "{count} 個帳戶的期初餘額已記到期初權益科目；跟會計師給的期初數核對一次。",
          en: "{count, plural, one {# account's opening balance was} other {# accounts' opening balances were}} posted to the opening-equity account; check against the accountant's opening figures.",
        },
      },
      fx_transfer_one_sided: {
        title: { "zh-TW": "換匯只有一邊", en: "One-sided currency exchange" },
        description: {
          "zh-TW": "{count} 筆分類是換匯，但同一天找不到另一邊；補上另一筆，兌換損益才會正確。",
          en: "{count, plural, one {# transaction is} other {# transactions are}} categorised as a currency exchange with no matching other side that day; add it so the FX gain or loss is right.",
        },
      },
    },
  },
  notes: {
    unknown: { "zh-TW": "（未指定）", en: "(unspecified)" },
    total: { "zh-TW": "合計", en: "Total" },
    history: {
      title: { "zh-TW": "公司沿革", en: "Organization" },
      body: {
        "zh-TW": "{org}（以下稱本公司）依中華民國公司法設立。本報表依本公司帳載資料由系統產生，供內部管理與會計師編製財務報告參考。",
        en: "{org} (the Company) is incorporated in Taiwan. These statements are generated from the Company's books for management and for the accountant preparing the financial report.",
      },
    },
    policies: {
      title: { "zh-TW": "重要會計政策彙總說明", en: "Summary of significant accounting policies" },
      framework: { "zh-TW": "編製依據", en: "Basis of preparation" },
      frameworkBody: {
        "zh-TW": "本報表依商業會計法、商業會計處理準則及{framework}編製。",
        en: "Prepared under the Business Entity Accounting Act, its regulations, and {framework}.",
      },
      currency: { "zh-TW": "功能性貨幣", en: "Functional currency" },
      currencyBody: { "zh-TW": "以{currency}為功能性貨幣及表達貨幣。", en: "{currency} is the functional and presentation currency." },
      basis: { "zh-TW": "會計基礎", en: "Accounting basis" },
      basisBody: {
        "zh-TW": "採權責發生制；開立發票且已綁收款者於發票日認列收入，其餘於收款日認列。",
        en: "Accrual basis; revenue is recognised on the invoice date when the invoice is linked to a payment, otherwise on receipt.",
      },
      fiscalYear: { "zh-TW": "會計年度", en: "Fiscal year" },
      fiscalYearBody: { "zh-TW": "會計年度自每年{month}起算。", en: "The fiscal year starts in {month}." },
      fx: { "zh-TW": "外幣換算", en: "Foreign currency" },
      fxBody: {
        "zh-TW": "外幣交易按交易日匯率換算為{currency}入帳；資產負債表日外幣貨幣性項目按當日匯率重新換算，差額認列為外幣兌換損益。",
        en: "Foreign-currency transactions are translated into {currency} at the transaction-date rate; monetary items are retranslated at the reporting-date rate and the difference is recognised as FX gain or loss.",
      },
      ppe: { "zh-TW": "不動產、廠房及設備", en: "Property, plant and equipment" },
      ppeBody: {
        "zh-TW": "以取得成本入帳，按估計耐用年限以直線法逐月提列折舊。",
        en: "Carried at cost and depreciated monthly on a straight-line basis over the estimated useful life.",
      },
      revenue: { "zh-TW": "營業稅", en: "VAT" },
      revenueBody: {
        "zh-TW": "銷項稅額與進項稅額分別列為負債與資產，申報後互抵。",
        en: "Output and input VAT are carried as a liability and an asset and offset when filed.",
      },
    },
    cash: {
      title: { "zh-TW": "現金及約當現金明細（{date}）", en: "Cash and cash equivalents ({date})" },
      account: { "zh-TW": "帳戶", en: "Account" },
      currency: { "zh-TW": "幣別", en: "Currency" },
      fxBalance: { "zh-TW": "原幣餘額", en: "Foreign-currency balance" },
      balance: { "zh-TW": "帳面金額（{currency}）", en: "Carrying amount ({currency})" },
      empty: { "zh-TW": "這本帳沒有銀行帳戶", en: "No bank accounts in this ledger" },
    },
    receivables: {
      title: { "zh-TW": "應收帳款明細", en: "Accounts receivable by customer" },
      party: { "zh-TW": "客戶", en: "Customer" },
      balance: { "zh-TW": "金額", en: "Amount" },
      empty: { "zh-TW": "沒有未收的應收帳款", en: "No outstanding receivables" },
    },
    employees: {
      title: { "zh-TW": "其他應付款－員工代墊", en: "Other payables — employee advances" },
      employee: { "zh-TW": "員工", en: "Employee" },
      balance: { "zh-TW": "未還金額", en: "Outstanding" },
      empty: { "zh-TW": "沒有未還的員工代墊", en: "No outstanding employee advances" },
    },
    shareholder: {
      title: { "zh-TW": "股東往來", en: "Due to / from shareholders" },
      body: {
        "zh-TW": "截至 {date}，{direction, select, owed {本公司應付股東} other {股東應還本公司}} {amount} 元。",
        en: "As of {date}, {direction, select, owed {the Company owes its shareholders} other {shareholders owe the Company}} {amount}.",
      },
      governmentNote: {
        "zh-TW": "政府帳上有 {count} 張分錄的一側改記股東往來（隱形帳戶代付或取用），明細見待處理。",
        en: "{count, plural, one {# entry} other {# entries}} in the government ledger post one side to this account (paid or taken through off-book accounts); see To review for the list.",
      },
    },
    ppe: {
      title: { "zh-TW": "不動產、廠房及設備", en: "Property, plant and equipment" },
      name: { "zh-TW": "財產", en: "Asset" },
      acquiredOn: { "zh-TW": "取得日", en: "Acquired" },
      life: { "zh-TW": "耐用年限", en: "Useful life" },
      months: { "zh-TW": "{count} 個月", en: "{count, plural, one {# month} other {# months}}" },
      cost: { "zh-TW": "成本", en: "Cost" },
      accumulated: { "zh-TW": "累計折舊", en: "Accumulated depreciation" },
      net: { "zh-TW": "帳面價值", en: "Net book value" },
      disposed: { "zh-TW": "{date} 處分", en: "disposed {date}" },
      empty: { "zh-TW": "沒有登記的財產", en: "No fixed assets recorded" },
    },
  },
  empty: {
    message: {
      "zh-TW": "還沒有任何交易，總帳是空的。記下第一筆收支，報表就會自動產生。",
      en: "No transactions yet, so the ledger is empty. Record the first one and the statements build themselves.",
    },
    cta: { "zh-TW": "前往交易", en: "Go to transactions" },
  },
  print: {
    button: { "zh-TW": "列印／存成 PDF", en: "Print / save as PDF" },
    back: { "zh-TW": "返回財務報表", en: "Back to statements" },
    unit: { "zh-TW": "單位：{currency} 元", en: "Unit: {currency}" },
    asOf: { "zh-TW": "{date}", en: "As of {date}" },
    period: { "zh-TW": "{period}", en: "{period}" },
    footer: {
      "zh-TW": "本報表由系統依帳載資料產生（{date}），未經會計師查核。",
      en: "Generated from the books on {date}; not audited.",
    },
  },
  export: {
    generalLedger: { "zh-TW": "總分類帳", en: "General ledger" },
    fileName: { "zh-TW": "{org}-財務報表-{ledger}-{date}.xlsx", en: "{org}-financial-statements-{ledger}-{date}.xlsx" },
    gl: {
      date: { "zh-TW": "日期", en: "Date" },
      key: { "zh-TW": "分錄編號", en: "Entry key" },
      source: { "zh-TW": "來源", en: "Source" },
      account: { "zh-TW": "會計項目", en: "Account" },
      memo: { "zh-TW": "摘要", en: "Memo" },
      currency: { "zh-TW": "原幣", en: "Currency" },
      fxAmount: { "zh-TW": "原幣金額", en: "FX amount" },
    },
    review: {
      code: { "zh-TW": "項目", en: "Issue" },
      severity: { "zh-TW": "等級", en: "Severity" },
      sourceId: { "zh-TW": "來源編號", en: "Source id" },
    },
  },
  /** StatementRow.label 的翻譯（key 清單見 src/lib/ledger/labels.ts 的 LEDGER_LABEL_KEYS）。 */
  labels: {
    sections: {
      current_assets: { "zh-TW": "流動資產", en: "Current assets" },
      noncurrent_assets: { "zh-TW": "非流動資產", en: "Non-current assets" },
      current_liabilities: { "zh-TW": "流動負債", en: "Current liabilities" },
      noncurrent_liabilities: { "zh-TW": "非流動負債", en: "Non-current liabilities" },
      equity: { "zh-TW": "權益", en: "Equity" },
      operating_revenue: { "zh-TW": "營業收入", en: "Operating revenue" },
      operating_cost: { "zh-TW": "營業成本", en: "Operating costs" },
      operating_expense: { "zh-TW": "營業費用", en: "Operating expenses" },
      non_operating: { "zh-TW": "營業外收益及費損", en: "Non-operating income and expenses" },
      income_tax: { "zh-TW": "所得稅費用", en: "Income tax expense" },
    },
    section_totals: {
      current_assets: { "zh-TW": "流動資產合計", en: "Total current assets" },
      noncurrent_assets: { "zh-TW": "非流動資產合計", en: "Total non-current assets" },
      current_liabilities: { "zh-TW": "流動負債合計", en: "Total current liabilities" },
      noncurrent_liabilities: { "zh-TW": "非流動負債合計", en: "Total non-current liabilities" },
      equity: { "zh-TW": "權益合計", en: "Total equity" },
      operating_revenue: { "zh-TW": "營業收入合計", en: "Total operating revenue" },
      operating_cost: { "zh-TW": "營業成本合計", en: "Total operating costs" },
      operating_expense: { "zh-TW": "營業費用合計", en: "Total operating expenses" },
      non_operating: { "zh-TW": "營業外收益及費損合計", en: "Total non-operating income and expenses" },
      income_tax: { "zh-TW": "所得稅費用合計", en: "Total income tax expense" },
    },
    subtotals: {
      gross_profit: { "zh-TW": "營業毛利（毛損）", en: "Gross profit (loss)" },
      operating_income: { "zh-TW": "營業淨利（淨損）", en: "Operating income (loss)" },
      pre_tax_income: { "zh-TW": "稅前淨利（淨損）", en: "Profit (loss) before tax" },
      net_income: { "zh-TW": "本期淨利（淨損）", en: "Net income (loss)" },
    },
    totals: {
      assets: { "zh-TW": "資產總計", en: "Total assets" },
      liabilities: { "zh-TW": "負債總計", en: "Total liabilities" },
      equity: { "zh-TW": "權益總計", en: "Total equity" },
      liabilities_equity: { "zh-TW": "負債及權益總計", en: "Total liabilities and equity" },
      net_income: { "zh-TW": "本期淨利（淨損）", en: "Net income (loss)" },
    },
    rows: {
      prior_earnings: { "zh-TW": "累積盈虧", en: "Accumulated profit (loss)" },
      current_earnings: { "zh-TW": "本期損益", en: "Profit (loss) for the period" },
    },
    cf: {
      operating: { "zh-TW": "營業活動之現金流量", en: "Cash flows from operating activities" },
      net_income: { "zh-TW": "本期淨利（淨損）", en: "Net income (loss)" },
      depreciation: { "zh-TW": "折舊費用", en: "Depreciation" },
      unrealized_fx: { "zh-TW": "未實現外幣兌換損益", en: "Unrealised FX (gain) loss" },
      operating_total: { "zh-TW": "營業活動之淨現金流入（流出）", en: "Net cash from operating activities" },
      investing: { "zh-TW": "投資活動之現金流量", en: "Cash flows from investing activities" },
      investing_total: { "zh-TW": "投資活動之淨現金流入（流出）", en: "Net cash from investing activities" },
      financing: { "zh-TW": "籌資活動之現金流量", en: "Cash flows from financing activities" },
      financing_total: { "zh-TW": "籌資活動之淨現金流入（流出）", en: "Net cash from financing activities" },
      fx_effect: { "zh-TW": "匯率變動對現金及約當現金之影響", en: "Effect of exchange rate changes on cash" },
      net_change: { "zh-TW": "本期現金及約當現金增加（減少）數", en: "Net increase (decrease) in cash" },
      opening_cash: { "zh-TW": "期初現金及約當現金餘額", en: "Cash at beginning of period" },
      closing_cash: { "zh-TW": "期末現金及約當現金餘額", en: "Cash at end of period" },
    },
    equity: {
      opening: { "zh-TW": "期初餘額", en: "Opening balance" },
      net_income: { "zh-TW": "本期淨利（淨損）", en: "Net income (loss)" },
      capital: { "zh-TW": "股本變動", en: "Changes in capital" },
      other: { "zh-TW": "其他", en: "Other" },
      closing: { "zh-TW": "期末餘額", en: "Closing balance" },
      columns: {
        capital: { "zh-TW": "股本", en: "Share capital" },
        retained: { "zh-TW": "保留盈餘", en: "Retained earnings" },
        other: { "zh-TW": "其他權益", en: "Other equity" },
        total: { "zh-TW": "權益總額", en: "Total equity" },
      },
    },
  },
} satisfies Dictionary;

export default statements;
