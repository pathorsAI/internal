/**
 * 永豐對帳單匯入的資料庫層：planSinopacImport（只讀，給預覽／--dry-run）與
 * applySinopacImport（寫入）。網頁與 scripts/import-sinopac-statement.ts 共用。
 * 規則（比對、沖正、雜湊）都在 src/lib/bank-import/sinopac.ts，這裡只負責撈資料與寫入。
 *
 * apply 一律重新 plan，不吃呼叫端傳來的預覽結果（預覽後資料可能變了，也不信任瀏覽器傳回的決定）。
 *
 * ⚠️ neon-http 沒有互動式交易：逐行寫入，中途失敗會留下前面已寫的行。重跑是安全的 ——
 * 已記錄的行算「已匯入過」；交易建了但行沒記到的，下次用 external_ref（= line_hash）認回來。
 */
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { bankAccounts, bankStatementLines, transactions } from "@/db/schema";
import { insertTransaction, updateTransactionsPlain } from "@/lib/linking/write";
import {
  amountOf,
  createdDescription,
  directionOf,
  findMultiMatch,
  findNearMatch,
  matchStatementLines,
  MATCH_WINDOW_DAYS,
  pairCorrections,
  sinopacLineHash,
  statementAccounts,
  toCents,
  type MatchCandidate,
  type MatchLine,
  type SinopacDirection,
  type SinopacLine,
  type SinopacParseIssue,
  type SinopacParseResult,
} from "@/lib/bank-import/sinopac";

export const SINOPAC_SOURCE = "sinopac";

const CHUNK = 500;

export type PlanDecision =
  /** 對到既有交易：補 bank_memo / bank_ref（空的才補）。 */
  | "match"
  /** 對不到：新建待確認交易。 */
  | "create"
  /** 對不到，但有一筆金額差一點（1% 內）的交易：可能是同一筆、金額記錯。不新建、不記錄，留給人看。 */
  | "near_match"
  /** 之前的匯入已經建了交易、但這一行沒記到（中途失敗）：只補記這一行。 */
  | "recover"
  /** 沖正與被沖正的那一行。 */
  | "correction_pair"
  /** 已在 bank_statement_lines，或同一份檔案裡重複。 */
  | "duplicate"
  /** 略過：原因看 skipReason。 */
  | "skip";

export type SkipReason =
  /** 沖正找不到原交易（會記錄成 skipped，之後不再處理）。 */
  | "correction_unpaired"
  /** 帳戶沒對應（不記錄，下次對應好再匯）。 */
  | "unmapped"
  /** 對應的帳本帳戶幣別不同（不記錄）。 */
  | "currency_mismatch"
  /** 之前這一行建的交易已經被刪掉（不記錄、不重建）。 */
  | "created_deleted"
  /** 對不到，這次選了「配不上的只列出來、不建立」（不記錄，下次可以再匯）。 */
  | "left_unmatched";

export type PlannedLine = {
  lineNo: number;
  last4: string;
  date: string;
  localDateTime: string;
  currency: string;
  direction: SinopacDirection;
  amount: string;
  balance: string | null;
  ref: string | null;
  remarks: string | null;
  isCorrection: boolean;
  hash: string;
  bankAccountId: number | null;
  decision: PlanDecision;
  skipReason?: SkipReason;
  /** match / recover：對到的交易（一對多時是第一筆）；near_match：金額差一點的那筆。 */
  transactionId?: number;
  /** match 一對多：銀行這一筆對到的全部交易（兩筆以上）。 */
  transactionIds?: number[];
  /** near_match：那筆交易記的金額。 */
  nearAmount?: string;
  transactionDescription?: string | null;
  /** match：哪幾欄會被補上。 */
  fillMemo?: boolean;
  fillRef?: boolean;
  /** correction_pair：另一行的列號。 */
  partnerLineNo?: number;
  /** duplicate：true = 同一份檔案裡重複，false = 之前匯入過。 */
  duplicateInFile?: boolean;
};

export type PlanAccount = {
  last4: string;
  currency: string;
  count: number;
  bankAccountId: number | null;
  bankAccountName: string | null;
  problem: null | "unmapped" | "not_found" | "currency_mismatch";
};

