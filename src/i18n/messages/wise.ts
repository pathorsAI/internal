import type { Dictionary } from "./dictionary";

/**
 * Wise 整合的畫面字串：設定 › 整合 的「帳戶對應」區塊，以及帳戶頁的「從 Wise 同步」。
 * 整合本身的名稱 / 描述仍在 integrations.providers.wise。
 */
const wise = {
  mapping: {
    title: { "zh-TW": "Wise 帳戶對應", en: "Wise account mapping" },
    description: {
      "zh-TW":
        "把每個 Wise 餘額對應到一個同幣別的帳本帳戶，並設定切換日：切換日以前的 Wise 交易視為已手動入帳，永遠不會同步。沒有對應的餘額不會同步。同步只讀 Wise、只寫本系統的帳本，不會動到任何錢。",
      en: "Map each Wise balance to a ledger account in the same currency and set a cutover date: Wise transactions before it are treated as already booked by hand and are never synced. Unmapped balances are skipped. Syncing only reads Wise and only writes this ledger — it never moves money.",
    },
    columns: {
      balance: { "zh-TW": "Wise 餘額", en: "Wise balance" },
      account: { "zh-TW": "帳本帳戶", en: "Ledger account" },
      syncFrom: { "zh-TW": "切換日", en: "Cutover date" },
    },
    asOf: { "zh-TW": "{date} 的餘額", en: "Balance as of {date}" },
    unmapped: { "zh-TW": "不同步", en: "Don't sync" },
    noAccounts: {
      "zh-TW": "沒有 {currency} 帳本帳戶，請先到 帳戶 新增",
      en: "No {currency} ledger account yet — add one under Accounts",
    },
    suggestion: { "zh-TW": "建議：{date}", en: "Suggested: {date}" },
    suggestionHint: {
      "zh-TW": "建議值 = 該帳戶最後一筆手動交易的下個月 1 號。留空會自動套用建議值。",
      en: "Suggested = first day of the month after the account's latest hand-entered transaction. Leave blank to use it.",
    },
    empty: {
      "zh-TW": "還沒有發現任何 Wise 餘額。按「重新整理餘額」向 Wise 讀取。",
      en: "No Wise balances discovered yet. Press “Refresh balances” to read them from Wise.",
    },
    refresh: { "zh-TW": "重新整理餘額", en: "Refresh balances" },
    refreshNeedsEnabled: {
      "zh-TW": "要先開啟 Wise 整合才能向 Wise 讀取餘額。",
      en: "Switch the Wise integration on to read balances from Wise.",
    },
    save: { "zh-TW": "儲存對應", en: "Save mapping" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    saved: { "zh-TW": "已儲存 Wise 帳戶對應", en: "Wise mapping saved" },
    refreshed: { "zh-TW": "已更新 Wise 餘額", en: "Wise balances refreshed" },
    readOnly: {
      "zh-TW": "只有擁有者或管理員可以修改對應。",
      en: "Only owners or admins can change the mapping.",
    },
    activity: {
      saved: { "zh-TW": "更新 Wise 帳戶對應", en: "Updated the Wise account mapping" },
    },
  },
  sync: {
    button: { "zh-TW": "從 Wise 同步", en: "Sync from Wise" },
    title: { "zh-TW": "從 Wise 同步交易", en: "Sync transactions from Wise" },
    description: {
      "zh-TW":
        "以下是試算結果，尚未寫入。確認無誤再按寫入：新交易記在內帳、分類留空並標為「待確認」；已同步過的交易不會重複寫入。",
      en: "This is a preview — nothing has been written yet. New entries are booked to the internal book, uncategorized and marked “To review”; entries synced before are never written twice.",
    },
    loading: { "zh-TW": "正在讀取 Wise 對帳單…", en: "Reading Wise statements…" },
    retry: { "zh-TW": "重試", en: "Retry" },
    columns: {
      account: { "zh-TW": "帳戶", en: "Account" },
      range: { "zh-TW": "期間", en: "Range" },
      fetched: { "zh-TW": "讀到", en: "Read" },
      existing: { "zh-TW": "已存在", en: "Existing" },
      beforeCutover: { "zh-TW": "切換日前", en: "Before cutover" },
      toCreate: { "zh-TW": "將新增", en: "To add" },
      date: { "zh-TW": "日期", en: "Date" },
      party: { "zh-TW": "對象", en: "Counterparty" },
      description: { "zh-TW": "說明", en: "Description" },
      amount: { "zh-TW": "金額", en: "Amount" },
    },
    sampleTitle: {
      "zh-TW": "將新增的交易（前 {count} 筆）",
      en: "Entries to add (first {count})",
    },
    skipped: {
      "zh-TW": "略過的 Wise 餘額：{list}",
      en: "Skipped Wise balances: {list}",
    },
    reason: {
      unmapped: { "zh-TW": "未對應", en: "unmapped" },
      no_sync_from: { "zh-TW": "未設切換日", en: "no cutover date" },
      account_missing: { "zh-TW": "帳本帳戶不存在", en: "ledger account missing" },
      currency_mismatch: { "zh-TW": "幣別不符", en: "currency mismatch" },
    },
    nothing: { "zh-TW": "沒有新的交易需要寫入。", en: "Nothing new to write." },
    apply: { "zh-TW": "寫入 {count} 筆", en: "Write {count} entries" },
    applying: { "zh-TW": "寫入中…", en: "Writing…" },
    cancel: { "zh-TW": "關閉", en: "Close" },
    applied: {
      "zh-TW": "已從 Wise 寫入 {count} 筆交易",
      en: "Wrote {count} entries from Wise",
    },
    type: {
      income: { "zh-TW": "收入", en: "Income" },
      expense: { "zh-TW": "支出", en: "Expense" },
      transfer: { "zh-TW": "換匯", en: "Conversion" },
    },
    mappedBadge: { "zh-TW": "Wise", en: "Wise" },
    activity: {
      applied: {
        "zh-TW": "從 Wise 同步 {count} 筆交易",
        en: "Synced {count} entries from Wise",
      },
    },
  },
  errors: {
    notAllowed: {
      "zh-TW": "只有組織的擁有者或管理員可以操作 Wise 同步",
      en: "Only organization owners or admins can use the Wise sync",
    },
    failed: { "zh-TW": "操作失敗", en: "Something went wrong" },
  },
} satisfies Dictionary;

export default wise;
