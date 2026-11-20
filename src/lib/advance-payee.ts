/**
 * 代墊（type='advance'）的「代墊人」：員工（settle_employee_id）或公司（settle_party_id，migrations/0036）。
 *
 * 員工先付、公司還錢是原本的用法；關係企業替我們墊的錢（東蜂替派斯墊 Groq、Twilio…）也是同一件事，
 * 只是對象是交易對象（party），而且公司沒有員工銀行帳戶。兩種都進同一張「代墊／應付未還」清單，
 * 撥款時 reimbursement 帶回同一個代墊人。
 *
 * 這裡只放純函式（web 表單、MCP、代墊頁共用），不碰 DB。
 */

export type AdvancePayeeKind = "employee" | "party";

/** 解析後的代墊人：員工用名稱（查無就建）；公司用 id 或名稱（名稱查無就建交易對象）。 */
export type AdvancePayee =
  | { kind: "employee"; name: string }
  | { kind: "party"; id: number | null; name: string | null };

export type AdvancePayeeError = "missing" | "both";

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/**
 * 從 MCP 參數或表單欄位挑出代墊人。員工與公司只能擇一：兩邊都給 → "both"，都沒給 → "missing"。
 * 公司同時給 id 與名稱時以 id 為準（名稱只當顯示用，呼叫端驗 id 屬於本組織）。
 */
export function pickAdvancePayee(input: {
  employeeName?: string | null;
  partyId?: number | null;
  partyName?: string | null;
}): AdvancePayee | { error: AdvancePayeeError } {
  const employeeName = clean(input.employeeName);
  const partyId = input.partyId != null && input.partyId > 0 ? input.partyId : null;
  const partyName = clean(input.partyName);
  const hasParty = partyId !== null || partyName !== null;
  if (employeeName && hasParty) return { error: "both" };
  if (employeeName) return { kind: "employee", name: employeeName };
  if (hasParty) return { kind: "party", id: partyId, name: partyName };
  return { error: "missing" };
}

/** 表單上「代墊人是」切換的值；沒送或不認得一律當員工（舊表單、舊 client 的行為）。 */
export function advancePayeeKind(v: string | null | undefined): AdvancePayeeKind {
  return v === "party" ? "party" : "employee";
}

/** 一筆代墊列的代墊人是誰（兩欄都空 = 舊資料沒填代墊人，kind 為 null）。 */
export function settleKindOf(row: {
  settleEmployeeId: number | null;
  settlePartyId: number | null;
}): AdvancePayeeKind | null {
  if (row.settlePartyId != null) return "party";
  if (row.settleEmployeeId != null) return "employee";
  return null;
}

export type OutstandingAdvanceLike = {
  settleKind: AdvancePayeeKind | null;
  settleEmployeeId: number | null;
  settlePartyId: number | null;
  settleName: string | null;
  amount: string | number | null;
  amountTwd: string | number | null;
  currency: string | null;
};

export type PayeeTotal = {
  /** `employee:<id>`、`party:<id>` 或 `none`（沒填代墊人的舊資料）。 */
  key: string;
  kind: AdvancePayeeKind | null;
  id: number | null;
  name: string | null;
  count: number;
  /** 各幣別原幣合計（不同幣別不能混加），依幣別字母排序。 */
  totals: { currency: string; amount: number }[];
  /** 台幣合計：TWD 列直接算，外幣列用記帳時的台幣金額；沒有台幣金額的外幣列不算進來。 */
  totalTwd: number;
};

/**
 * 未還代墊依代墊人加總。員工與公司分開算（同名也不會併在一起），台幣合計多的排前面。
 */
type PayeeGroup = PayeeTotal & { byCurrency: Map<string, number> };

/** 這列歸到哪一組；沒填代墊人（或 id 缺）的舊資料一律歸 none。 */
function newPayeeGroup(r: OutstandingAdvanceLike): PayeeGroup {
  const id = r.settleKind === "party" ? r.settlePartyId : r.settleEmployeeId;
  const base = { count: 0, totals: [], totalTwd: 0, byCurrency: new Map<string, number>() };
  if (!r.settleKind || id == null) return { ...base, key: "none", kind: null, id: null, name: null };
  return { ...base, key: `${r.settleKind}:${id}`, kind: r.settleKind, id, name: r.settleName };
}

function addToGroup(g: PayeeGroup, r: OutstandingAdvanceLike) {
  const currency = r.currency ?? "TWD";
  g.count += 1;
  g.byCurrency.set(currency, (g.byCurrency.get(currency) ?? 0) + Number(r.amount ?? 0));
  const twd = r.amountTwd ?? (currency === "TWD" ? r.amount : null);
  g.totalTwd += Number(twd ?? 0);
}

export function summarizeOutstandingByPayee(rows: readonly OutstandingAdvanceLike[]): PayeeTotal[] {
  const byKey = new Map<string, PayeeGroup>();
  for (const r of rows) {
    const fresh = newPayeeGroup(r);
    const g = byKey.get(fresh.key) ?? fresh;
    byKey.set(g.key, g);
    addToGroup(g, r);
  }
  return [...byKey.values()]
    .map(({ byCurrency, ...g }) => ({
      ...g,
      totals: [...byCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount]) => ({ currency, amount: round2(amount) })),
      totalTwd: round2(g.totalTwd),
    }))
    .sort((a, b) => b.totalTwd - a.totalTwd || (a.name ?? "").localeCompare(b.name ?? ""));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
