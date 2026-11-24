/** 測試用的 LedgerInputs：台灣科目表，科目 id = 範本順序 + 1。 */
import { TW_CHART } from "../jurisdictions/tw";
import type {
  FixedAsset,
  GlAccount,
  LedgerBankAccount,
  LedgerCategory,
  LedgerInputs,
  LedgerInvoice,
  LedgerTransaction,
  Posting,
  StoredEntry,
} from "../types";

export const ACCOUNTS: GlAccount[] = TW_CHART.map((t, i) => ({
  id: i + 1,
  code: t.code,
  name: t.name,
  nameEn: t.nameEn,
  type: t.type,
  section: t.section,
  cashFlow: t.cashFlow,
  systemKey: t.systemKey ?? null,
  isActive: true,
}));

export function gl(code: string): number {
  const a = ACCOUNTS.find((x) => x.code === code);
  if (!a) throw new Error(`no account ${code}`);
  return a.id;
}

export const CAT = { service: 1, rent: 2, fx: 3, supplies: 4, other: 5 } as const;
export const CATEGORIES: LedgerCategory[] = [
  { id: 1, name: "勞務收入", kind: "income", glAccountId: null },
  { id: 2, name: "租金支出", kind: "expense", glAccountId: null },
  { id: 3, name: "換匯", kind: "transfer", glAccountId: null },
  { id: 4, name: "辦公用品", kind: "expense", glAccountId: gl("6113") },
  { id: 5, name: "雜支", kind: "expense", glAccountId: null },
];

/** 1 永豐（政府）、2 Wise TWD（隱形）、3 Wise USD（隱形）、4 永豐外幣 USD（政府） */
export const BANK = { sinopac: 1, wiseTwd: 2, wiseUsd: 3, sinopacUsd: 4 } as const;
export const BANKS: LedgerBankAccount[] = [
  { id: 1, name: "永豐", kind: "bank", currency: "TWD", openingBalance: 0, ledgerScope: "government", glAccountId: null, isActive: true },
  { id: 2, name: "Wise TWD", kind: "wise", currency: "TWD", openingBalance: 0, ledgerScope: "management", glAccountId: null, isActive: true },
  { id: 3, name: "Wise USD", kind: "wise", currency: "USD", openingBalance: 0, ledgerScope: "management", glAccountId: null, isActive: true },
  { id: 4, name: "永豐外幣", kind: "bank", currency: "USD", openingBalance: 0, ledgerScope: "government", glAccountId: null, isActive: true },
];

let nextId = 1000;
export function tx(p: Partial<LedgerTransaction> & Pick<LedgerTransaction, "type" | "amount" | "txnDate">): LedgerTransaction {
  return {
    id: p.id ?? nextId++,
    book: "both",
    currency: "TWD",
    amountTwd: null,
    categoryId: null,
    fromAccountId: null,
    toAccountId: null,
    partyId: null,
    settleEmployeeId: null,
    relatedToId: null,
    invoiceId: null,
    description: null,
    ...p,
  };
}

export function invoice(p: Partial<LedgerInvoice> & Pick<LedgerInvoice, "id">): LedgerInvoice {
  return {
    direction: "issued",
    status: "valid",
    invoiceDate: "2026-03-10",
    invoiceNumber: `AB${p.id}`,
    amountNet: 10000,
    tax: 500,
    amountGross: 10500,
    taxTreatment: "taxable",
    foreignCurrency: null,
    partyId: null,
    ...p,
  };
}

export function asset(p: Partial<FixedAsset> & Pick<FixedAsset, "id">): FixedAsset {
  return {
    name: "筆電",
    acquiredOn: "2026-01-15",
    cost: 36000,
    salvageValue: 0,
    usefulLifeMonths: 36,
    assetAccountId: null,
    sourceTransactionId: null,
    disposedOn: null,
    ...p,
  };
}

export function inputs(p: Partial<Omit<LedgerInputs, "settings">> & { settings?: Partial<LedgerInputs["settings"]> } = {}): LedgerInputs {
  return {
    orgId: "org",
    orgName: "測試公司",
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    bankAccounts: BANKS,
    transactions: [],
    invoices: [],
    fxRates: [],
    entries: [],
    closedPeriods: [],
    fixedAssets: [],
    reconciliations: [],
    partyNames: {},
    employeeNames: {},
    ...p,
    settings: { ...defaultSettings(), ...(p.settings ?? {}) },
  };
}

function defaultSettings(): LedgerInputs["settings"] {
  return {
    jurisdiction: "TW",
    framework: "TW-EAS",
    vatRegime: "general",
    fiscalYearStartMonth: 1,
    functionalCurrency: "TWD",
    booksStartDate: null,
    openingEquityAccountId: null,
  };
}

/** 一張分錄的 { 科目代碼: 借 − 貸 }，方便斷言。 */
export function shape(p: Posting | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!p) return out;
  for (const l of p.lines) {
    const code = ACCOUNTS.find((a) => a.id === l.glAccountId)?.code ?? String(l.glAccountId);
    out[code] = Math.round(((out[code] ?? 0) + l.debit - l.credit) * 100) / 100;
  }
  return out;
}

export function snapshotEntry(id: number, posting: Posting, year: number, month: number): StoredEntry {
  return {
    id,
    ledger: posting.ledger,
    kind: "snapshot",
    entryDate: posting.date,
    memo: posting.memo,
    snapshotYear: year,
    snapshotMonth: month,
    sourceType: posting.sourceType,
    sourceId: posting.sourceId,
    lines: posting.lines.map((l) => ({
      glAccountId: l.glAccountId,
      debit: l.debit,
      credit: l.credit,
      currency: l.currency,
      fxAmount: l.fxAmount,
      partyId: l.partyId,
      employeeId: l.employeeId,
      memo: l.memo,
      bankAccountId: l.bankAccountId,
    })),
  };
}
