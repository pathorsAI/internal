import type { Dictionary } from "./dictionary";

const transactions = {
  page: {
    title: { "zh-TW": "內外帳", en: "Dual books" },
    description: { "zh-TW": "所有交易紀錄，可依帳別、分類篩選", en: "All transactions, filterable by book and category" },
  },
  columns: {
    date: { "zh-TW": "日期", en: "Date" },
    counterparty: { "zh-TW": "對象", en: "Counterparty" },
    description: { "zh-TW": "說明", en: "Description" },
    category: { "zh-TW": "分類", en: "Category" },
    book: { "zh-TW": "帳別", en: "Book" },
    account: { "zh-TW": "帳戶", en: "Account" },
    lastUpdated: { "zh-TW": "最後更新", en: "Last updated" },
    amount: { "zh-TW": "金額", en: "Amount" },
  },
  table: {
    monthLabel: { "zh-TW": "{year} 年 {month} 月", en: "{month}/{year}" },
    rowsCount: { "zh-TW": "{count} 筆", en: "{count} entries" },
    uncategorized: { "zh-TW": "未分類", en: "Uncategorized" },
  },
  empty: {
    noData: { "zh-TW": "尚無交易", en: "No transactions yet" },
    noPageData: { "zh-TW": "此頁沒有資料", en: "No data on this page" },
  },
  editDialog: {
    title: { "zh-TW": "編輯交易", en: "Edit transaction" },
    description: { "zh-TW": "類型不可改，其餘欄位皆可編輯", en: "Type can't be changed; every other field is editable" },
  },
  type: {
    expense: { "zh-TW": "一般支出", en: "Expense" },
    income: { "zh-TW": "收入", en: "Income" },
    advance: { "zh-TW": "員工代墊", en: "Employee advance" },
    reimbursement: { "zh-TW": "撥款", en: "Reimbursement" },
    transfer: { "zh-TW": "轉帳", en: "Transfer" },
  },
  filters: {
    book: {
      all: { "zh-TW": "全部帳別", en: "All books" },
      internal: { "zh-TW": "內帳", en: "Internal" },
      external: { "zh-TW": "外帳", en: "External" },
      both: { "zh-TW": "內外帳", en: "Both" },
    },
    category: {
      all: { "zh-TW": "全部分類", en: "All categories" },
    },
    account: {
      all: { "zh-TW": "全部帳戶", en: "All accounts" },
    },
    month: {
      all: { "zh-TW": "全部月份", en: "All months" },
      label: { "zh-TW": "{year} 年 {month} 月", en: "{month}/{year}" },
    },
  },
  form: {
    addTransaction: { "zh-TW": "新增交易", en: "Add transaction" },
    pickScenario: { "zh-TW": "先選這是哪一種交易", en: "First, pick the type of transaction" },
    reselect: { "zh-TW": "重選", en: "Change type" },
    scenario: {
      expense: {
        label: { "zh-TW": "一般支出", en: "Expense" },
        desc: { "zh-TW": "公司直接付錢", en: "The company pays directly" },
      },
      income: {
        label: { "zh-TW": "收入", en: "Income" },
        desc: { "zh-TW": "收到客戶的錢", en: "Money received from a client" },
      },
      advance: {
        label: { "zh-TW": "員工代墊", en: "Employee advance" },
        desc: { "zh-TW": "員工先付，之後再還", en: "Employee pays first, reimbursed later" },
      },
      transfer: {
        label: { "zh-TW": "帳戶互轉", en: "Account transfer" },
        desc: { "zh-TW": "自己帳戶間搬錢", en: "Moving money between your own accounts" },
      },
    },
    date: { "zh-TW": "日期", en: "Date" },
    amount: { "zh-TW": "金額", en: "Amount" },
    amountPlaceholder: { "zh-TW": "正數", en: "Positive number" },
    currency: { "zh-TW": "幣別", en: "Currency" },
    currencyFollowsAccount: {
      "zh-TW": "幣別跟隨所選帳戶，不可自行更改",
      en: "The currency follows the selected account and cannot be changed",
    },
    currencyPickAccount: {
      "zh-TW": "請先選擇帳戶",
      en: "Select an account first",
    },
    currencyWasMismatched: {
      "zh-TW": "這筆原本記為 {original}，與帳戶幣別 {currency} 不符（舊資料）。儲存後會改成 {currency}，金額數字不會做匯率換算，請自行確認。",
      en: "This entry was recorded as {original}, which does not match the account currency {currency} (legacy data). Saving will change it to {currency}; the amount is not converted, so check it yourself.",
    },
    transferCurrencyMismatch: {
      "zh-TW": "轉出帳戶是 {from}、轉入帳戶是 {to}，幣別不同。系統目前不支援跨幣別轉帳（一筆交易只有一個幣別），請改選同幣別的帳戶。",
      en: "The from account is {from} and the to account is {to}. Cross-currency transfers are not supported yet (a transaction carries a single currency) — pick accounts with the same currency.",
    },
    fromAccount: { "zh-TW": "轉出帳戶", en: "From account" },
    toAccount: { "zh-TW": "轉入帳戶", en: "To account" },
    accountPlaceholder: { "zh-TW": "— 選擇帳戶 —", en: "— Select an account —" },
    client: { "zh-TW": "客戶", en: "Client" },
    vendor: { "zh-TW": "廠商 / 對象", en: "Vendor / counterparty" },
    clientPlaceholder: { "zh-TW": "輸入或選擇客戶…", en: "Enter or select a client…" },
    vendorPlaceholder: { "zh-TW": "輸入或選擇廠商…", en: "Enter or select a vendor…" },
    payer: { "zh-TW": "代墊人（員工）", en: "Payer (employee)" },
    payerPlaceholder: { "zh-TW": "輸入代墊的員工…", en: "Enter the employee who paid…" },
    category: { "zh-TW": "分類", en: "Category" },
    receivingAccount: { "zh-TW": "收款帳戶", en: "Receiving account" },
    payingAccount: { "zh-TW": "付款帳戶", en: "Paying account" },
    project: { "zh-TW": "專案", en: "Project" },
    projectPlaceholder: { "zh-TW": "— 未指定 —", en: "— Unassigned —" },
    contract: { "zh-TW": "合約", en: "Contract" },
    contractHintIncome: { "zh-TW": "綁合約後可在合約頁看到已收 / 未收。", en: "Linking a contract lets you see collected / uncollected amounts on the contract page." },
    contractHintOther: { "zh-TW": "可綁合約來追蹤這單花了多少（成本不會從合約金額扣除）。", en: "Link a contract to track how much this line cost (the cost isn't deducted from the contract amount)." },
    description: { "zh-TW": "摘要", en: "Description" },
    descriptionPlaceholder: { "zh-TW": "選填", en: "Optional" },
    reported: { "zh-TW": "上外帳（要報稅）", en: "Include in external book (taxable)" },
    billedToCompanyTaxId: { "zh-TW": "這筆有報公司統編", en: "This is billed under the company's tax ID" },
    typeLabel: { "zh-TW": "類型", en: "Type" },
    typeLocked: { "zh-TW": "（類型不可改）", en: "(type can't be changed)" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    save: { "zh-TW": "儲存", en: "Save" },
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
    voucher: {
      title: { "zh-TW": "憑證 / 相關證明", en: "Document / supporting evidence" },
      optional: { "zh-TW": "（選填）", en: " (optional)" },
      kind: { "zh-TW": "類型", en: "Type" },
      attachment: { "zh-TW": "附檔", en: "Attachment" },
      hintBilled: { "zh-TW": "有報公司統編，請選擇電子發票或其他發票。電子發票會計師自動看到;其他發票（三聯式等）會列入待通知清單。", en: "Billed under the company's tax ID — choose an e-invoice or another invoice type. E-invoices are visible to the accountant automatically; other invoices (triplicate, etc.) go on the notice list." },
      hintFree: { "zh-TW": "電子發票會計師會自動看到;其他發票（三聯式等）系統會標記、要主動通知會計師。", en: "E-invoices are visible to the accountant automatically; other invoices (triplicate, etc.) are flagged and need to be reported to the accountant." },
    },
    editVoucher: {
      title: { "zh-TW": "補上憑證 / 相關證明", en: "Add document / supporting evidence" },
    },
    docKind: {
      e_invoice: { "zh-TW": "電子發票", en: "E-invoice" },
      paper_invoice: { "zh-TW": "其他發票（三聯式等）", en: "Other invoice (triplicate, etc.)" },
      receipt: { "zh-TW": "收據", en: "Receipt" },
      other: { "zh-TW": "其他", en: "Other" },
    },
    docLabel: {
      invoicePaper: { "zh-TW": "其他發票", en: "Other invoice" },
      invoiceElectronic: { "zh-TW": "電子發票", en: "E-invoice" },
      receipt: { "zh-TW": "收據", en: "Receipt" },
      contract: { "zh-TW": "合約", en: "Contract" },
      other: { "zh-TW": "其他", en: "Other" },
    },
    attachedDocs: { "zh-TW": "已附憑證", en: "Attached documents" },
    needsNotifyAccountant: { "zh-TW": "需通知會計師", en: "Notify accountant" },
    viewFile: { "zh-TW": "檢視檔案", en: "View file" },
  },
  combobox: {
    category: {
      placeholder: { "zh-TW": "搜尋或選擇分類（選填）…", en: "Search or select a category (optional)…" },
      empty: { "zh-TW": "查無分類", en: "No categories found" },
    },
    contract: {
      placeholder: { "zh-TW": "搜尋或選擇合約（選填）…", en: "Search or select a contract (optional)…" },
      empty: { "zh-TW": "查無合約", en: "No contracts found" },
    },
  },
  toast: {
    added: { "zh-TW": "已新增交易", en: "Transaction added" },
    updated: { "zh-TW": "已更新", en: "Updated" },
  },
} satisfies Dictionary;

export default transactions;