export type PlanCounts = {
  total: number;
  matched: number;
  created: number;
  correctionPair: number;
  duplicate: number;
  skipped: number;
  /** 金額差一點、等人確認的行。 */
  nearMatch: number;
  parseErrors: number;
};

export type PlanOptions = {
  /** true：配不上的行只列出來（left_unmatched），不新建交易。 */
  skipUnmatched?: boolean;
};

export type SinopacPlan = {
  accounts: PlanAccount[];
  lines: PlannedLine[];
  counts: PlanCounts;
  parseErrors: SinopacParseIssue[];
};

type AccountRow = { id: number; name: string; currency: string };

async function loadAccounts(db: Db, orgId: string, ids: number[]): Promise<Map<number, AccountRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), inArray(bankAccounts.id, ids), isNull(bankAccounts.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

function resolveAccounts(
  lines: readonly SinopacLine[],
  accountMap: Readonly<Record<string, number>>,
  found: Map<number, AccountRow>,
): PlanAccount[] {
  return statementAccounts(lines).map((a) => {
    const id = accountMap[a.last4];
    if (id === undefined) return { ...a, bankAccountId: null, bankAccountName: null, problem: "unmapped" };
    const acct = found.get(id);
    if (!acct) return { ...a, bankAccountId: id, bankAccountName: null, problem: "not_found" };
    if (acct.currency.trim() !== a.currency) {
      return { ...a, bankAccountId: id, bankAccountName: acct.name, problem: "currency_mismatch" };
    }
    return { ...a, bankAccountId: id, bankAccountName: acct.name, problem: null };
  });
}

async function existingHashes(db: Db, orgId: string, hashes: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const part = hashes.slice(i, i + CHUNK);
    const rows = await db
      .select({ h: bankStatementLines.lineHash })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.organizationId, orgId), inArray(bankStatementLines.lineHash, part)));
    for (const r of rows) out.add(r.h);
  }
  return out;
}

/** 之前的匯入用 external_ref = line_hash 建過的交易（含已刪除的，刪掉的不重建）。 */
async function createdBefore(
  db: Db,
  orgId: string,
  hashes: string[],
): Promise<Map<string, { id: number; deleted: boolean; description: string | null }>> {
  const out = new Map<string, { id: number; deleted: boolean; description: string | null }>();
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const part = hashes.slice(i, i + CHUNK);
    const rows = await db
      .select({
        id: transactions.id,
        ref: transactions.externalRef,
        deletedAt: transactions.deletedAt,
        description: transactions.description,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.externalSource, SINOPAC_SOURCE),
          inArray(transactions.externalRef, part),
        ),
      );
    for (const r of rows) {
      if (r.ref) out.set(r.ref, { id: r.id, deleted: r.deletedAt !== null, description: r.description });
    }
  }
  return out;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Candidate = MatchCandidate & { bankMemo: string | null; description: string | null };

/** 這些帳戶、日期範圍 ±3 天內、沒刪除的交易。 */
async function loadCandidates(db: Db, orgId: string, accountIds: number[], dates: string[]): Promise<Candidate[]> {
  if (accountIds.length === 0 || dates.length === 0) return [];
  const sorted = [...dates].sort((a, b) => a.localeCompare(b));
  const from = shiftDate(sorted[0], -MATCH_WINDOW_DAYS);
  const to = shiftDate(sorted.at(-1) as string, MATCH_WINDOW_DAYS);
  return db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      currency: transactions.currency,
      fromAccountId: transactions.fromAccountId,
      toAccountId: transactions.toAccountId,
      bankRef: transactions.bankRef,
      bankMemo: transactions.bankMemo,
      description: transactions.description,
      partyId: transactions.partyId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        or(inArray(transactions.fromAccountId, accountIds), inArray(transactions.toAccountId, accountIds)),
      ),
    );
}

/** 已經被任何一行對帳單認領的交易（matched / created）。 */
async function claimedTransactionIds(db: Db, orgId: string, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = await db
      .select({ id: bankStatementLines.transactionId })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.organizationId, orgId), inArray(bankStatementLines.transactionId, part)));
    for (const r of rows) if (r.id !== null) out.add(r.id);
  }
  return out;
}

