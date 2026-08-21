import type { Dictionary } from "./dictionary";

const billing = {
  page: {
    title: { "zh-TW": "請款看板", en: "Billing board" },
    description: { "zh-TW": "所有客戶的請款、收款與發票狀態，一頁看完", en: "Billing, payments, and invoice status for every client, on one page" },
    footerHint: { "zh-TW": "週期性月費的期別由「訂閱 / 月費」自動推算，會直接出現在這裡，不需要另外建立。", en: "Periods for recurring monthly fees are calculated automatically from Subscriptions and appear here directly — no need to create them separately." },
  },
  table: {
    filtered: { "zh-TW": "已篩選", en: "Filtered" },
    all: { "zh-TW": "全部請款項目", en: "All billing items" },
    count: { "zh-TW": "{count} 筆", en: "{count} items" },
    clearFilter: { "zh-TW": "清除篩選", en: "Clear filter" },
    columns: {
      customer: { "zh-TW": "客戶", en: "Client" },
      item: { "zh-TW": "項目", en: "Item" },
      dueDate: { "zh-TW": "應請款日", en: "Due date" },
      amount: { "zh-TW": "已收 / 應收", en: "Collected / Due" },
      status: { "zh-TW": "狀態", en: "Status" },
      invoice: { "zh-TW": "發票", en: "Invoice" },
      nextAction: { "zh-TW": "下一步", en: "Next step" },
    },
    emptyFiltered: { "zh-TW": "這個篩選沒有項目", en: "No items match this filter" },
    emptyFilteredHint: { "zh-TW": "換一張卡片或清除篩選", en: "Try another card, or clear the filter" },
    emptyAll: { "zh-TW": "尚無請款項目", en: "No billing items yet" },
    emptyAllHint: { "zh-TW": "點右上角新增，或到「訂閱 / 月費」建立週期性收費", en: "Add one from the top right, or set up recurring billing under Subscriptions" },
    subscriptionSource: { "zh-TW": "訂閱", en: "Subscription" },
    oneTimeSource: { "zh-TW": "單筆", en: "One-off" },
    billedPrefix: { "zh-TW": "已請款 {date}", en: "Billed {date}" },
    deadline: { "zh-TW": "期限 {date}", en: "Due {date}" },
    pendingInvoice: { "zh-TW": "待開立", en: "Invoice pending" },
    rowDialogDescription: { "zh-TW": "請款項目", en: "Billing item" },
  },
  amount: {
    outstanding: { "zh-TW": "未收 {amount}", en: "{amount} outstanding" },
    overpaid: { "zh-TW": "溢收 {amount}", en: "{amount} overpaid" },
    settled: { "zh-TW": "已收齊", en: "Fully collected" },
  },
  status: {
    upcoming: { "zh-TW": "未到期", en: "Upcoming" },
    due: { "zh-TW": "該請款", en: "Due to bill" },
    billed: { "zh-TW": "已請款待收", en: "Billed, awaiting payment" },
    partial: { "zh-TW": "部分收款", en: "Partially paid" },
    paid: { "zh-TW": "已收款", en: "Paid" },
    overdue: { "zh-TW": "逾期未收", en: "Overdue" },
  },
  summary: {
    due: {
      hint: { "zh-TW": "已到應請款日、還沒請款", en: "Due date has passed, not yet billed" },
    },
    awaiting: {
      label: { "zh-TW": "待收款", en: "Awaiting payment" },
      hint: { "zh-TW": "已請款、還沒收齊", en: "Billed, not yet fully collected" },
    },
    overdue: {
      hint: { "zh-TW": "超過付款期限仍未收齊", en: "Past the payment deadline, still not collected" },
    },
    invoice: {
      label: { "zh-TW": "待開發票", en: "Invoice pending" },
      hint: { "zh-TW": "已請款或已收款、發票還沒開", en: "Billed or paid, invoice not issued yet" },
    },
  },
  common: {
    cancel: { "zh-TW": "取消", en: "Cancel" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    optional: { "zh-TW": "選填", en: "Optional" },
    unspecified: { "zh-TW": "— 未指定 —", en: "— Unspecified —" },
  },
  form: {
    fields: {
      title: { "zh-TW": "項目名稱", en: "Item name" },
      titlePlaceholder: { "zh-TW": "例：簽約金 / 期中款 / 尾款", en: "e.g. Signing deposit / Interim payment / Final payment" },
      contract: { "zh-TW": "合約", en: "Contract" },
      project: { "zh-TW": "專案", en: "Project" },
      amount: { "zh-TW": "應收金額", en: "Amount due" },
      currency: { "zh-TW": "幣別", en: "Currency" },
      dueDate: { "zh-TW": "應請款日", en: "Due date" },
      dueDatePlaceholder: { "zh-TW": "— 無 —", en: "— None —" },
      status: { "zh-TW": "狀態", en: "Status" },
      billedOn: { "zh-TW": "實際請款日", en: "Billed on" },
      billedOnPlaceholder: { "zh-TW": "— 尚未請款 —", en: "— Not billed yet —" },
      paidOn: { "zh-TW": "收款日", en: "Paid on" },
      paidOnPlaceholder: { "zh-TW": "— 尚未收款 —", en: "— Not paid yet —" },
      invoicedOn: { "zh-TW": "開發票日", en: "Invoiced on" },
      invoicedOnPlaceholder: { "zh-TW": "— 尚未開立 —", en: "— Not issued yet —" },
      needsInvoice: { "zh-TW": "這筆需要開發票", en: "This item needs an invoice" },
      note: { "zh-TW": "備註", en: "Note" },
    },
    rawStatus: {
      scheduled: { "zh-TW": "排程中", en: "Scheduled" },
      billed: { "zh-TW": "已請款", en: "Billed" },
      paid: { "zh-TW": "已收款", en: "Paid" },
      cancelled: { "zh-TW": "已取消", en: "Cancelled" },
    },
    paidOnHint: { "zh-TW": "收款金額以「綁定這筆請款項目的收入交易」為準；這裡的收款日只是人工註記。", en: "The amount collected is based on the income transaction linked to this billing item — the paid-on date here is just a manual note." },
  },
  newItem: {
    trigger: { "zh-TW": "新增請款項目", en: "Add billing item" },
    dialog: {
      title: { "zh-TW": "新增請款項目", en: "Add billing item" },
      description: { "zh-TW": "一次性合約分期、專案里程碑或臨時請款。週期性月費請用「訂閱 / 月費」。", en: "One-off contract instalments, project milestones, or ad-hoc billing. For recurring monthly fees, use Subscriptions." },
      save: { "zh-TW": "儲存", en: "Save" },
    },
    toast: {
      created: { "zh-TW": "已新增請款項目", en: "Billing item added" },
    },
  },
  editItem: {
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
    toast: {
      updated: { "zh-TW": "已更新", en: "Updated" },
    },
  },
  issueInvoice: {
    trigger: { "zh-TW": "開發票", en: "Issue invoice" },
    dialog: {
      title: { "zh-TW": "開發票", en: "Issue invoice" },
      description: { "zh-TW": "已用這一期的資料預填。存檔後這一期的「待開立」會消掉，並列進 Simpany 對帳。", en: "Pre-filled from this billing period. Saving clears \"Invoice pending\" for this period and adds it to the Simpany reconciliation." },
      create: { "zh-TW": "建立發票", en: "Create invoice" },
      creating: { "zh-TW": "建立中…", en: "Creating…" },
    },
    fields: {
      customer: { "zh-TW": "客戶", en: "Client" },
      title: { "zh-TW": "品名", en: "Item" },
      invoiceDate: { "zh-TW": "發票日期", en: "Invoice date" },
      counterpartyTaxId: { "zh-TW": "對象統編", en: "Counterparty tax ID" },
      basisLabel: { "zh-TW": "金額基準", en: "Amount basis" },
      grossAmount: { "zh-TW": "含稅金額", en: "Amount incl. tax" },
      netAmount: { "zh-TW": "未稅金額", en: "Amount excl. tax" },
      externalRef: { "zh-TW": "Simpany 發票號碼", en: "Simpany invoice number" },
      externalRefPlaceholder: { "zh-TW": "還沒開就留空，之後在發票頁或對帳時補", en: "Leave blank until issued — fill in later from the invoice page or during reconciliation" },
      externalRefHint: { "zh-TW": "填了就視為 Simpany 已開立；留空則列進「該開未開」，開完再回來補號碼。", en: "Filling this in marks it as issued in Simpany. Leave it blank to list it as not yet issued, then fill in the number once it's done." },
    },
    basis: {
      gross: { "zh-TW": "請款金額為含稅", en: "Billing amount is tax-inclusive" },
      net: { "zh-TW": "請款金額為未稅", en: "Billing amount is tax-exclusive" },
    },
    summary: {
      net: { "zh-TW": "未稅", en: "Excl. tax" },
      taxRate: { "zh-TW": "稅額 5%", en: "Tax (5%)" },
      gross: { "zh-TW": "含稅", en: "Incl. tax" },
    },
    toast: {
      created: { "zh-TW": "已建立發票，記得到 Simpany 實際開立", en: "Invoice created — remember to issue it in Simpany" },
    },
  },
  recordPayment: {
    trigger: { "zh-TW": "登記收款", en: "Record payment" },
    dialog: {
      title: { "zh-TW": "登記收款", en: "Record payment" },
      description: { "zh-TW": "尚未收 {amount}{customer}。下面是還沒綁到任何請款項目的收入交易，金額最接近的排在前面。", en: "{amount} outstanding{customer}. Unlinked income transactions are listed below, closest match first." },
    },
    loading: { "zh-TW": "搜尋可配對的交易…", en: "Searching for matching transactions…" },
    empty: { "zh-TW": "沒有未綁定的收入交易可以配對。錢還沒入帳的話，先到內外帳建一筆收入。", en: "No unlinked income transactions to match. If the money hasn't arrived yet, add an income entry in Dual books first." },
    candidate: {
      noDescription: { "zh-TW": "（無說明）", en: "(No description)" },
      matchExact: { "zh-TW": "金額吻合", en: "Exact match" },
      gap: { "zh-TW": "差 {amount}", en: "Off by {amount}" },
      linking: { "zh-TW": "配對中…", en: "Linking…" },
      pick: { "zh-TW": "就是這筆", en: "Use this one" },
    },
    goToTransactions: { "zh-TW": "到內外帳建一筆收入", en: "Add income in Dual books" },
    toast: {
      linked: { "zh-TW": "已認列這筆收款", en: "Recorded this payment" },
      linkFailed: { "zh-TW": "配對失敗", en: "Failed to match" },
    },
  },
  quickMark: {
    field: {
      billedOn: { "zh-TW": "已請款", en: "billed" },
      paidOn: { "zh-TW": "已收款", en: "paid" },
      invoicedOn: { "zh-TW": "已開發票", en: "invoiced" },
    },
    button: {
      mark: { "zh-TW": "標記{label}", en: "Mark as {label}" },
      unmark: { "zh-TW": "取消{label}", en: "Undo {label}" },
    },
    toast: {
      marked: { "zh-TW": "已標記{label}", en: "Marked as {label}" },
      unmarked: { "zh-TW": "已取消「{label}」", en: "Removed \"{label}\"" },
      updateFailed: { "zh-TW": "更新失敗", en: "Failed to update" },
    },
  },
  syncCalendar: {
    connect: { "zh-TW": "連結 Google 日曆", en: "Connect Google Calendar" },
    sync: { "zh-TW": "同步到 Google 日曆", en: "Sync to Google Calendar" },
    syncing: { "zh-TW": "同步中…", en: "Syncing…" },
    toast: {
      synced: { "zh-TW": "已同步", en: "Synced" },
      syncedDetail: { "zh-TW": "已同步（新增 {created}、更新 {updated}、移除 {deleted}）", en: "Synced (added {created}, updated {updated}, removed {deleted})" },
      syncFailed: { "zh-TW": "同步失敗", en: "Sync failed" },
    },
  },
} satisfies Dictionary;

export default billing;
