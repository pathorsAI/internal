/**
 * 總帳的資料契約（docs/general-ledger.md）。
 *
 * 分三層：
 *   1. LedgerInputs   從 DB 讀出來的原始資料（src/db/ledger.ts 的 loadLedgerInputs 負責）
 *   2. Posting        posting engine 產生的分錄（src/lib/ledger/post.ts、build.ts，純函式）
 *   3. Statement*     報表（src/lib/ledger/reports/*，純函式，只吃 Posting 與科目表）
 *
 * 這裡只有型別，client / server 都能 import。金額一律是 number（本位幣，四捨五入到小數 2 位）。
 */

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

/** 兩本帳：政府帳（給政府、會計師）與管理帳（全部，含隱形帳戶）。 */
export type LedgerKind = "government" | "management";
export const LEDGER_KINDS: readonly LedgerKind[] = ["government", "management"];

export type GlAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type CashFlowClass = "cash" | "operating" | "investing" | "financing" | "none";

/**
 * posting engine 一定要找得到的科目。科目表範本裡每個 key 剛好一個科目，組織自己的科目表
 * 也必須保留（gl_accounts.system_key）。
 */
export type SystemKey =
  | "bank_local" // 本位幣銀行存款（帳戶沒指定科目時的預設）
  | "bank_foreign" // 外幣存款
  | "ar" // 應收帳款
  | "other_receivable" // 其他應收款
  | "input_vat" // 進項稅額
  | "fixed_asset" // 財產（沒指定科目時）
  | "accumulated_depreciation" // 累計折舊
  | "output_vat" // 銷項稅額
  | "employee_payable" // 其他應付款－員工代墊
  | "unpaid_clearing" // 其他應付款－未付現（交易沒綁帳戶時的對方科目）
  | "shareholder" // 股東往來（政府帳上不屬政府帳的那一側）
  | "capital" // 股本（預設的期初餘額對方科目）
  | "retained_earnings" // 未分配盈餘（累積虧損）
  | "uncategorized_income" // 待分類收入
  | "uncategorized_expense" // 待分類費用
  | "fx_gain_loss" // 外幣兌換損益（營業外，淨額）
  | "bank_fee" // 手續費
  | "depreciation_expense"; // 折舊

