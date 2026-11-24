/**
 * 報表上「不是科目名稱」的列用的 i18n key（StatementRow.label）。UI 照這份補翻譯。
 *
 * 規則：
 *   - kind = header              → `sections.<sectionKey>`（區塊名稱，sectionKey 來自國家模組 sections）
 *   - kind = subtotal（區塊合計） → `section_totals.<sectionKey>`
 *   - kind = subtotal（模組小計） → `subtotals.<subtotalKey>`（模組 incomeSubtotals；涵蓋全部損益區塊的那個是 kind = total）
 *   - kind = total               → `totals.*`
 *   - kind = account 且 glAccountId = null → 計算列，label 是 i18n key（`rows.*`、`cf.*`）
 *   - kind = account 且 glAccountId ≠ null → label 是科目名稱，不用翻譯
 *
 * 權益變動表的列 key（EquityChangesRow.key）與欄位：`equity.<key>`、`equity.columns.<col>`。
 * 檢查（Check.code）與待處理（ReviewItem.code）直接用型別上的 code，UI 自己對 `checks.<code>`、`review.<code>`。
 */
export const LEDGER_LABEL_KEYS: string[] = [
  // 區塊（台灣模組；其他國家模組的 sections 也照 `sections.<key>`）
  "sections.current_assets",
  "sections.noncurrent_assets",
  "sections.current_liabilities",
  "sections.noncurrent_liabilities",
  "sections.equity",
  "sections.operating_revenue",
  "sections.operating_cost",
  "sections.operating_expense",
  "sections.non_operating",
  "sections.income_tax",
  // 區塊合計
  "section_totals.current_assets",
  "section_totals.noncurrent_assets",
  "section_totals.current_liabilities",
  "section_totals.noncurrent_liabilities",
  "section_totals.equity",
  "section_totals.operating_revenue",
  "section_totals.operating_cost",
  "section_totals.operating_expense",
  "section_totals.non_operating",
  "section_totals.income_tax",
  // 損益表小計（台灣模組 incomeSubtotals）
  "subtotals.gross_profit",
  "subtotals.operating_income",
  "subtotals.pre_tax_income",
  "subtotals.net_income",
  // 資產負債表合計
  "totals.assets",
  "totals.liabilities",
  "totals.equity",
  "totals.liabilities_equity",
  // 模組沒有涵蓋全部損益區塊的小計時才出現
  "totals.net_income",
  // 資產負債表權益區的計算列
  "rows.prior_earnings",
  "rows.current_earnings",
  // 現金流量表（間接法）
  "cf.operating",
  "cf.net_income",
  "cf.depreciation",
  "cf.unrealized_fx",
  "cf.operating_total",
  "cf.investing",
  "cf.investing_total",
  "cf.financing",
  "cf.financing_total",
  "cf.fx_effect",
  "cf.net_change",
  "cf.opening_cash",
  "cf.closing_cash",
  // 權益變動表
  "equity.opening",
  "equity.net_income",
  "equity.capital",
  "equity.other",
  "equity.closing",
  "equity.columns.capital",
  "equity.columns.retained",
  "equity.columns.other",
  "equity.columns.total",
];
