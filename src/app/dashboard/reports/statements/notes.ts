/**
 * 附註（台灣財報慣例的骨架）：公司沿革、重要會計政策、現金明細、應收帳款明細、員工代墊、
 * 股東往來、不動產廠房設備。數字一律從分錄算（BuildResult.postings，已經只到 asOf），
 * 跟四大報表同一個來源。純函式。
 */
import { getJurisdiction } from "@/lib/ledger/jurisdictions";
import type { BuildResult, LedgerInputs, LedgerKind, SystemKey } from "@/lib/ledger/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type NotesData = {
  orgName: string;
  ledger: LedgerKind;
  asOf: string;
  framework: string;
  functionalCurrency: string;
  fiscalYearStartMonth: number;
  booksStartDate: string | null;
  cash: { bankAccountId: number; name: string; currency: string; fxBalance: number | null; balance: number }[];
  cashTotal: number;
  receivables: { partyId: number | null; name: string | null; balance: number }[];
  receivablesTotal: number;
  employeeAdvances: { employeeId: number | null; name: string | null; balance: number }[];
  employeeAdvancesTotal: number;
  /** 貸方餘額為正（公司欠股東） */
  shareholderBalance: number;
  /** 政府帳上用股東往來沖轉的分錄張數 */
  shareholderEntries: number;
  fixedAssets: {
    id: number;
    name: string;
    acquiredOn: string;
    usefulLifeMonths: number;
    cost: number;
    accumulated: number;
    net: number;
    disposedOn: string | null;
  }[];
  fixedAssetTotals: { cost: number; accumulated: number; net: number };
};

export function buildNotes(inputs: LedgerInputs, built: BuildResult, ledger: LedgerKind, asOf: string): NotesData {
  const idOf = (key: SystemKey) => inputs.accounts.find((a) => a.systemKey === key)?.id ?? null;
  const arId = idOf("ar");
  const employeeId = idOf("employee_payable");
  const shareholderId = idOf("shareholder");
  const accumulatedId = idOf("accumulated_depreciation");

  const cashAccountIds = new Set(inputs.accounts.filter((a) => a.cashFlow === "cash").map((a) => a.id));
  const bank = new Map<number, { balance: number; fx: number; hasFx: boolean }>();
  const ar = new Map<number | null, number>();
  const emp = new Map<number | null, number>();
  let shareholder = 0;
  let shareholderEntries = 0;
  const accumulatedByAsset = new Map<number, number>();
  const assetPostings = new Set<string>();

  for (const p of built.postings) {
    if (p.ledger !== ledger || p.date > asOf) continue;
    let touchesShareholder = false;
    for (const l of p.lines) {
      const net = l.debit - l.credit;
      if (l.bankAccountId !== null && cashAccountIds.has(l.glAccountId)) {
        const cur = bank.get(l.bankAccountId) ?? { balance: 0, fx: 0, hasFx: false };
        cur.balance += net;
        if (l.fxAmount !== null) {
          cur.fx += l.fxAmount;
          cur.hasFx = true;
        }
        bank.set(l.bankAccountId, cur);
      }
      if (l.glAccountId === arId) ar.set(l.partyId, (ar.get(l.partyId) ?? 0) + net);
      if (l.glAccountId === employeeId) emp.set(l.employeeId, (emp.get(l.employeeId) ?? 0) - net);
      if (l.glAccountId === shareholderId) {
        shareholder -= net;
        touchesShareholder = true;
      }
      if (l.glAccountId === accumulatedId && p.sourceType === "depreciation" && p.sourceId !== null) {
        accumulatedByAsset.set(p.sourceId, (accumulatedByAsset.get(p.sourceId) ?? 0) - net);
      }
    }
    if (touchesShareholder && p.sourceType !== "manual") shareholderEntries += 1;
    if (p.sourceId !== null && (p.sourceType === "depreciation" || p.sourceType === "transaction")) {
      assetPostings.add(`${p.sourceType}:${p.sourceId}`);
    }
  }

  const inLedger = (scope: LedgerKind) => ledger === "management" || scope === "government";
  const cash = inputs.bankAccounts
    .filter((b) => inLedger(b.ledgerScope) && (b.isActive || bank.has(b.id)))
    .map((b) => {
      const v = bank.get(b.id);
      const foreign = b.currency !== inputs.settings.functionalCurrency;
      return {
        bankAccountId: b.id,
        name: b.name,
        currency: b.currency,
        fxBalance: foreign && v?.hasFx ? round2(v.fx) : null,
        balance: round2(v?.balance ?? 0),
      };
    });

  const nonZero = <K>(m: Map<K, number>) => [...m.entries()].filter(([, v]) => Math.abs(v) >= 0.005);
  const receivables = nonZero(ar)
    .map(([partyId, balance]) => ({
      partyId,
      name: partyId === null ? null : (inputs.partyNames[partyId] ?? null),
      balance: round2(balance),
    }))
    .sort((a, b) => b.balance - a.balance);
  const employeeAdvances = nonZero(emp)
    .map(([id, balance]) => ({
      employeeId: id,
      name: id === null ? null : (inputs.employeeNames[id] ?? null),
      balance: round2(balance),
    }))
    .sort((a, b) => b.balance - a.balance);

  const fixedAssets = inputs.fixedAssets
    .filter(
      (a) =>
        a.acquiredOn <= asOf &&
        (ledger === "management" ||
          assetPostings.has(`depreciation:${a.id}`) ||
          (a.sourceTransactionId !== null && assetPostings.has(`transaction:${a.sourceTransactionId}`)) ||
          a.sourceTransactionId === null),
    )
    .map((a) => {
      const accumulated = round2(accumulatedByAsset.get(a.id) ?? 0);
      return {
        id: a.id,
        name: a.name,
        acquiredOn: a.acquiredOn,
        usefulLifeMonths: a.usefulLifeMonths,
        cost: round2(a.cost),
        accumulated,
        net: round2(a.cost - accumulated),
        disposedOn: a.disposedOn,
      };
    });

  const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
  return {
    orgName: inputs.orgName,
    ledger,
    asOf,
    framework:
      getJurisdiction(inputs.settings.jurisdiction).frameworks.find((f) => f.code === inputs.settings.framework)?.label ??
      inputs.settings.framework,
    functionalCurrency: inputs.settings.functionalCurrency,
    fiscalYearStartMonth: inputs.settings.fiscalYearStartMonth,
    booksStartDate: inputs.settings.booksStartDate,
    cash,
    cashTotal: sum(cash.map((c) => c.balance)),
    receivables,
    receivablesTotal: sum(receivables.map((r) => r.balance)),
    employeeAdvances,
    employeeAdvancesTotal: sum(employeeAdvances.map((r) => r.balance)),
    shareholderBalance: round2(shareholder),
    shareholderEntries,
    fixedAssets,
    fixedAssetTotals: {
      cost: sum(fixedAssets.map((a) => a.cost)),
      accumulated: sum(fixedAssets.map((a) => a.accumulated)),
      net: sum(fixedAssets.map((a) => a.net)),
    },
  };
}