export type GlAccount = {
  id: number;
  code: string;
  name: string;
  nameEn: string | null;
  type: GlAccountType;
  /** 報表區塊，值由國家模組定義（JurisdictionModule.sections）。 */
  section: string;
  cashFlow: CashFlowClass;
  systemKey: SystemKey | null;
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// 1. 輸入
// ---------------------------------------------------------------------------

export type VatRegime = "general" | "small_scale" | "none";

export type AccountingSettings = {
  jurisdiction: string; // 'TW'
  framework: string; // 'TW-EAS'
  vatRegime: VatRegime;
  fiscalYearStartMonth: number; // 1–12
  functionalCurrency: string; // 'TWD'
  /** 總帳起始日（含）。NULL = 最早一筆交易日。之前的交易併進期初餘額。 */
  booksStartDate: string | null;
  /** 帳戶期初餘額的對方科目。NULL = capital。 */
  openingEquityAccountId: number | null;
};

export type LedgerCategory = {
  id: number;
  name: string;
  kind: string; // income | cogs | expense | non_operating | transfer | equity
  glAccountId: number | null;
};

export type LedgerBankAccount = {
  id: number;
  name: string;
  kind: string; // bank | wise | other | …
  currency: string;
  openingBalance: number; // 原幣
  ledgerScope: LedgerKind; // 'government' = 政府看得到；'management' = 隱形帳戶
  glAccountId: number | null;
  isActive: boolean;
};

export type LedgerTransaction = {
  id: number;
  txnDate: string; // YYYY-MM-DD
  type: "expense" | "income" | "advance" | "reimbursement" | "transfer";
  book: "both" | "internal" | "external";
  amount: number; // 原幣，正數
  currency: string;
  amountTwd: number | null; // 本位幣；NULL 時用 fx_rates 換算
  categoryId: number | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  partyId: number | null;
  settleEmployeeId: number | null;
  relatedToId: number | null;
  invoiceId: number | null;
  description: string | null;
};

export type LedgerInvoice = {
  id: number;
  direction: "issued" | "received";
  status: "valid" | "void" | "allowance";
  invoiceDate: string | null;
  invoiceNumber: string | null;
  amountNet: number | null; // 本位幣
  tax: number | null;
  amountGross: number | null;
  taxTreatment: "taxable" | "zero_rated" | "exempt";
  foreignCurrency: string | null;
  partyId: number | null;
};

export type FxRate = { currency: string; date: string; rate: number };

export type StoredLine = {
  glAccountId: number;
  debit: number;
  credit: number;
  currency: string | null;
  fxAmount: number | null;
  partyId: number | null;
  employeeId: number | null;
  memo: string | null;
};

/** 手動分錄（期初、調整、年結）。ledger = 'both' 兩本帳都有。 */
export type StoredEntry = {
  id: number;
  ledger: LedgerKind | "both";
  kind: "manual" | "opening" | "adjustment" | "snapshot";
  entryDate: string;
  memo: string | null;
  /** 快照才有 */
  snapshotYear: number | null;
  snapshotMonth: number | null;
  sourceType: SourceType | null;
  sourceId: number | null;
  lines: StoredLine[];
};

export type FixedAsset = {
  id: number;
  name: string;
  acquiredOn: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  assetAccountId: number | null;
  sourceTransactionId: number | null;
  disposedOn: string | null;
};

export type Reconciliation = { accountId: number; asOfDate: string; statementBalance: number };

export type LedgerInputs = {
  orgId: string;
  orgName: string;
  settings: AccountingSettings;
  accounts: GlAccount[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  transactions: LedgerTransaction[]; // 未刪除的
  invoices: LedgerInvoice[]; // 未刪除的
  fxRates: FxRate[];
  /** 手動分錄與結帳快照（未刪除的）。 */
  entries: StoredEntry[];
  /** 已結帳的月份，'YYYY-MM'。 */
  closedPeriods: string[];
  fixedAssets: FixedAsset[];
  reconciliations: Reconciliation[];
  /** 顯示用名稱 */
  partyNames: Record<number, string>;
  employeeNames: Record<number, string>;
};

// ---------------------------------------------------------------------------
// 2. 分錄
// ---------------------------------------------------------------------------

export type SourceType =
  | "transaction"
  | "invoice"
  | "opening" // 帳戶期初餘額（engine 產生）
  | "depreciation"
  | "fx_revaluation"
  | "manual"; // 手動分錄

export type PostingLine = {
  glAccountId: number;
  debit: number;
  credit: number;
  /** 外幣原幣（借正貸負）；本位幣行為 null */
  currency: string | null;
  fxAmount: number | null;
  /** 子帳：哪個交易對象／員工／銀行帳戶 */
  partyId: number | null;
  employeeId: number | null;
  bankAccountId: number | null;
  memo: string | null;
};

export type Posting = {
  /** 穩定的鍵：`${sourceType}:${sourceId}:${ledger}[:suffix]`，下鑽與快照比對用 */
  key: string;
  ledger: LedgerKind;
  date: string;
  sourceType: SourceType;
  sourceId: number | null;
  memo: string;
  /** 這張是結帳快照讀出來的（不是即時算的） */
  fromSnapshot: boolean;
  lines: PostingLine[];
};

/** 需要人處理的資料問題（待處理清單）。 */
export type ReviewItem = {
  code:
    | "uncategorized" // 沒分類，記到待分類科目
    | "missing_fx" // 外幣沒有台幣金額也找不到匯率，這筆沒入帳
    | "fx_estimated" // 用最近一筆匯率推估
    | "invoice_unlinked" // 開了發票但沒綁收款，收入以收款認列、發票沒入帳
    | "ar_residual" // 發票與收款差額沒沖完
    | "shareholder_plug" // 政府帳上用股東往來沖轉（資訊，不一定是錯）
    | "unmapped_default" // 分類／帳戶用預設科目（資訊）
    | "opening_balance" // 期初餘額已記到期初權益科目（資訊）
    | "fx_transfer_one_sided"; // 分類是換匯，但只有一邊
  severity: "error" | "warning" | "info";
  ledger: LedgerKind | "both";
  sourceType: SourceType;
  sourceId: number | null;
  date: string | null;
  amount: number | null;
  /** 給畫面組字串用的參數（不放已翻譯的文字） */
  params: Record<string, string | number>;
};

export type BuildOptions = {
  ledger: LedgerKind;
  /** 只產生 date <= asOf 的分錄（含期初、折舊、外幣評價到這天）。 */
  asOf: string;
};

export type BuildResult = {
  postings: Posting[];
  review: ReviewItem[];
};

// ---------------------------------------------------------------------------
// 3. 報表
// ---------------------------------------------------------------------------

export type Period = { from: string; to: string };

export type StatementRow = {
  key: string;
  kind: "header" | "account" | "subtotal" | "total";
  /** i18n key（header／subtotal／total）或科目名稱（account） */
  label: string;
  code: string | null;
  glAccountId: number | null;
  level: number;
  amount: number;
  compareAmount: number | null;
};

export type Statement = {
  kind: "balance_sheet" | "income_statement" | "cash_flow" | "equity_changes" | "trial_balance";
  ledger: LedgerKind;
  period: Period;
  comparePeriod: Period | null;
  rows: StatementRow[];
};

export type TrialBalanceRow = {
  glAccountId: number;
  code: string;
  name: string;
  type: GlAccountType;
  opening: number; // 借正貸負
  debit: number;
  credit: number;
  closing: number; // 借正貸負
};

export type EquityChangesRow = {
  key: "opening" | "net_income" | "capital" | "other" | "closing";
  capital: number;
  retained: number;
  other: number;
  total: number;
};

export type VatPeriodRow = {
  label: string; // '2026-05/06'
  from: string;
  to: string;
  /** 依發票 */
  invoiceTaxableNet: number;
  invoiceZeroRatedNet: number;
  invoiceExemptNet: number;
  invoiceOutputTax: number;
  invoiceInputTax: number;
  /** 依總帳 */
  glRevenue: number;
  glOutputTax: number;
  glInputTax: number;
  /** 一般營業人：銷項 − 進項；小規模：查定稅額推估 */
  taxDue: number;
  /** 發票銷售額與總帳收入差多少（> 1 元就該看） */
  difference: number;
};

export type Check = {
  code: "entries_balanced" | "balance_sheet_balances" | "bank_reconciliation" | "employee_subledger" | "ar_open";
  status: "pass" | "warn" | "fail";
  params: Record<string, string | number>;
};

export type LedgerLine = {
  date: string;
  postingKey: string;
  sourceType: SourceType;
  sourceId: number | null;
  memo: string;
  debit: number;
  credit: number;
  balance: number; // 借正貸負，累計
  counterAccounts: string[]; // 對方科目代碼
};
