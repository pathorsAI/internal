import type { Dictionary } from "./dictionary";

/**
 * 資料聯動（docs/data-links.md）：待連結頁，以及散在其他頁面的連結提示
 * （交易頁的待連結標記、交易對象頁的合併、合約頁的「已收齊」）。
 */
const links = {
  title: { "zh-TW": "待連結", en: "Pending links" },
  description: {
    "zh-TW": "還沒確定屬於哪一筆請款、訂閱或合約的收款，以及對象名稱跟既有對象很像、沒有自動新建的交易",
    en: "Payments not yet matched to a billing item, subscription or contract, and transactions whose counterparty name looks like an existing one",
  },
  count: { "zh-TW": "{count} 筆待連結", en: "{count} pending" },
  columns: {
    date: { "zh-TW": "日期", en: "Date" },
    party: { "zh-TW": "交易對象", en: "Counterparty" },
    amount: { "zh-TW": "金額", en: "Amount" },
    description: { "zh-TW": "說明", en: "Description" },
    candidates: { "zh-TW": "候選與處理", en: "Candidates & actions" },
  },
  reason: {
    link_suggested: { "zh-TW": "建議連結", en: "Suggested" },
    link_ambiguous: { "zh-TW": "多個相符", en: "Ambiguous" },
    link_amount_mismatch: { "zh-TW": "金額不符", en: "Amount mismatch" },
    party_similar: { "zh-TW": "對象相似", en: "Similar counterparty" },
  },
  reasonHint: {
    link_suggested: {
      "zh-TW": "剛好一個金額相符的候選；這是既有交易，確認後再掛上",
      en: "Exactly one candidate matches the amount; this is an existing transaction, so confirm before linking",
    },
    link_ambiguous: {
      "zh-TW": "有多個金額相符的候選，請選一個",
      en: "Several candidates match the amount; pick one",
    },
    link_amount_mismatch: {
      "zh-TW": "這位客戶有開著的應收，但金額都對不上",
      en: "This customer has open receivables, but none match the amount",
    },
    party_similar: {
      "zh-TW": "對象名稱跟既有對象很像，沒有自動新建；選既有對象會把這個名稱加成別名",
      en: "The name looks like an existing counterparty, so none was created; choosing one adds this name as its alias",
    },
  },
  kind: {
    billing_item: { "zh-TW": "請款項", en: "Billing item" },
    subscription: { "zh-TW": "訂閱期別", en: "Subscription period" },
    contract: { "zh-TW": "合約", en: "Contract" },
  },
  candidate: {
    expected: { "zh-TW": "應收 {amount}", en: "Due {amount}" },
    matches: { "zh-TW": "金額相符", en: "Amount matches" },
    short: { "zh-TW": "少 {amount}", en: "{amount} short" },
    over: { "zh-TW": "多 {amount}", en: "{amount} over" },
    none: { "zh-TW": "沒有候選", en: "No candidates" },
  },
  party: {
    heldName: { "zh-TW": "原始名稱「{name}」", en: "Original name \"{name}\"" },
    score: { "zh-TW": "相似度 {score}%", en: "{score}% similar" },
    viaAlias: { "zh-TW": "比對到別名", en: "matched an alias" },
    pick: { "zh-TW": "選這個", en: "Use this" },
    create: { "zh-TW": "建立新對象", en: "Create new" },
  },
  actions: {
    attach: { "zh-TW": "掛上", en: "Link" },
    skip: { "zh-TW": "略過", en: "Skip" },
    skipHint: { "zh-TW": "不連，之後也不再自動比對", en: "Don't link; it won't be matched automatically again" },
  },
  rescan: {
    button: { "zh-TW": "重新掃描既有收入", en: "Rescan existing income" },
    running: { "zh-TW": "掃描中…", en: "Scanning…" },
    title: { "zh-TW": "重新掃描既有收入？", en: "Rescan existing income?" },
    body: {
      "zh-TW":
        "找出有客戶、卻沒掛任何請款項、訂閱或合約的收入，跟這些客戶開著的應收比對。只會標成待連結讓你確認，不會自動掛上；略過過的不會再出現。",
      en: "Finds income with a customer but no billing item, subscription or contract, and compares it with that customer's open receivables. Rows are only flagged for review here, never linked automatically; skipped rows stay skipped.",
    },
    confirm: { "zh-TW": "開始掃描", en: "Scan" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    done: {
      "zh-TW": "掃描 {scanned} 筆，標出 {flagged} 筆待連結",
      en: "Scanned {scanned}, flagged {flagged} for review",
    },
  },
  empty: { "zh-TW": "沒有待連結的交易", en: "Nothing to link" },
  emptyHint: {
    "zh-TW": "新的收款會自動掛到請款項、訂閱或合約上；對不上的才會出現在這裡",
    en: "New payments are linked automatically; only the ones that can't be matched show up here",
  },
  toast: {
    attached: { "zh-TW": "已掛上", en: "Linked" },
    skipped: { "zh-TW": "已略過", en: "Skipped" },
    partyChosen: { "zh-TW": "已指定交易對象", en: "Counterparty set" },
    aliasAdded: { "zh-TW": "已把「{name}」加成別名", en: "Added \"{name}\" as an alias" },
    partyCreated: { "zh-TW": "已建立交易對象", en: "Counterparty created" },
    stillPending: {
      "zh-TW": "對象已更新，但收款還要再選一次要掛哪一筆",
      en: "Counterparty updated; the payment still needs a link",
    },
    contractHint: { "zh-TW": "合約「{title}」已收齊，可以結案", en: "Contract \"{title}\" is fully collected and can be closed" },
  },
  errors: {
    not_found: { "zh-TW": "找不到這筆交易", en: "Transaction not found" },
    candidate_not_found: { "zh-TW": "找不到這個請款項、訂閱或合約", en: "Billing item, subscription or contract not found" },
    period_required: { "zh-TW": "訂閱要指定是哪一期", en: "Choose a subscription period" },
    party_not_found: { "zh-TW": "找不到這個交易對象", en: "Counterparty not found" },
    no_pending_party: { "zh-TW": "這筆交易沒有暫存的對象名稱", en: "This transaction has no held counterparty name" },
    failed: { "zh-TW": "處理失敗，請再試一次", en: "Something went wrong, please try again" },
  },
  /** 交易頁 */
  transactions: {
    badge: { "zh-TW": "待連結", en: "Pending link" },
    badgeHint: { "zh-TW": "還沒確定屬於哪一筆請款／訂閱／合約，點這裡處理", en: "Not yet matched to a billing item, subscription or contract — click to resolve" },
    showOnly: { "zh-TW": "只看待連結", en: "Show pending only" },
    showAll: { "zh-TW": "顯示全部", en: "Show all" },
    open: { "zh-TW": "到待連結頁處理", en: "Resolve on the Pending links page" },
  },
  /** 交易對象頁：合併 */
  merge: {
    button: { "zh-TW": "合併", en: "Merge" },
    title: { "zh-TW": "合併交易對象", en: "Merge counterparties" },
    description: {
      "zh-TW": "把重複的對象併進一個：所有交易、專案、合約、訂閱、請款項、發票、廠商計費都改指目標，來源的名稱變成目標的別名，來源刪除。無法復原。",
      en: "Fold duplicates into one: every transaction, project, contract, subscription, billing item, invoice and vendor billing account moves to the target, source names become its aliases, and the sources are deleted. This cannot be undone.",
    },
    target: { "zh-TW": "保留（目標）", en: "Keep (target)" },
    targetPlaceholder: { "zh-TW": "選要保留的對象", en: "Choose the party to keep" },
    sources: { "zh-TW": "併進來後刪除（來源）", en: "Merge in and delete (sources)" },
    search: { "zh-TW": "搜尋對象", en: "Search counterparties" },
    txnCount: { "zh-TW": "{count} 筆交易", en: "{count} transactions" },
    preview: { "zh-TW": "預覽", en: "Preview" },
    previewing: { "zh-TW": "計算中…", en: "Calculating…" },
    willMove: { "zh-TW": "會改指目標的資料", en: "Records that will move" },
    nothingToMove: { "zh-TW": "來源沒有任何關聯資料", en: "The sources have no linked records" },
    aliases: { "zh-TW": "合併後目標的別名", en: "Target aliases after merge" },
    confirm: { "zh-TW": "確認合併", en: "Merge" },
    merging: { "zh-TW": "合併中…", en: "Merging…" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    done: { "zh-TW": "已合併 {count} 個對象到「{name}」", en: "Merged {count} into \"{name}\"" },
    pickBoth: { "zh-TW": "請選目標與至少一個來源", en: "Choose a target and at least one source" },
    changed: {
      "zh-TW": "合併途中有對象被改動或刪除，沒有任何變更，請重新整理再試",
      en: "A party changed while merging; nothing was changed. Refresh and try again",
    },
    possibleDuplicate: { "zh-TW": "可能重複", en: "Possible duplicate" },
    similarTo: { "zh-TW": "跟 {names} 很像", en: "Similar to {names}" },
    counts: {
      transactions: { "zh-TW": "交易", en: "Transactions" },
      projects: { "zh-TW": "專案", en: "Projects" },
      subscriptions: { "zh-TW": "訂閱", en: "Subscriptions" },
      contracts: { "zh-TW": "合約", en: "Contracts" },
      billingItems: { "zh-TW": "請款項", en: "Billing items" },
      invoices: { "zh-TW": "發票", en: "Invoices" },
      vendorBillingAccounts: { "zh-TW": "廠商計費帳戶", en: "Vendor billing accounts" },
      vendorBillingMatchParties: { "zh-TW": "廠商計費的比對對象", en: "Vendor billing match parties" },
      recurringExpenses: { "zh-TW": "固定支出（舊）", en: "Recurring expenses (legacy)" },
    },
  },
  /** 合約頁：已收齊 */
  contractClose: {
    badge: { "zh-TW": "已收齊，可結案", en: "Fully collected" },
    hint: { "zh-TW": "已收金額 ≥ 合約金額，但狀態還是草稿或進行中", en: "Received ≥ contract amount, but the status is still draft or active" },
    markCompleted: { "zh-TW": "標記完成", en: "Mark completed" },
    done: { "zh-TW": "已標記為完成", en: "Marked as completed" },
    failed: { "zh-TW": "更新失敗", en: "Update failed" },
  },
} satisfies Dictionary;

export default links;
