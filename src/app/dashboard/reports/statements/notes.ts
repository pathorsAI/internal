/**
 * 附註（台灣財報慣例的骨架）：公司沿革、重要會計政策、現金明細、應收帳款明細、員工代墊、
 * 股東往來、不動產廠房設備。數字一律從分錄算（BuildResult.postings，已經只到 asOf），
 * 跟四大報表同一個來源。純函式。
 */
import { getJurisdiction } from "@/lib/ledger/jurisdictions";
import type { BuildResult, LedgerInputs, LedgerKind, Posting, PostingLine, SystemKey } from "@/lib/ledger/types";

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

/** 附註要追的幾個系統科目（找不到就是 null）。 */
type NoteAccountIds = {
  cash: Set<number>;
  ar: number | null;
  employee: number | null;
  shareholder: number | null;
  accumulated: number | null;
};

/** 掃過分錄累積出來的各附註餘額。 */
type NoteTotals = {
  bank: Map<number, { balance: number; fx: number; hasFx: boolean }>;
  ar: Map<number | null, number>;
  emp: Map<number | null, number>;
  shareholder: number;
  shareholderEntries: number;
  accumulatedByAsset: Map<number, number>;
  assetPostings: Set<string>;
};

function addBankLine(bank: NoteTotals["bank"], bankAccountId: number, l: PostingLine, net: number) {
  const cur = bank.get(bankAccountId) ?? { balance: 0, fx: 0, hasFx: false };
  cur.balance += net;
  if (l.fxAmount !== null) {
    cur.fx += l.fxAmount;
    cur.hasFx = true;
  }
  bank.set(bankAccountId, cur);
}

/** 把一行分錄記進對應的附註餘額；回傳這行是否動到股東往來。 */
function addLine(totals: NoteTotals, ids: NoteAccountIds, p: Posting, l: PostingLine): boolean {
  const net = l.debit - l.credit;
  if (l.bankAccountId !== null && ids.cash.has(l.glAccountId)) addBankLine(totals.bank, l.bankAccountId, l, net);
  if (l.glAccountId === ids.ar) totals.ar.set(l.partyId, (totals.ar.get(l.partyId) ?? 0) + net);
  if (l.glAccountId === ids.employee) totals.emp.set(l.employeeId, (totals.emp.get(l.employeeId) ?? 0) - net);
  if (l.glAccountId === ids.accumulated && p.sourceType === "depreciation" && p.sourceId !== null) {
    totals.accumulatedByAsset.set(p.sourceId, (totals.accumulatedByAsset.get(p.sourceId) ?? 0) - net);
  }
  if (l.glAccountId !== ids.shareholder) return false;
  totals.shareholder -= net;
  return true;
}

function accumulate(postings: Posting[], ledger: LedgerKind, asOf: string, ids: NoteAccountIds): NoteTotals {
  const totals: NoteTotals = {
    bank: new Map(),
    ar: new Map(),
    emp: new Map(),
    shareholder: 0,
    shareholderEntries: 0,
    accumulatedByAsset: new Map(),
    assetPostings: new Set(),
  };
  for (const p of postings) {
    if (p.ledger !== ledger || p.date > asOf) continue;
    let touchesShareholder = false;
    for (const l of p.lines) {
      if (addLine(totals, ids, p, l)) touchesShareholder = true;
    }
    if (touchesShareholder && p.sourceType !== "manual") totals.shareholderEntries += 1;
    if (p.sourceId !== null && (p.sourceType === "depreciation" || p.sourceType === "transaction")) {
      totals.assetPostings.add(`${p.sourceType}:${p.sourceId}`);
    }
  }
  return totals;
}

/** 政府帳只列有入帳依據的資產（有折舊分錄、來源交易有入帳，或手動建立）；管理帳全列。 */
function assetInLedger(
  a: LedgerInputs["fixedAssets"][number],
  ledger: LedgerKind,
  asOf: string,
  assetPostings: Set<string>,
): boolean {
  if (a.acquiredOn > asOf) return false;
  if (ledger === "management" || a.sourceTransactionId === null) return true;
  return assetPostings.has(`depreciation:${a.id}`) || assetPostings.has(`transaction:${a.sourceTransactionId}`);
}

export function buildNotes(inputs: LedgerInputs, built: BuildResult, ledger: LedgerKind, asOf: string): NotesData {
  const idOf = (key: SystemKey) => inputs.accounts.find((a) => a.systemKey === key)?.id ?? null;
  const ids: NoteAccountIds = {
    cash: new Set(inputs.accounts.filter((a) => a.cashFlow === "cash").map((a) => a.id)),
    ar: idOf("ar"),
    employee: idOf("employee_payable"),
    shareholder: idOf("shareholder"),
    accumulated: idOf("accumulated_depreciation"),
  };
  const { bank, ar, emp, shareholder, shareholderEntries, accumulatedByAsset, assetPostings } = accumulate(
    built.postings,
    ledger,
    asOf,
    ids,
  );

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
    .filter((a) => assetInLedger(a, ledger, asOf, assetPostings))
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