function baseLine(l: SinopacLine, hash: string, bankAccountId: number | null): PlannedLine {
  return {
    lineNo: l.lineNo,
    last4: l.last4,
    date: l.date,
    localDateTime: l.localDateTime,
    currency: l.currency,
    direction: directionOf(l),
    amount: amountOf(l),
    balance: l.balance,
    ref: l.ref,
    remarks: l.remarks,
    isCorrection: l.correction !== null,
    hash,
    bankAccountId,
    decision: "create",
  };
}

function countPlan(lines: readonly PlannedLine[], parseErrors: number): PlanCounts {
  const c: PlanCounts = {
    total: lines.length,
    matched: 0,
    created: 0,
    correctionPair: 0,
    duplicate: 0,
    skipped: 0,
    nearMatch: 0,
    parseErrors,
  };
  for (const l of lines) {
    if (l.decision === "match") c.matched += 1;
    else if (l.decision === "create" || l.decision === "recover") c.created += 1;
    else if (l.decision === "correction_pair") c.correctionPair += 1;
    else if (l.decision === "duplicate") c.duplicate += 1;
    else if (l.decision === "near_match") c.nearMatch += 1;
    else c.skipped += 1;
  }
  return c;
}

/** 已匯入過、同檔重複、帳戶有問題的行先標掉。回傳還要處理的行索引。 */
function markDuplicatesAndAccounts(
  planned: PlannedLine[],
  existing: Set<string>,
  accountProblem: Map<string, PlanAccount["problem"]>,
): number[] {
  const seen = new Set<string>();
  const live: number[] = [];
  planned.forEach((p, i) => {
    if (existing.has(p.hash) || seen.has(p.hash)) {
      p.decision = "duplicate";
      p.duplicateInFile = !existing.has(p.hash);
      return;
    }
    seen.add(p.hash);
    const problem = accountProblem.get(`${p.last4}:${p.currency}`);
    if (problem) {
      p.decision = "skip";
      p.skipReason = problem === "currency_mismatch" ? "currency_mismatch" : "unmapped";
      return;
    }
    live.push(i);
  });
  return live;
}

/** 沖正配對（只在還要處理的行之間配；原交易之前已匯入過的沖正 → 找不到原交易）。回傳剩下的行。 */
function markCorrections(planned: PlannedLine[], lines: readonly SinopacLine[], live: number[]): number[] {
  const pairing = pairCorrections(live.map((i) => lines[i]));
  const consumed = new Set<number>();
  for (const [c, o] of pairing.pairs) {
    const ci = live[c];
    const oi = live[o];
    planned[ci].decision = "correction_pair";
    planned[ci].partnerLineNo = planned[oi].lineNo;
    planned[oi].decision = "correction_pair";
    planned[oi].partnerLineNo = planned[ci].lineNo;
    consumed.add(ci).add(oi);
  }
  for (const u of pairing.unpaired) {
    const ui = live[u];
    planned[ui].decision = "skip";
    planned[ui].skipReason = "correction_unpaired";
    consumed.add(ui);
  }
  return live.filter((i) => !consumed.has(i));
}

/** 中途失敗留下的交易認回來；已刪除的不重建。回傳還要比對的行。 */
function markRecovered(
  planned: PlannedLine[],
  remaining: number[],
  prior: Map<string, { id: number; deleted: boolean; description: string | null }>,
): number[] {
  return remaining.filter((i) => {
    const hit = prior.get(planned[i].hash);
    if (!hit) return true;
    if (hit.deleted) {
      planned[i].decision = "skip";
      planned[i].skipReason = "created_deleted";
    } else {
      planned[i].decision = "recover";
      planned[i].transactionId = hit.id;
      planned[i].transactionDescription = hit.description;
    }
    return false;
  });
}

