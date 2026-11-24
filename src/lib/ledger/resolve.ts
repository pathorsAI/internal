/**
 * 科目解析與 build 共用的查表（docs/general-ledger.md §2.1）。
 * 找不到科目一律退回 system key，不丟例外：報表寧可把錢放在待分類，也不要整頁壞掉。
 */
import { FxTable } from "./fx";
import { getJurisdiction } from "./jurisdictions";
import { compareStrings } from "./periods";
import type { JurisdictionModule, SectionDef } from "./module";
import type {
  FixedAsset,
  GlAccount,
  GlAccountType,
  LedgerBankAccount,
  LedgerCategory,
  LedgerInputs,
  LedgerInvoice,
  LedgerTransaction,
  PostingLine,
  SystemKey,
} from "./types";

/** system key 在組織科目表裡不見時的替代順序。 */
const SYS_FALLBACK: Partial<Record<SystemKey, SystemKey[]>> = {
  bank_foreign: ["bank_local"],
  other_receivable: ["ar"],
  fixed_asset: ["other_receivable"],
  uncategorized_income: ["fx_gain_loss"],
  bank_fee: ["uncategorized_expense"],
  depreciation_expense: ["uncategorized_expense"],
  retained_earnings: ["capital"],
};
const SYS_TYPE: Record<SystemKey, GlAccountType> = {
  bank_local: "asset",
  bank_foreign: "asset",
  ar: "asset",
  other_receivable: "asset",
  input_vat: "asset",
  fixed_asset: "asset",
  accumulated_depreciation: "asset",
  output_vat: "liability",
  employee_payable: "liability",
  unpaid_clearing: "liability",
  shareholder: "liability",
  capital: "equity",
  retained_earnings: "equity",
  uncategorized_income: "revenue",
  uncategorized_expense: "expense",
  fx_gain_loss: "revenue",
  bank_fee: "expense",
  depreciation_expense: "expense",
};

/** 分類沒對到科目時的退路：換匯 → 兌換損益；收入 → 待分類收入；其他 → 待分類費用。 */
function uncategorizedKey(kind: string): SystemKey {
  if (kind === "transfer") return "fx_gain_loss";
  if (kind === "income") return "uncategorized_income";
  return "uncategorized_expense";
}

export type Mapping = { glAccountId: number; isDefault: boolean };

export type Ctx = {
  inputs: LedgerInputs;
  module: JurisdictionModule;
  functional: string;
  fx: FxTable;
  accounts: Map<number, GlAccount>;
  byCode: Map<string, GlAccount>;
  categories: Map<number, LedgerCategory>;
  banks: Map<number, LedgerBankAccount>;
  invoices: Map<number, LedgerInvoice>;
  txns: Map<number, LedgerTransaction>;
  assetsBySourceTxn: Map<number, FixedAsset>;
  /** 總帳起始日（含）；null = 沒有任何交易 */
  booksStart: string | null;
  openingEquityId: number;
  sys(key: SystemKey): number;
  categoryAccount(cat: LedgerCategory): Mapping;
  bankAccountGl(bank: LedgerBankAccount): Mapping;
  /** 科目所屬的模組區塊（科目的 section 模組沒定義時依 type 歸到第一個合適的區塊）。 */
  sectionOf(glAccountId: number): SectionDef | null;
  isPL(glAccountId: number): boolean;
};

