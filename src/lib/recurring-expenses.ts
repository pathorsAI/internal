import { CURRENCIES } from "./currency";

/**
 * 固定支出（recurring_expenses）的純領域邏輯：扣款日推算、交易比對、每月回顧的模型與
 * Discord 訊息。不碰 DB、不打外部服務 —— 讀資料與送訊息在 src/lib/billing-notify.ts。
 *
 * 日期一律是台北日曆的 'YYYY-MM-DD' 字串，月份是 'YYYY-MM'。這裡只做字串與整數運算，
 * 不經過 Date 的時區換算，所以在 Workers（UTC）上跑出來的日期跟台北日曆一致。
 *
 * Discord 的讀者是台灣團隊，訊息文字固定 zh-TW，不走 i18n。
 */

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

/**
 * 扣款節奏。fixed 一定有 anchorDate（DB 的 chk_recurring_expense_anchor 保證），
 * usage（用量計費 / 自動儲值）沒有固定扣款日 —— 不提醒、不檢查漏扣。
 */
export type ChargeSchedule =
  | { schedule: "fixed"; anchorDate: string; intervalMonths: number }
  | { schedule: "usage" };

export type RecurringExpense = ChargeSchedule & {
  id: number;
  name: string;
  /** | 分隔、不分大小寫的子字串；null = 用 name 比對。 */
  matchPattern: string | null;
  /** 預期的付款方式（payment_methods）。 */
  paymentMethodId: number | null;
  /** 付款方式給人看的名稱，例如「MasterCard •1234」。 */
  paymentMethodLabel: string | null;
  paymentMethodLast4: string | null;
  /** 預期扣款的帳本帳戶 = 付款方式的 settles_from_account_id；回顧拿它比對實際付款帳戶。 */
  expectedAccountId: number | null;
  expectedAccountName: string | null;
  expectedAmount: number | null;
  currency: string | null;
  billingUrl: string | null;
};

/** DB 讀回來的一列（numeric 是字串、schedule 是 text）。toRecurringExpense 在邊界轉成領域型別。 */
export type RecurringExpenseRecord = {
  id: number;
  name: string;
  matchPattern: string | null;
  paymentMethodId: number | null;
  paymentMethodLabel: string | null;
  paymentMethodLast4: string | null;
  expectedAccountId: number | null;
  expectedAccountName: string | null;
  schedule: string;
  anchorDate: string | null;
  intervalMonths: number;
  expectedAmount: string | null;
  currency: string | null;
  billingUrl: string | null;
};

/** schedule = fixed 但沒有 anchorDate 的列 DB CHECK 擋得掉；萬一出現就當成 usage（不提醒、不檢查漏扣）。 */
export function toRecurringExpense(r: RecurringExpenseRecord): RecurringExpense {
  const schedule: ChargeSchedule =
    r.schedule === "fixed" && r.anchorDate
      ? { schedule: "fixed", anchorDate: r.anchorDate, intervalMonths: r.intervalMonths }
      : { schedule: "usage" };
  return {
    ...schedule,
    id: r.id,
    name: r.name,
    matchPattern: r.matchPattern,
    paymentMethodId: r.paymentMethodId,
    paymentMethodLabel: r.paymentMethodLabel,
    paymentMethodLast4: r.paymentMethodLast4,
    expectedAccountId: r.expectedAccountId,
    expectedAccountName: r.expectedAccountName,
    expectedAmount: r.expectedAmount === null ? null : Number(r.expectedAmount),
    currency: r.currency,
    billingUrl: r.billingUrl,
  };
}

export type Money = { currency: string; amount: number };

/** 回顧用的帳本交易：上個月的 expense 與 advance。金額已轉成 number。 */
export type LedgerTransaction = {
  id: number;
  txnDate: string;
  type: "expense" | "advance";
  amount: number;
  currency: string;
  fromAccountId: number | null;
  fromAccountName: string | null;
  /** 實際刷的卡（Wise 卡片交易的 external_meta.cardLastFour）；其他交易是 null。 */
  cardLast4: string | null;
  partyName: string | null;
  description: string | null;
  /** type = advance 時是代墊的員工。 */
  settleEmployeeName: string | null;
};