function setMatch(p: PlannedLine, matched: Candidate[]): void {
  p.decision = "match";
  p.transactionId = matched[0].id;
  if (matched.length > 1) p.transactionIds = matched.map((c) => c.id);
  p.transactionDescription = matched.map((c) => c.description ?? `#${c.id}`).join("、");
  p.fillMemo = p.remarks !== null && matched.some((c) => !c.bankMemo?.trim());
  p.fillRef = p.ref !== null && matched.some((c) => !c.bankRef?.trim());
}

function toMatchLine(p: PlannedLine, key: number): MatchLine {
  return {
    key,
    bankAccountId: p.bankAccountId as number,
    date: p.date,
    currency: p.currency,
    direction: p.direction,
    cents: toCents(p.amount),
    ref: p.ref,
  };
}

/**
 * 比對：先一對一；剩下的試一對多（幾筆加總剛好相等）；再剩下的找金額差一點的提示；
 * 都沒有的才新建（或 skipUnmatched 時只列出來）。
 */
async function markMatches(
  db: Db,
  orgId: string,
  planned: PlannedLine[],
  toMatch: number[],
  opts: PlanOptions,
): Promise<void> {
  const accountIds = [...new Set(toMatch.map((i) => planned[i].bankAccountId as number))];
  const candidates = await loadCandidates(db, orgId, accountIds, toMatch.map((i) => planned[i].date));
  const claimed = await claimedTransactionIds(db, orgId, candidates.map((c) => c.id));
  // 這次要補記的（recover）交易也算已認領，不能再被別行對走。
  for (const p of planned) if (p.decision === "recover" && p.transactionId) claimed.add(p.transactionId);
  const result = matchStatementLines(toMatch.map((i) => toMatchLine(planned[i], i)), candidates, claimed);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const unmatched: number[] = [];
  for (const i of toMatch) {
    const txnId = result.get(i) ?? null;
    if (txnId === null) unmatched.push(i);
    else {
      claimed.add(txnId);
      setMatch(planned[i], [byId.get(txnId) as Candidate]);
    }
  }
  const stillUnmatched: number[] = [];
  for (const i of unmatched) {
    const ids = findMultiMatch(toMatchLine(planned[i], i), candidates, claimed);
    if (ids) {
      for (const id of ids) claimed.add(id);
      setMatch(planned[i], ids.map((id) => byId.get(id) as Candidate));
    } else stillUnmatched.push(i);
  }
  for (const i of stillUnmatched) {
    const p = planned[i];
    const near = findNearMatch(toMatchLine(p, i), candidates, claimed);
    if (near) {
      p.decision = "near_match";
      p.transactionId = near.id;
      p.nearAmount = near.amount;
      p.transactionDescription = byId.get(near.id)?.description ?? null;
    } else if (opts.skipUnmatched) {
      p.decision = "skip";
      p.skipReason = "left_unmatched";
    }
  }
}

/**
 * 試算（不寫入任何東西）：每一行的決定與各類筆數。accountMap = 末四碼 → 帳本帳戶 id。
 */
export async function planSinopacImport(
  db: Db,
  orgId: string,
  parsed: SinopacParseResult,
  accountMap: Readonly<Record<string, number>>,
  opts: PlanOptions = {},
): Promise<SinopacPlan> {
  const { lines } = parsed;
  const found = await loadAccounts(db, orgId, [...new Set(Object.values(accountMap))]);
  const accounts = resolveAccounts(lines, accountMap, found);
  const accountProblem = new Map(accounts.map((a) => [`${a.last4}:${a.currency}`, a.problem]));
  const accountIdOf = new Map(accounts.map((a) => [`${a.last4}:${a.currency}`, a.problem ? null : a.bankAccountId]));

  const hashes = await Promise.all(lines.map((l) => sinopacLineHash(orgId, l)));
  const planned = lines.map((l, i) => baseLine(l, hashes[i], accountIdOf.get(`${l.last4}:${l.currency}`) ?? null));

  const existing = await existingHashes(db, orgId, [...new Set(hashes)]);
  const live = markDuplicatesAndAccounts(planned, existing, accountProblem);
  const remaining = markCorrections(planned, lines, live);
  const prior = await createdBefore(db, orgId, remaining.map((i) => planned[i].hash));
  const toMatch = markRecovered(planned, remaining, prior);
  await markMatches(db, orgId, planned, toMatch, opts);

  return { accounts, lines: planned, counts: countPlan(planned, parsed.errors.length), parseErrors: parsed.errors };
}