export function createCtx(inputs: LedgerInputs): Ctx {
  const jm = getJurisdiction(inputs.settings.jurisdiction);
  const functional = (inputs.settings.functionalCurrency || jm.functionalCurrency).toUpperCase();
  const accounts = new Map(inputs.accounts.map((a) => [a.id, a]));
  const byCode = new Map(inputs.accounts.map((a) => [a.code, a]));
  const bySys = new Map<SystemKey, number>();
  for (const a of inputs.accounts) if (a.systemKey && !bySys.has(a.systemKey)) bySys.set(a.systemKey, a.id);

  const sysCache = new Map<SystemKey, number>();
  const sys = (key: SystemKey): number => {
    const cached = sysCache.get(key);
    if (cached != null) return cached;
    let id = bySys.get(key);
    for (const alt of SYS_FALLBACK[key] ?? []) id ??= bySys.get(alt);
    id ??= inputs.accounts.find((a) => a.type === SYS_TYPE[key])?.id;
    const result = id ?? -1;
    sysCache.set(key, result);
    return result;
  };

  const categoryAccount = (cat: LedgerCategory): Mapping => {
    if (cat.glAccountId != null && accounts.has(cat.glAccountId)) return { glAccountId: cat.glAccountId, isDefault: false };
    const byDefault = byCode.get(jm.defaultCategoryCode(cat));
    if (byDefault) return { glAccountId: byDefault.id, isDefault: true };
    return { glAccountId: sys(uncategorizedKey(cat.kind)), isDefault: true };
  };

  const bankAccountGl = (bank: LedgerBankAccount): Mapping => {
    if (bank.glAccountId != null && accounts.has(bank.glAccountId)) return { glAccountId: bank.glAccountId, isDefault: false };
    const byDefault = byCode.get(jm.defaultBankAccountCode(bank, functional));
    if (byDefault) return { glAccountId: byDefault.id, isDefault: true };
    return { glAccountId: sys(bank.currency.toUpperCase() === functional ? "bank_local" : "bank_foreign"), isDefault: true };
  };

  const sectionDefs = new Map(jm.sections.map((s) => [s.key, s]));
  const ordered = [...jm.sections].sort((a, b) => a.order - b.order);
  const equitySection = equitySectionKey(inputs.accounts, sectionDefs);
  const fallbackSection = (type: GlAccountType): SectionDef | null => {
    if (type === "equity" && equitySection) return sectionDefs.get(equitySection) ?? null;
    const statement = type === "revenue" || type === "expense" ? "income_statement" : "balance_sheet";
    const sign = type === "asset" || type === "expense" ? 1 : -1;
    return ordered.find((s) => s.statement === statement && s.sign === sign && s.key !== equitySection) ?? null;
  };
  const sectionCache = new Map<number, SectionDef | null>();
  const sectionOf = (id: number): SectionDef | null => {
    if (sectionCache.has(id)) return sectionCache.get(id) ?? null;
    const a = accounts.get(id);
    const s = a ? (sectionDefs.get(a.section) ?? fallbackSection(a.type)) : null;
    sectionCache.set(id, s);
    return s;
  };

  const txnDates = inputs.transactions.map((t) => t.txnDate.slice(0, 10)).sort(compareStrings);
  const booksStart = inputs.settings.booksStartDate?.slice(0, 10) ?? txnDates[0] ?? null;

  const assetsBySourceTxn = new Map<number, FixedAsset>();
  for (const fa of inputs.fixedAssets) if (fa.sourceTransactionId != null) assetsBySourceTxn.set(fa.sourceTransactionId, fa);

  const oe = inputs.settings.openingEquityAccountId;
  return {
    inputs,
    module: jm,
    functional,
    fx: new FxTable(inputs.fxRates, functional),
    accounts,
    byCode,
    categories: new Map(inputs.categories.map((c) => [c.id, c])),
    banks: new Map(inputs.bankAccounts.map((b) => [b.id, b])),
    invoices: new Map(inputs.invoices.map((i) => [i.id, i])),
    txns: new Map(inputs.transactions.map((t) => [t.id, t])),
    assetsBySourceTxn,
    booksStart,
    openingEquityId: oe != null && accounts.has(oe) ? oe : sys("capital"),
    sys,
    categoryAccount,
    bankAccountGl,
    sectionOf,
    isPL: (id) => sectionOf(id)?.statement === "income_statement",
  };
}

/** 權益區塊：放 retained_earnings／capital 的那個區塊（核心不寫死 'equity'）。 */
export function equitySectionKey(accounts: GlAccount[], sections: Map<string, SectionDef>): string | null {
  const pick = (pred: (a: GlAccount) => boolean) => accounts.find((a) => pred(a) && sections.has(a.section))?.section ?? null;
  return pick((a) => a.systemKey === "retained_earnings") ?? pick((a) => a.systemKey === "capital") ?? pick((a) => a.type === "equity");
}

export function line(glAccountId: number, amount: number, extra: Partial<PostingLine> = {}): PostingLine {
  return {
    glAccountId,
    debit: Math.max(amount, 0),
    credit: Math.max(-amount, 0),
    currency: null,
    fxAmount: null,
    partyId: null,
    employeeId: null,
    bankAccountId: null,
    memo: null,
    ...extra,
  };
}