/** 還沒報帳的代墊（list_outstanding_advances 那支查詢的一列）。 */
export type OutstandingAdvance = { employeeName: string | null; txnDate: string; amount: number; currency: string };

/** 實際付款的一方：公司帳戶、員工代墊，或交易上沒填帳戶。 */
export type Payer =
  | { kind: "account"; accountId: number; name: string }
  | { kind: "advance"; employeeName: string }
  | { kind: "unassigned" };

export type RecapLine = {
  expenseId: number;
  name: string;
  /** 這一行涵蓋的交易，依 id 由小到大；訊息裡連到交易頁只看這幾筆。 */
  transactionIds: number[];
  /** 實際扣款筆數，不含手續費列。 */
  count: number;
  feeCount: number;
  /** 含手續費：手續費也是這家廠商的實際成本。 */
  totals: Money[];
  fees: Money[];
};

export type RecapGroup = {
  label: string;
  payer: Payer;
  /**
   * 帳戶組的末四碼：這組交易實際刷的卡（多張全列）；交易上沒有卡號時，退回這組固定支出
   * 設定的付款方式中、從這個帳戶扣款的那些卡。員工代墊與未指定帳戶是空陣列。
   */
  last4s: string[];
  subtotals: Money[];
  lines: RecapLine[];
};

export type EmployeeAdvances = { employeeName: string; totals: Money[] };

export type RecapModel = {
  period: string;
  /** 所有組（含員工代墊）的總額。 */
  grandTotals: Money[];
  groups: RecapGroup[];
  /** fixed、這個月有扣款日、卻一筆交易都沒對到。 */
  missing: { expenseId: number; name: string; chargeDates: string[] }[];
  /** 對到的交易不是從設定的扣款帳戶付的（含員工代墊）。 */
  accountMismatch: {
    expenseId: number;
    name: string;
    expectedAccountName: string;
    actualPayers: string[];
  }[];
  /** 交易日在 period 內、還沒報帳的代墊，依金額由大到小。 */
  newAdvances: EmployeeAdvances[];
  /** 交易日在 period 之前、還沒報帳的代墊合計；period 之後的不算進回顧。 */
  olderAdvances: { count: number; totals: Money[] } | null;
  needsReviewCount: number;
};

export type RecapInput = {
  period: string;
  /** 已啟用的固定支出。 */
  expenses: readonly RecurringExpense[];
  /** period 那個月的 expense / advance 交易（呼叫端依日期篩好）。 */
  transactions: readonly LedgerTransaction[];
  outstandingAdvances: readonly OutstandingAdvance[];
  needsReviewCount: number;
};

/** 一則扣款提醒。lastMonth = 上個月對到的金額；沒有就退回設定的預估金額。 */
export type ReminderItem = {
  expenseId: number;
  name: string;
  chargeDate: string;
  paymentMethodLabel: string | null;
  /** 付款方式最後從哪個帳本帳戶扣。 */
  expectedAccountName: string | null;
  lastMonth: Money[];
  expected: Money | null;
  billingUrl: string | null;
};

export type RenderOptions = { mentionRoleId: string | null; appUrl?: string };

/** Discord 單則訊息的上限。 */
export const DISCORD_MESSAGE_LIMIT = 2000;

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

type YearMonth = { year: number; month: number };

function parseDate(s: string): YearMonth & { day: number } {
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)), day: Number(s.slice(8, 10)) };
}