// ---------------------------------------------------------------------------
// 寫入
// ---------------------------------------------------------------------------

export type ApplyFailure = { lineNo: number; message: string };

export type SinopacApplyResult = {
  plan: SinopacPlan;
  /** 實際寫入的筆數（失敗的不算）。 */
  written: { matched: number; created: number; correctionPair: number; skipped: number };
  /** 補上備註／參考號的交易數（對到但兩欄都已有值的不算）。 */
  filled: number;
  failures: ApplyFailure[];
};

type LineStatus = "matched" | "created" | "correction_pair" | "skipped";

function lineRecord(
  orgId: string,
  p: PlannedLine,
  status: LineStatus,
  userId: string | null,
  transactionId: number | null,
  note: string | null,
): typeof bankStatementLines.$inferInsert {
  return {
    organizationId: orgId,
    bankAccountId: p.bankAccountId as number,
    lineHash: p.hash,
    txnAt: `${p.date}T${p.localDateTime.slice(11)}+08:00`,
    currency: p.currency,
    withdrawal: p.direction === "out" ? p.amount : null,
    deposit: p.direction === "in" ? p.amount : null,
    balance: p.balance,
    bankRef: p.ref,
    remarks: p.remarks,
    isCorrection: p.isCorrection,
    status,
    note,
    transactionId,
    importedByUserId: userId,
  };
}

async function recordLine(db: Db, row: typeof bankStatementLines.$inferInsert): Promise<boolean> {
  const got = await db.insert(bankStatementLines).values(row).onConflictDoNothing().returning({ id: bankStatementLines.id });
  return got.length > 0;
}

/** 對到的交易：備註、參考號各自「空的才補」（條件寫在 where，跟同時有人改不會互相蓋掉）。 */
async function fillTransaction(db: Db, orgId: string, p: PlannedLine, id: number): Promise<boolean> {
  const now = new Date().toISOString();
  let changed = false;
  if (p.remarks !== null) {
    const got = await updateTransactionsPlain(
      db,
      orgId,
      and(eq(transactions.id, id), sql`coalesce(btrim(${transactions.bankMemo}), '') = ''`),
      { bankMemo: p.remarks, updatedAt: now },
    );
    changed ||= got.length > 0;
  }
  if (p.ref !== null) {
    const got = await updateTransactionsPlain(
      db,
      orgId,
      and(eq(transactions.id, id), sql`coalesce(btrim(${transactions.bankRef}), '') = ''`),
      { bankRef: p.ref, updatedAt: now },
    );
    changed ||= got.length > 0;
  }
  return changed;
}

async function createTransaction(db: Db, orgId: string, p: PlannedLine): Promise<number> {
  const out = p.direction === "out";
  const { row } = await insertTransaction(
    { db, orgId, source: "bank_import" },
    {
      organizationId: orgId,
      type: out ? "expense" : "income",
      txnDate: p.date,
      description: createdDescription(p),
      categoryId: null,
      partyId: null,
      amount: p.amount,
      currency: p.currency,
      amountTwd: p.currency === "TWD" ? p.amount : null,
      fromAccountId: out ? p.bankAccountId : null,
      toAccountId: out ? null : p.bankAccountId,
      book: "internal",
      billedToCompanyTaxId: false,
      bankMemo: p.remarks,
      bankRef: p.ref,
      externalSource: SINOPAC_SOURCE,
      externalRef: p.hash,
      externalMeta: {
        bank: "sinopac",
        accountLast4: p.last4,
        dateTime: p.localDateTime,
        balance: p.balance,
        lineNo: p.lineNo,
      },
      needsReview: true,
    },
  );
  return row.id;
}

function correctionNote(p: PlannedLine): string {
  return p.isCorrection ? `沖正第 ${p.partnerLineNo} 行` : `被第 ${p.partnerLineNo} 行沖正`;
}

type Tally = { written: SinopacApplyResult["written"]; filled: number; failures: ApplyFailure[] };

