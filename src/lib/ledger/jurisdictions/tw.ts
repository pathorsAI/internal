/**
 * 台灣模組：商業會計法、商業會計處理準則、企業會計準則公報（EAS，非公開發行公司）。
 *
 * 科目代碼沿用一般行業常見的四碼（1 資產、2 負債、3 權益、4 營業收入、5 營業成本、6 營業費用、
 * 7 營業外收益及費損、8 所得稅）。這是範本，組織可以在設定頁增改；system_key 那幾個不能刪。
 *
 * 營業稅：一般營業人 5%、雙月一期（401）；小規模營業人由國稅局查定，1%、每季一期，
 * 取得的進項稅額 10% 可扣減查定稅額（營業稅法第 25 條）。
 */
import type { AccountTemplate, JurisdictionModule } from "../module";

const A = (
  code: string,
  name: string,
  nameEn: string,
  type: AccountTemplate["type"],
  section: string,
  cashFlow: AccountTemplate["cashFlow"],
  systemKey?: AccountTemplate["systemKey"],
): AccountTemplate => ({ code, name, nameEn, type, section, cashFlow, ...(systemKey ? { systemKey } : {}) });

export const TW_CHART: AccountTemplate[] = [
  // 1 資產
  A("1111", "庫存現金", "Cash on hand", "asset", "current_assets", "cash"),
  A("1113", "銀行存款", "Cash in banks", "asset", "current_assets", "cash", "bank_local"),
  A("1114", "外幣存款", "Foreign currency deposits", "asset", "current_assets", "cash", "bank_foreign"),
  A("1170", "應收帳款", "Accounts receivable", "asset", "current_assets", "operating", "ar"),
  A("1190", "其他應收款", "Other receivables", "asset", "current_assets", "operating", "other_receivable"),
  A("1250", "預付費用", "Prepaid expenses", "asset", "current_assets", "operating"),
  A("1268", "進項稅額", "Input VAT", "asset", "current_assets", "operating", "input_vat"),
  A("1269", "留抵稅額", "VAT credit carried forward", "asset", "current_assets", "operating"),
  A("1681", "辦公設備", "Office equipment", "asset", "noncurrent_assets", "investing", "fixed_asset"),
  A("1689", "累計折舊－辦公設備", "Accumulated depreciation", "asset", "noncurrent_assets", "operating", "accumulated_depreciation"),
  A("1920", "存出保證金", "Refundable deposits", "asset", "noncurrent_assets", "investing"),
  // 2 負債
  A("2170", "應付帳款", "Accounts payable", "liability", "current_liabilities", "operating"),
  A("2191", "應付薪資", "Salaries payable", "liability", "current_liabilities", "operating"),
  A("2193", "應付費用", "Accrued expenses", "liability", "current_liabilities", "operating"),
  A("2204", "銷項稅額", "Output VAT", "liability", "current_liabilities", "operating", "output_vat"),
  A("2205", "應付營業稅", "VAT payable", "liability", "current_liabilities", "operating"),
  A("2241", "代收款", "Withholdings payable", "liability", "current_liabilities", "operating"),
  A("2281", "其他應付款－員工代墊", "Due to employees (advances)", "liability", "current_liabilities", "operating", "employee_payable"),
  A("2282", "其他應付款－未付現", "Other payables (non-cash)", "liability", "current_liabilities", "operating", "unpaid_clearing"),
  A("2295", "股東往來", "Due to shareholders", "liability", "current_liabilities", "financing", "shareholder"),
  A("2311", "長期借款", "Long-term borrowings", "liability", "noncurrent_liabilities", "financing"),
  // 3 權益
  A("3110", "普通股股本", "Share capital", "equity", "equity", "financing", "capital"),
  A("3211", "資本公積", "Capital surplus", "equity", "equity", "financing"),
  A("3350", "未分配盈餘（累積虧損）", "Retained earnings", "equity", "equity", "none", "retained_earnings"),
  // 4 營業收入
  A("4111", "銷貨收入", "Sales revenue", "revenue", "operating_revenue", "operating"),
  A("4611", "勞務收入", "Service revenue", "revenue", "operating_revenue", "operating"),
  A("4888", "其他營業收入", "Other operating revenue", "revenue", "operating_revenue", "operating"),
  A("4999", "待分類收入", "Uncategorized income", "revenue", "operating_revenue", "operating", "uncategorized_income"),
  // 5 營業成本
  A("5111", "銷貨成本", "Cost of goods sold", "expense", "operating_cost", "operating"),
  A("5611", "勞務成本", "Cost of services", "expense", "operating_cost", "operating"),
  // 6 營業費用
  A("6111", "薪資支出", "Salaries", "expense", "operating_expense", "operating"),
  A("6112", "租金支出", "Rent", "expense", "operating_expense", "operating"),
  A("6113", "文具用品", "Office supplies", "expense", "operating_expense", "operating"),
  A("6114", "旅費", "Travel", "expense", "operating_expense", "operating"),
  A("6116", "郵電費", "Postage and telecom", "expense", "operating_expense", "operating"),
  A("6117", "修繕費", "Repairs", "expense", "operating_expense", "operating"),
  A("6118", "廣告費", "Advertising", "expense", "operating_expense", "operating"),
  A("6119", "水電瓦斯費", "Utilities", "expense", "operating_expense", "operating"),
  A("6120", "保險費", "Insurance", "expense", "operating_expense", "operating"),
  A("6121", "交際費", "Entertainment", "expense", "operating_expense", "operating"),
  A("6123", "稅捐", "Taxes and dues", "expense", "operating_expense", "operating"),
  A("6124", "呆帳損失", "Bad debts", "expense", "operating_expense", "operating"),
  A("6125", "折舊", "Depreciation", "expense", "operating_expense", "operating", "depreciation_expense"),
  A("6127", "伙食費", "Meals", "expense", "operating_expense", "operating"),
  A("6128", "職工福利", "Employee benefits", "expense", "operating_expense", "operating"),
  A("6129", "佣金支出", "Commissions", "expense", "operating_expense", "operating"),
  A("6131", "勞務費", "Professional fees", "expense", "operating_expense", "operating"),
  A("6132", "手續費", "Bank charges", "expense", "operating_expense", "operating", "bank_fee"),
  A("6135", "雜項購置", "Sundry purchases", "expense", "operating_expense", "operating"),
  A("6188", "其他費用", "Other expenses", "expense", "operating_expense", "operating"),
  A("6999", "待分類費用", "Uncategorized expense", "expense", "operating_expense", "operating", "uncategorized_expense"),
  // 7 營業外收益及費損
  A("7111", "利息收入", "Interest income", "revenue", "non_operating", "operating"),
  A("7121", "投資收益", "Investment income", "revenue", "non_operating", "operating"),
  A("7130", "外幣兌換損益", "Foreign exchange gain (loss)", "revenue", "non_operating", "operating", "fx_gain_loss"),
  A("7480", "其他收入", "Other income", "revenue", "non_operating", "operating"),
  A("7510", "利息費用", "Interest expense", "expense", "non_operating", "operating"),
  A("7621", "投資損失", "Investment loss", "expense", "non_operating", "operating"),
  A("7880", "其他損失", "Other losses", "expense", "non_operating", "operating"),
  // 8 所得稅
  A("8110", "所得稅費用", "Income tax expense", "expense", "income_tax", "operating"),
];

