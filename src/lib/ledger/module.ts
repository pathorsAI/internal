/**
 * 國家模組介面（docs/general-ledger.md「國家模組」）。
 *
 * 模組只交資料與純函式，不碰資料庫：科目表範本、預設對應、報表區塊與排列、營業稅規則。
 * 核心（posting engine、報表計算、結帳）各國共用。新增一個國家 = 新增一個檔案＋在 registry 註冊。
 */
import type { CashFlowClass, GlAccountType, LedgerBankAccount, LedgerCategory, SystemKey, VatRegime } from "./types";

export type AccountTemplate = {
  code: string;
  name: string;
  nameEn: string;
  type: GlAccountType;
  section: string;
  cashFlow: CashFlowClass;
  systemKey?: SystemKey;
};

/** 報表上一個區塊。sign = 1 表示借方餘額為正（資產、費用），-1 表示貸方餘額為正（負債、權益、收入）。 */
export type SectionDef = {
  key: string;
  statement: "balance_sheet" | "income_statement";
  sign: 1 | -1;
  /** i18n key，在 statements.sections.<key> */
  order: number;
};

/** 損益表的小計：哪些區塊相加（帶 sign 後）。 */
export type SubtotalDef = { key: string; after: string; sum: string[] };

export type VatRule = {
  regime: VatRegime;
  /** 申報期幾個月一期（台灣一般營業人 2、小規模 3） */
  periodMonths: number;
  /** 小規模：查定稅率；一般：標準稅率 */
  rate: number;
  /** 小規模：進項稅額可扣減比例（台灣 10%） */
  inputCreditRatio: number;
};

export type JurisdictionModule = {
  code: string; // 'TW'
  frameworks: { code: string; label: string }[];
  defaultFramework: string;
  functionalCurrency: string;
  defaultFiscalYearStartMonth: number;
  chartTemplate: AccountTemplate[];
  sections: SectionDef[];
  incomeSubtotals: SubtotalDef[];
  vatRules: Record<VatRegime, VatRule | null>;
  /** 分類沒指定科目時的預設科目代碼 */
  defaultCategoryCode(category: Pick<LedgerCategory, "name" | "kind">): string;
  /** 銀行帳戶沒指定科目時的預設科目代碼 */
  defaultBankAccountCode(account: Pick<LedgerBankAccount, "name" | "kind" | "currency">, functionalCurrency: string): string;
};