async function applyLine(db: Db, orgId: string, p: PlannedLine, userId: string | null, t: Tally): Promise<void> {
  switch (p.decision) {
    case "match": {
      for (const id of p.transactionIds ?? [p.transactionId as number]) {
        if (await fillTransaction(db, orgId, p, id)) t.filled += 1;
      }
      const note = p.transactionIds ? "一對多：" + p.transactionIds.map((id) => "#" + id).join("、") : null;
      if (await recordLine(db, lineRecord(orgId, p, "matched", userId, p.transactionId as number, note))) {
        t.written.matched += 1;
      }
      return;
    }
    case "recover": {
      if (await recordLine(db, lineRecord(orgId, p, "created", userId, p.transactionId as number, "補記：交易在之前的匯入已建立"))) {
        t.written.created += 1;
      }
      return;
    }
    case "create": {
      const id = await createTransaction(db, orgId, p);
      if (await recordLine(db, lineRecord(orgId, p, "created", userId, id, null))) t.written.created += 1;
      return;
    }
    case "correction_pair": {
      if (await recordLine(db, lineRecord(orgId, p, "correction_pair", userId, null, correctionNote(p)))) {
        t.written.correctionPair += 1;
      }
      return;
    }
    case "skip": {
      // 只有「沖正找不到原交易」要記下來（之後不再處理）；帳戶沒對應、幣別不符、交易已刪的不記，
      // 下次對應好或改好再匯就會處理。
      if (p.skipReason !== "correction_unpaired") return;
      if (await recordLine(db, lineRecord(orgId, p, "skipped", userId, null, "沖正找不到原交易（同帳戶、同金額、方向相反、時間更早的那一行）"))) {
        t.written.skipped += 1;
      }
      return;
    }
    default:
      return; // duplicate、near_match：什麼都不做（near_match 等人確認，下次重匯會再判斷）
  }
}

/**
 * 寫入：重新試算後逐行處理。對到的補備註、對不到的新建待確認交易、沖正兩行只記錄。
 * 每一行各自 try/catch：一行失敗（例如落在已結帳的期間）記在 failures，其他行照做；失敗的行
 * 沒有記錄，修好之後重匯同一份檔案就會再處理。
 * log：寫一筆操作紀錄（網頁用 logWeb，腳本用 logSystem），失敗不影響匯入。
 */
export async function applySinopacImport(
  db: Db,
  orgId: string,
  parsed: SinopacParseResult,
  accountMap: Readonly<Record<string, number>>,
  opts: PlanOptions & { userId: string | null; log?: (summary: string) => Promise<unknown> },
): Promise<SinopacApplyResult> {
  const plan = await planSinopacImport(db, orgId, parsed, accountMap, { skipUnmatched: opts.skipUnmatched });
  const tally: Tally = { written: { matched: 0, created: 0, correctionPair: 0, skipped: 0 }, filled: 0, failures: [] };
  for (const p of plan.lines) {
    try {
      await applyLine(db, orgId, p, opts.userId, tally);
    } catch (e) {
      tally.failures.push({ lineNo: p.lineNo, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (opts.log) {
    const w = tally.written;
    const failed = tally.failures.length ? "、失敗 " + tally.failures.length : "";
    const near = plan.counts.nearMatch ? "、金額差一點待確認 " + plan.counts.nearMatch : "";
    const summary = `永豐明細匯入：配對補備註 ${w.matched}、新建待確認 ${w.created}、沖正抵銷 ${w.correctionPair}、略過 ${w.skipped}、已匯入過 ${plan.counts.duplicate}${near}${failed}`;
    try {
      await opts.log(summary);
    } catch {
      // 操作紀錄失敗不影響匯入
    }
  }
  return { plan, written: tally.written, filled: tally.filled, failures: tally.failures };
}

/** 帳戶對應下拉的選項（本組織、沒刪除）。 */
export async function listImportAccountOptions(db: Db, orgId: string) {
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      kind: bankAccounts.kind,
      currency: bankAccounts.currency,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), isNull(bankAccounts.deletedAt)))
    .orderBy(bankAccounts.name);
}