/** 從西元 0 年 1 月起算的月序號，方便做月份加減。 */
function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(i: number): YearMonth {
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

function daysInMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmd(ym: YearMonth, day: number): string {
  return `${ym.year}-${pad2(ym.month)}-${pad2(day)}`;
}

/** 'YYYY-MM' 的上一個月。 */
export function previousPeriod(period: string): string {
  const ym = fromMonthIndex(monthIndex(parseDate(`${period}-01`)) - 1);
  return `${ym.year}-${pad2(ym.month)}`;
}

/** 'YYYY-MM' 的第一天與下個月第一天（半開區間，給 DB 查詢用）。 */
export function periodRange(period: string): { start: string; endExclusive: string } {
  const next = fromMonthIndex(monthIndex(parseDate(`${period}-01`)) + 1);
  return { start: `${period}-01`, endExclusive: formatYmd(next, 1) };
}

/** 'YYYY-MM-DD' 加減天數（純日曆運算）。 */
export function addDaysYmd(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 第 k 次扣款日（k = 0 是 anchorDate 本身）。日期以 anchor 的「日」為準、每次各自壓到
 * 當月月底：1/31 → 2/28 → 3/31，不會一路縮成 28 號。
 */
function nthChargeDate(anchorDate: string, intervalMonths: number, k: number): string {
  const anchor = parseDate(anchorDate);
  const ym = fromMonthIndex(monthIndex(anchor) + k * intervalMonths);
  return formatYmd(ym, Math.min(anchor.day, daysInMonth(ym)));
}

/**
 * onOrAfter 當天或之後的下一次扣款日；usage 回 null。anchorDate 是第一次（或任一次已知的）
 * 扣款日，之前不往回推 —— 剛登記、下個月才開始扣的廠商不會在回顧裡被當成「漏扣」。
 */
export function nextChargeDate(expense: ChargeSchedule, onOrAfter: string): string | null {
  if (expense.schedule === "usage") return null;
  const { anchorDate, intervalMonths } = expense;
  if (anchorDate >= onOrAfter) return anchorDate;
  const target = parseDate(onOrAfter);
  let k = Math.max(
    0,
    Math.floor((monthIndex(target) - monthIndex(parseDate(anchorDate))) / intervalMonths),
  );
  let date = nthChargeDate(anchorDate, intervalMonths, k);
  while (date < onOrAfter) {
    k += 1;
    date = nthChargeDate(anchorDate, intervalMonths, k);
  }
  return date;
}

/** period（'YYYY-MM'）裡的扣款日；usage 或該月沒有扣款時回空陣列。 */
export function chargeDatesInMonth(expense: ChargeSchedule, period: string): string[] {
  const first = nextChargeDate(expense, `${period}-01`);
  return first?.startsWith(period) ? [first] : [];
}

// ---------------------------------------------------------------------------
// 交易比對
// ---------------------------------------------------------------------------

function splitPattern(pattern: string): string[] {
  return pattern
    .split("|")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p !== "");
}

/** match_pattern 沒填、或只有空白和 | 時，退回用 name 比對。 */
function patternParts(expense: Pick<RecurringExpense, "name" | "matchPattern">): string[] {
  const parts = expense.matchPattern ? splitPattern(expense.matchPattern) : [];
  return parts.length > 0 ? parts : splitPattern(expense.name);
}

/**
 * 交易的對象名稱或說明，含有任一段 pattern（不分大小寫的子字串，`*` 照字面比）就算對到。
 * 例：`google*cloud` 對到對象「Google*Cloud Abc123」；`openai` 對到說明「OPENAI 國外交易服務費」。
 */
export function matchesExpense(
  expense: Pick<RecurringExpense, "name" | "matchPattern">,
  txn: { partyName: string | null; description: string | null },
): boolean {
  const haystacks = [txn.partyName, txn.description]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  return patternParts(expense).some((part) => haystacks.some((h) => h.includes(part)));
}

const FEE_KEYWORDS = /手續費|服務費/;

/**
 * 銀行另外收的手續費列：對象是銀行（對不到 pattern），只靠說明對到，說明裡寫明是手續費。
 * 例：對象「A 銀行」、說明「OPENAI 國外交易服務費」。
 */
export function isBankFee(
  expense: Pick<RecurringExpense, "name" | "matchPattern">,
  txn: { partyName: string | null; description: string | null },
): boolean {
  return (
    !matchesExpense(expense, { partyName: txn.partyName, description: null }) &&
    FEE_KEYWORDS.test(txn.description ?? "")
  );
}

/**
 * 每筆交易歸給第一個對到的固定支出（依 id 由小到大，結果固定）。對不到任何固定支出的
 * 交易不出現在結果裡 —— 回顧只涵蓋有登記的廠商。
 */
export function assignTransactions(
  expenses: readonly RecurringExpense[],
  transactions: readonly LedgerTransaction[],
): Map<number, LedgerTransaction[]> {
  const ordered = [...expenses].sort((a, b) => a.id - b.id);
  const out = new Map<number, LedgerTransaction[]>();
  for (const txn of transactions) {
    const hit = ordered.find((e) => matchesExpense(e, txn));
    if (!hit) continue;
    const list = out.get(hit.id) ?? [];
    list.push(txn);
    out.set(hit.id, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 金額
// ---------------------------------------------------------------------------

/** 台幣在前，其餘依幣別代碼排序。 */
function compareCurrency(a: string, b: string): number {
  return Number(b === "TWD") - Number(a === "TWD") || a.localeCompare(b);
}

/** 依幣別加總（以分為單位累加，避免 0.1 + 0.2 的浮點誤差），台幣在前、其餘依幣別代碼排序。 */
export function sumByCurrency(items: readonly Money[]): Money[] {
  const cents = new Map<string, number>();
  for (const { currency, amount } of items) {
    cents.set(currency, (cents.get(currency) ?? 0) + Math.round(amount * 100));
  }
  return [...cents.entries()]
    .sort(([a], [b]) => compareCurrency(a, b))
    .map(([currency, c]) => ({ currency, amount: c / 100 }));
}

/** 多幣別時依第一個幣別（台幣優先）的金額比大小。 */
function leadingAmount(totals: readonly Money[]): number {
  return totals[0]?.amount ?? 0;
}

const SYMBOLS = new Map(CURRENCIES.map((c) => [c.code, c.symbol]));
const moneyFormats = new Map<number, Intl.NumberFormat>();

/**
 * Discord 訊息的金額格式：台幣 NT$1,234；其他幣別一律兩位小數（US$48.00）。
 * App 畫面的 formatCurrency 遇到整數會省略小數，不符合這裡的需求，所以另寫一支。
 */
function formatMoney({ currency, amount }: Money): string {
  const decimals = currency === "TWD" ? 0 : 2;
  let nf = moneyFormats.get(decimals);
  if (!nf) {
    nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    moneyFormats.set(decimals, nf);
  }
  const symbol = SYMBOLS.get(currency) ?? `${currency} `;
  return `${amount < 0 ? "-" : ""}${symbol}${nf.format(Math.abs(amount))}`;
}

function formatTotals(totals: readonly Money[], joiner = "、"): string {
  return totals.map(formatMoney).join(joiner);
}

// ---------------------------------------------------------------------------
// 回顧模型
// ---------------------------------------------------------------------------

const ADVANCE_PREFIX = "員工代墊 - ";
const UNASSIGNED_LABEL = "未指定帳戶";

function payerOf(txn: LedgerTransaction): Payer {
  if (txn.type === "advance") return { kind: "advance", employeeName: txn.settleEmployeeName ?? "（未指定員工）" };
  if (txn.fromAccountId === null) return { kind: "unassigned" };
  return {
    kind: "account",
    accountId: txn.fromAccountId,
    name: txn.fromAccountName ?? `#${txn.fromAccountId}`,
  };
}

function payerKey(p: Payer): string {
  if (p.kind === "account") return `account:${p.accountId}`;
  if (p.kind === "advance") return `advance:${p.employeeName}`;
  return "unassigned";
}

function payerLabel(p: Payer): string {
  if (p.kind === "account") return p.name;
  if (p.kind === "advance") return `${ADVANCE_PREFIX}${p.employeeName}`;
  return UNASSIGNED_LABEL;
}

/** 付款方式沒設定、或沒設定從哪個帳戶扣，就不算扣錯。 */
function paidFromExpectedAccount(expense: RecurringExpense, payer: Payer): boolean {
  if (expense.expectedAccountId === null) return true;
  return payer.kind === "account" && payer.accountId === expense.expectedAccountId;
}

function distinctSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

/** 退回付款方式時只算設定從這個帳戶扣的卡：設定成別的帳戶扣的卡出現在這組，代表扣錯帳戶，不是這個帳戶的卡。 */
function groupLast4s(
  payer: Payer,
  txns: readonly LedgerTransaction[],
  expenses: readonly RecurringExpense[],
): string[] {
  if (payer.kind !== "account") return [];
  const cards = distinctSorted(txns.map((t) => t.cardLast4));
  if (cards.length > 0) return cards;
  return distinctSorted(
    expenses.filter((e) => e.expectedAccountId === payer.accountId).map((e) => e.paymentMethodLast4),
  );
}

/** 公司帳戶在前（依名稱），員工代墊其次，沒填帳戶的最後。 */
const PAYER_ORDER: Record<Payer["kind"], number> = { account: 0, advance: 1, unassigned: 2 };

function toRecapGroup(
  payer: Payer,
  lines: Map<number, LedgerTransaction[]>,
  expenseById: Map<number, RecurringExpense>,
): RecapGroup {
  const recapLines = [...lines.entries()]
    .map(([expenseId, txns]): RecapLine => {
      const expense = expenseById.get(expenseId)!;
      const fees = txns.filter((t) => isBankFee(expense, t));
      return {
        expenseId,
        name: expense.name,
        transactionIds: txns.map((t) => t.id).sort((a, b) => a - b),
        count: txns.length - fees.length,
        feeCount: fees.length,
        totals: sumByCurrency(txns),
        fees: sumByCurrency(fees),
      };
    })
    .sort((a, b) => leadingAmount(b.totals) - leadingAmount(a.totals) || a.expenseId - b.expenseId);
  return {
    label: payerLabel(payer),
    payer,
    last4s: groupLast4s(
      payer,
      [...lines.values()].flat(),
      [...lines.keys()].map((id) => expenseById.get(id)!),
    ),
    subtotals: sumByCurrency(recapLines.flatMap((l) => l.totals)),
    lines: recapLines,
  };
}

/** 期間內的代墊依員工分組；期間之前的歸「更早」；期間之後的不列。 */
function splitAdvances(
  advances: readonly OutstandingAdvance[],
  period: string,
): { newByEmployee: Map<string, Money[]>; older: OutstandingAdvance[] } {
  const { start, endExclusive } = periodRange(period);
  const newByEmployee = new Map<string, Money[]>();
  const older: OutstandingAdvance[] = [];
  for (const a of advances) {
    if (a.txnDate < start) older.push(a);
    else if (a.txnDate < endExclusive) {
      const name = a.employeeName ?? "（未指定員工）";
      newByEmployee.set(name, [...(newByEmployee.get(name) ?? []), a]);
    }
  }
  return { newByEmployee, older };
}

export function buildRecap(input: RecapInput): RecapModel {
  const assigned = assignTransactions(input.expenses, input.transactions);
  const groups = new Map<string, { payer: Payer; lines: Map<number, LedgerTransaction[]> }>();
  const mismatch: RecapModel["accountMismatch"] = [];
  const missing: RecapModel["missing"] = [];

  for (const expense of [...input.expenses].sort((a, b) => a.id - b.id)) {
    const txns = assigned.get(expense.id) ?? [];
    if (txns.length === 0) {
      const chargeDates = chargeDatesInMonth(expense, input.period);
      if (chargeDates.length > 0) missing.push({ expenseId: expense.id, name: expense.name, chargeDates });
      continue;
    }
    const wrongPayers = new Set<string>();
    for (const txn of txns) {
      const payer = payerOf(txn);
      const key = payerKey(payer);
      const group = groups.get(key) ?? { payer, lines: new Map() };
      group.lines.set(expense.id, [...(group.lines.get(expense.id) ?? []), txn]);
      groups.set(key, group);
      if (!paidFromExpectedAccount(expense, payer)) wrongPayers.add(payerLabel(payer));
    }
    if (wrongPayers.size > 0) {
      mismatch.push({
        expenseId: expense.id,
        name: expense.name,
        expectedAccountName: expense.expectedAccountName ?? `#${expense.expectedAccountId}`,
        actualPayers: [...wrongPayers].sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  const expenseById = new Map(input.expenses.map((e) => [e.id, e]));
  const recapGroups: RecapGroup[] = [...groups.values()]
    .map(({ payer, lines }) => toRecapGroup(payer, lines, expenseById))
    .sort((a, b) => PAYER_ORDER[a.payer.kind] - PAYER_ORDER[b.payer.kind] || a.label.localeCompare(b.label));

  const { newByEmployee, older } = splitAdvances(input.outstandingAdvances, input.period);

  return {
    period: input.period,
    grandTotals: sumByCurrency(recapGroups.flatMap((g) => g.subtotals)),
    groups: recapGroups,
    missing,
    accountMismatch: mismatch,
    newAdvances: [...newByEmployee.entries()]
      .map(([employeeName, items]) => ({ employeeName, totals: sumByCurrency(items) }))
      .sort(
        (a, b) =>
          leadingAmount(b.totals) - leadingAmount(a.totals) || a.employeeName.localeCompare(b.employeeName),
      ),
    olderAdvances: older.length > 0 ? { count: older.length, totals: sumByCurrency(older) } : null,
    needsReviewCount: input.needsReviewCount,
  };
}

// ---------------------------------------------------------------------------
// Discord 訊息
// ---------------------------------------------------------------------------

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 'YYYY-MM-DD' → '10/15（三）'（月不補零、日補零，例：9/05）。 */
function shortDate(date: string, withWeekday = false): string {
  const { year, month, day } = parseDate(date);
  const base = `${month}/${pad2(day)}`;
  if (!withWeekday) return base;
  return `${base}（${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}）`;
}

function mention(roleId: string | null): string {
  return roleId ? ` <@&${roleId}>` : "";
}

function last4Suffix(last4s: readonly string[]): string {
  const cards = last4s.map((l) => "••••" + l).join(" / ");
  return last4s.length > 0 ? ` ${cards}` : "";
}

/** Discord 的遮罩連結；角括號讓 Discord 不展開成預覽卡片。沒有 appUrl 就只留文字。 */
function appLink(text: string, path: string, appUrl: string | undefined): string {
  return appUrl ? `[${text}](<${appUrl}${path}>)` : text;
}

/** 標題（`#`）和小字（`-#`）跟下一行綁在一起，切訊息時不會被留在上一則的最後一行。 */
function keepsWithNext(line: string): boolean {
  return line.startsWith("#") || line.startsWith("-# ");
}

/**
 * 把多行文字切成每則 ≤ limit 字元的訊息，只在換行處切，標題不跟它的第一行分開；
 * 單一段本身超過上限時才硬切。mention 放在前兩行，所以只會出現在第一則。
 */
export function splitMessages(lines: readonly string[], limit = DISCORD_MESSAGE_LIMIT): string[] {
  const blocks: string[] = [];
  let pending: string[] = [];
  for (const line of lines) {
    pending.push(line);
    if (!keepsWithNext(line)) {
      blocks.push(pending.join("\n"));
      pending = [];
    }
  }
  if (pending.length > 0) blocks.push(pending.join("\n"));

  const out: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (current === "") current = piece;
    else if (current.length + 1 + piece.length <= limit) current += `\n${piece}`;
    else {
      out.push(current);
      current = piece;
    }
  };
  for (const block of blocks) {
    for (let i = 0; i < Math.max(block.length, 1); i += limit) push(block.slice(i, i + limit));
  }
  if (current !== "") out.push(current);
  return out;
}

function transactionsPath(ids: readonly number[]): string {
  return `/dashboard/transactions?ids=${ids.join(",")}`;
}

function groupHeader(group: RecapGroup, period: string, appUrl: string | undefined): string {
  const { payer } = group;
  if (payer.kind === "advance") return `### 👤 ${group.label}`;
  const text = `${group.label}${last4Suffix(group.last4s)}`;
  if (payer.kind === "unassigned") return `### 💳 ${text}`;
  const href = `/dashboard/transactions?account=${payer.accountId}&period=${period}`;
  return `### 💳 ${appLink(text, href, appUrl)}`;
}

function countNote(line: RecapLine): string {
  if (line.count === 0) return `手續費 ${line.feeCount} 筆`;
  if (line.fees.length === 0) return `${line.count} 筆`;
  return `${line.count} 筆（含手續費 ${formatTotals(line.fees)}）`;
}

export function renderRecapMessages(model: RecapModel, opts: RenderOptions): string[] {
  const { appUrl } = opts;
  const lines = [`## 📒 ${model.period} 固定支出回顧`];
  const summary =
    model.groups.length === 0 ? "這個月沒有對到任何固定支出的交易。" : `**合計** ${formatTotals(model.grandTotals, " + ")}`;
  lines.push(`${summary}${mention(opts.mentionRoleId)}`);

  for (const group of model.groups) {
    lines.push(groupHeader(group, model.period, appUrl), `-# 小計 ${formatTotals(group.subtotals)}`);
    for (const line of group.lines) {
      const name = appLink(line.name, transactionsPath(line.transactionIds), appUrl);
      lines.push(`- ${name}　${formatTotals(line.totals)} · ${countNote(line)}`);
    }
  }

  if (model.missing.length > 0 || model.accountMismatch.length > 0) {
    lines.push("### ⚠️ 需要注意");
    for (const m of model.missing) {
      lines.push(`- **${m.name}** 預期 ${m.chargeDates.map((d) => shortDate(d)).join("、")} 扣款，帳上沒看到`);
    }
    for (const m of model.accountMismatch) {
      lines.push(`- **${m.name}** 設定從 ${m.expectedAccountName} 扣，實際 ${m.actualPayers.join("、")}`);
    }
  }

  if (model.newAdvances.length > 0 || model.olderAdvances) {
    lines.push("### 🧾 代墊待報帳");
    if (model.newAdvances.length > 0) {
      const perEmployee = model.newAdvances.map((a) => `${a.employeeName} ${formatTotals(a.totals, " + ")}`);
      lines.push(`- 本月新增：${perEmployee.join("、")}`);
    }
    if (model.olderAdvances) {
      const { count, totals } = model.olderAdvances;
      const label = `更早未報帳 共 ${formatTotals(totals, " + ")}（${count} 筆）`;
      lines.push(`- ${appLink(label, "/dashboard/advances", appUrl)}`);
    }
  }

  if (model.needsReviewCount > 0) {
    lines.push(appLink(`🔍 待確認的匯入交易 ${model.needsReviewCount} 筆`, "/dashboard/transactions?review=1", appUrl));
  }
  return splitMessages(lines);
}

/** 扣款提醒：依扣款日分段，一段一個標題；mention 接在第一段的第一行後面。 */
export function renderReminderMessages(items: readonly ReminderItem[], opts: RenderOptions): string[] {
  const byDate = new Map<string, ReminderItem[]>();
  for (const item of [...items].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate) || a.expenseId - b.expenseId)) {
    byDate.set(item.chargeDate, [...(byDate.get(item.chargeDate) ?? []), item]);
  }
  const lines: string[] = [];
  for (const [date, dueItems] of byDate) {
    const first = lines.length === 0;
    lines.push(`### ⏰ ${shortDate(date, true)}扣款提醒`);
    dueItems.forEach((item, i) => lines.push(`${reminderLine(item)}${first && i === 0 ? mention(opts.mentionRoleId) : ""}`));
  }
  return splitMessages(lines);
}

/** 「→ 付款方式（扣款帳戶）」；沒設定付款方式就整段省略。 */
function paymentNote(item: ReminderItem): string {
  if (!item.paymentMethodLabel) return "";
  const account = item.expectedAccountName ? `（${item.expectedAccountName}）` : "";
  return ` → ${item.paymentMethodLabel}${account}`;
}

function reminderLine(item: ReminderItem): string {
  const parts = [`- **${item.name}**${paymentNote(item)}`];
  if (item.lastMonth.length > 0) parts.push(`上月 ${formatTotals(item.lastMonth)}`);
  else if (item.expected) parts.push(`預估 ${formatMoney(item.expected)}`);
  if (item.billingUrl) parts.push(`[帳單頁](<${item.billingUrl}>)`);
  return parts.join(" · ");
}