/**
 * 分類名稱 → 科目代碼。派斯的分類本來就用會計項目名稱，對得上就直接用；對不上退回 kind 的預設。
 * 比對是「名稱包含關鍵字」，依序找第一個符合的。
 */
const NAME_RULES: [RegExp, string][] = [
  [/抵用點數/, "7480"],
  [/換匯|幣別轉換/, "7130"],
  [/利息收入/, "7111"],
  [/投資收入|投資收益/, "7121"],
  [/投資損失/, "7621"],
  [/利息費用/, "7510"],
  [/銷貨成本/, "5111"],
  [/勞務成本|設計成本|技術服務成本/, "5611"],
  [/銷貨收入/, "4111"],
  [/其他營業收入|其他勞務收入/, "4888"],
  [/勞務收入|設計收入|技術服務收入/, "4611"],
  [/薪資/, "6111"],
  [/租金/, "6112"],
  [/文具|辦公用品/, "6113"],
  [/差旅|旅費|油資|交通/, "6114"],
  [/郵寄|郵電|電話|網路/, "6116"],
  [/修繕/, "6117"],
  [/廣告|推銷|行銷/, "6118"],
  [/水電|瓦斯/, "6119"],
  [/保險/, "6120"],
  [/交際/, "6121"],
  [/稅費|稅捐|規費/, "6123"],
  [/呆帳/, "6124"],
  [/折舊/, "6125"],
  [/伙食|餐費/, "6127"],
  [/福利/, "6128"],
  [/佣金/, "6129"],
  [/勞務費|顧問|會計師|律師/, "6131"],
  [/手續費|銀行費用|財務費用/, "6132"],
  [/設備|雜項購置/, "6135"],
];

