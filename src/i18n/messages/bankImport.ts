import type { Dictionary } from "./dictionary";

/** 帳戶頁「匯入永豐明細」（src/app/dashboard/bank-accounts/sinopac-import-sheet.tsx）。 */
const bankImport = {
  button: { "zh-TW": "匯入永豐明細", en: "Import SinoPac statement" },
  title: { "zh-TW": "匯入永豐銀行明細", en: "Import a SinoPac statement" },
  description: {
    "zh-TW":
      "上傳永豐寰宇金融網匯出的明細（CSV、TSV 或 Excel）。先試算給你看，按「匯入」才寫入：對到的交易補上銀行備註與參考號（銀行一筆對系統好幾筆、加總剛好相等的也算），對不到的新建一筆待確認交易，金額差一點的只提示不新建，沖正的兩行互相抵銷，匯過的行不會重複。",
    en: "Upload the statement exported from SinoPac online banking (CSV, TSV or Excel). You see a dry run first; nothing is written until you press Import. Matched entries get the bank memo and reference (including one bank line that equals several entries added up), unmatched lines become new entries to review, near-amount lines are only flagged, correction pairs cancel out, and lines imported before are skipped.",
  },
  file: { "zh-TW": "明細檔", en: "Statement file" },
  fileHint: {
    "zh-TW": "表頭可以是 Account / Transaction date / Currency / Withdrawal / Deposit / Balance / Transaction ref / Remarks / Correction note，或 acct_last4 / datetime / …",
    en: "Headers may be Account / Transaction date / Currency / Withdrawal / Deposit / Balance / Transaction ref / Remarks / Correction note, or acct_last4 / datetime / …",
  },
  loading: { "zh-TW": "試算中…", en: "Running a dry run…" },
  mapping: {
    title: { "zh-TW": "帳戶對應", en: "Account mapping" },
    hint: {
      "zh-TW": "帳本帳戶沒有存帳號，請確認每個末四碼對到哪個帳戶。沒選的帳戶這次不會匯入。",
      en: "Ledger accounts don't store account numbers, so confirm which account each last-four belongs to. Accounts left unselected are not imported this time.",
    },
    account: { "zh-TW": "帳號末四碼 {last4}（{currency}，{count} 行）", en: "Account ending {last4} ({currency}, {count} lines)" },
    placeholder: { "zh-TW": "— 不匯入 —", en: "— Don't import —" },
    none: { "zh-TW": "不匯入", en: "Don't import" },
    problem: {
      not_found: { "zh-TW": "找不到這個帳戶", en: "Account not found" },
      currency_mismatch: { "zh-TW": "幣別不同，這個帳戶的行會略過", en: "Currency differs; this account's lines are skipped" },
    },
  },
  counts: {
    matched: { "zh-TW": "配對補備註", en: "Matched (memo added)" },
    created: { "zh-TW": "新建待確認", en: "New, to review" },
    correctionPair: { "zh-TW": "沖正抵銷", en: "Correction pairs" },
    duplicate: { "zh-TW": "已匯入過", en: "Already imported" },
    skipped: { "zh-TW": "略過", en: "Skipped" },
    nearMatch: { "zh-TW": "金額差一點", en: "Near amount" },
  },
  skipUnmatched: {
    label: { "zh-TW": "配不上的只列出來，不新建交易", en: "List unmatched lines only; don't create entries" },
    hint: {
      "zh-TW": "例如銀行一筆、系統拆成好幾筆但湊不出來時，先別建，人工處理完再重匯同一份檔案。",
      en: "Useful when a bank line was split into entries that couldn't be matched automatically: fix them by hand, then import the same file again.",
    },
  },
  parseErrors: {
    "zh-TW": "{count} 行讀不懂，不會匯入：{list}",
    en: "{count} lines couldn't be read and won't be imported: {list}",
  },
  parseCode: {
    badAccount: { "zh-TW": "帳號", en: "account" },
    badDate: { "zh-TW": "日期", en: "date" },
    badCurrency: { "zh-TW": "幣別", en: "currency" },
    badAmount: { "zh-TW": "金額", en: "amount" },
    noAmount: { "zh-TW": "沒有金額", en: "no amount" },
    bothAmounts: { "zh-TW": "提款與存款都有值", en: "both withdrawal and deposit" },
  },
  parseItem: { "zh-TW": "第 {lineNo} 行（{what}）", en: "line {lineNo} ({what})" },
  columns: {
    line: { "zh-TW": "列", en: "Line" },
    time: { "zh-TW": "時間", en: "Time" },
    remarks: { "zh-TW": "備註 / 參考號", en: "Remarks / ref" },
    amount: { "zh-TW": "金額", en: "Amount" },
    decision: { "zh-TW": "處理", en: "Action" },
  },
  decision: {
    match: { "zh-TW": "配對 #{id}", en: "Match #{id}" },
    matchMulti: { "zh-TW": "一對多：{count} 筆", en: "Split across {count} entries" },
    near_match: { "zh-TW": "金額差一點：#{id} 記 {amount}", en: "Near amount: #{id} has {amount}" },
    create: { "zh-TW": "新建待確認", en: "New, to review" },
    recover: { "zh-TW": "補記 #{id}", en: "Record #{id}" },
    correction_pair: { "zh-TW": "沖正（第 {line} 行）", en: "Correction (line {line})" },
    duplicate: { "zh-TW": "已匯入過", en: "Already imported" },
    duplicateInFile: { "zh-TW": "檔案內重複", en: "Repeated in file" },
    skip: {
      correction_unpaired: { "zh-TW": "沖正找不到原交易", en: "Correction without a partner" },
      unmapped: { "zh-TW": "帳戶未對應", en: "Account not mapped" },
      currency_mismatch: { "zh-TW": "幣別不同", en: "Currency differs" },
      created_deleted: { "zh-TW": "之前建的交易已刪除", en: "Entry created earlier was deleted" },
      left_unmatched: { "zh-TW": "配不上，只列出", en: "Unmatched, listed only" },
    },
  },
  fillNote: { "zh-TW": "補：{fields}", en: "Adds: {fields}" },
  fillMemo: { "zh-TW": "備註", en: "memo" },
  fillRef: { "zh-TW": "參考號", en: "ref" },
  fillNothing: { "zh-TW": "已有備註與參考號", en: "Memo and ref already set" },
  filter: {
    actionable: { "zh-TW": "只看會寫入的", en: "Only lines that write" },
    all: { "zh-TW": "全部 {count} 行", en: "All {count} lines" },
  },
  nothing: { "zh-TW": "沒有要寫入的行。", en: "Nothing to write." },
  cancel: { "zh-TW": "取消", en: "Cancel" },
  apply: { "zh-TW": "匯入", en: "Import" },
  applying: { "zh-TW": "匯入中…", en: "Importing…" },
  retry: { "zh-TW": "重試", en: "Retry" },
  applied: {
    "zh-TW": "已匯入：配對 {matched}、新建 {created}、沖正 {pairs}",
    en: "Imported: {matched} matched, {created} new, {pairs} correction lines",
  },
  appliedWithFailures: {
    "zh-TW": "{count} 行寫入失敗（例如落在已結帳期間）：{list}。修正後重匯同一份檔案即可。",
    en: "{count} lines failed (e.g. in a closed period): {list}. Fix it and import the same file again.",
  },
  errors: {
    notAllowed: { "zh-TW": "只有擁有者或管理員可以匯入銀行明細", en: "Only owners and admins can import bank statements" },
    noFile: { "zh-TW": "請選擇明細檔", en: "Choose a statement file" },
    tooLarge: { "zh-TW": "檔案太大（上限 5 MB）", en: "The file is too large (5 MB max)" },
    empty: { "zh-TW": "檔案是空的", en: "The file is empty" },
    missingColumns: {
      "zh-TW": "缺少必要欄位：{list}。請確認是永豐的明細匯出檔。",
      en: "Missing required columns: {list}. Make sure this is a SinoPac statement export.",
    },
    encoding: { "zh-TW": "讀不出文字編碼，請另存成 UTF-8 的 CSV 再上傳", en: "Couldn't read the text encoding; save it as a UTF-8 CSV and try again" },
    xlsx: { "zh-TW": "讀不了這個 Excel 檔，請另存成 CSV 再上傳", en: "Couldn't read this Excel file; save it as CSV and try again" },
    badMap: { "zh-TW": "帳戶對應格式不對", en: "Invalid account mapping" },
    failed: { "zh-TW": "匯入失敗", en: "Import failed" },
  },
} satisfies Dictionary;

export default bankImport;