const KIND_DEFAULTS: Record<string, string> = {
  income: "4888",
  cogs: "5611",
  expense: "6188",
  non_operating: "7480",
  transfer: "7130",
  equity: "3110",
};

export const tw: JurisdictionModule = {
  code: "TW",
  frameworks: [
    { code: "TW-EAS", label: "企業會計準則公報（EAS）" },
    { code: "TW-IFRS", label: "TIFRS（國際財務報導準則）" },
  ],
  defaultFramework: "TW-EAS",
  functionalCurrency: "TWD",
  defaultFiscalYearStartMonth: 1,
  chartTemplate: TW_CHART,
  sections: [
    { key: "current_assets", statement: "balance_sheet", sign: 1, order: 1 },
    { key: "noncurrent_assets", statement: "balance_sheet", sign: 1, order: 2 },
    { key: "current_liabilities", statement: "balance_sheet", sign: -1, order: 3 },
    { key: "noncurrent_liabilities", statement: "balance_sheet", sign: -1, order: 4 },
    { key: "equity", statement: "balance_sheet", sign: -1, order: 5 },
    { key: "operating_revenue", statement: "income_statement", sign: -1, order: 1 },
    { key: "operating_cost", statement: "income_statement", sign: 1, order: 2 },
    { key: "operating_expense", statement: "income_statement", sign: 1, order: 3 },
    { key: "non_operating", statement: "income_statement", sign: -1, order: 4 },
    { key: "income_tax", statement: "income_statement", sign: 1, order: 5 },
  ],
  incomeSubtotals: [
    { key: "gross_profit", after: "operating_cost", sum: ["operating_revenue", "-operating_cost"] },
    { key: "operating_income", after: "operating_expense", sum: ["operating_revenue", "-operating_cost", "-operating_expense"] },
    { key: "pre_tax_income", after: "non_operating", sum: ["operating_revenue", "-operating_cost", "-operating_expense", "non_operating"] },
    { key: "net_income", after: "income_tax", sum: ["operating_revenue", "-operating_cost", "-operating_expense", "non_operating", "-income_tax"] },
  ],
  vatRules: {
    general: { regime: "general", periodMonths: 2, rate: 0.05, inputCreditRatio: 1 },
    small_scale: { regime: "small_scale", periodMonths: 3, rate: 0.01, inputCreditRatio: 0.1 },
    none: null,
  },
  defaultCategoryCode(category) {
    for (const [re, code] of NAME_RULES) if (re.test(category.name)) return code;
    return KIND_DEFAULTS[category.kind] ?? "6188";
  },
  defaultBankAccountCode(account, functionalCurrency) {
    if (/股東|業主/.test(account.name)) return "2295";
    if (account.kind === "other" || /待撥|在途/.test(account.name)) return "1190";
    return account.currency === functionalCurrency ? "1113" : "1114";
  },
};
