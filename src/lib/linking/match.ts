/**
 * 連結層的純函式（不碰 DB）：候選比對、金額容許差、自動連結的決策。
 * 規則說明見 docs/data-links.md。
 */

export type LinkKind = "billing_item" | "subscription" | "contract";

export type ReviewReason =
  | "link_suggested"
  | "link_ambiguous" | "link_amount_mismatch" | "party_similar" | "link_skipped";

/** 待連結頁顯示的原因（link_skipped 是「人看過、不連」，不算待處理）。 */
export const PENDING_REVIEW_REASONS: readonly ReviewReason[] = [
  "link_suggested",
  "link_ambiguous",
  "link_amount_mismatch",
  "party_similar",
];

export type LinkCandidate = {
  kind: LinkKind;
  id: number;
  /** 顯示用：請款項名稱、訂閱名稱、合約標題 */
  label: string;
  /** 候選本身帶出的合約與專案（掛上之後交易會繼承） */
  contractId: number | null;
  projectId: number | null;
  /** 訂閱候選才有：這筆錢算哪一期 */
  subscriptionPeriod: string | null;
  /** 這個候選還差多少沒收（= 應收 − 已收） */
  expected: number;
  currency: string;
  /** expected − 交易金額；正數 = 交易比應收少（常見：被扣匯款手續費） */
  gap: number;
  amountMatches: boolean;
};

/**
 * 匯款手續費的容許差：交易金額可以比應收少一點（銀行／中間行扣的），不能多。
 * 取「應收的 1.5%」與幣別的固定下限較大者。外幣常見扣 USD 15–45 的電匯費。
 */
const FEE_FLOOR: Record<string, number> = { TWD: 100, USD: 50, EUR: 50, GBP: 40, JPY: 5000, HKD: 400, SGD: 70 };
const FEE_RATE = 0.015;
const ROUNDING = 0.01;

export function feeTolerance(expected: number, currency: string): number {
  return Math.max(expected * FEE_RATE, FEE_FLOOR[currency] ?? 0);
}

export function amountMatches(amount: number, expected: number, currency: string): boolean {
  if (!(expected > 0)) return false;
  const gap = expected - amount;
  return gap >= -ROUNDING && gap <= feeTolerance(expected, currency);
}

/** 把原始候選（只有 expected）補上 gap 與 amountMatches，依接近程度排序。 */
export function scoreCandidates(
  raw: readonly Omit<LinkCandidate, "gap" | "amountMatches">[],
  amount: number,
): LinkCandidate[] {
  return raw
    .map((c) => ({
      ...c,
      gap: round2(c.expected - amount),
      amountMatches: amountMatches(amount, c.expected, c.currency),
    }))
    .sort(
      (a, b) =>
        Number(b.amountMatches) - Number(a.amountMatches) ||
        Math.abs(a.gap) - Math.abs(b.gap) ||
        a.id - b.id,
    );
}

export type AutoLinkDecision =
  | { kind: "none" }
  | { kind: "link"; pick: LinkCandidate }
  | { kind: "review"; reason: "link_ambiguous" | "link_amount_mismatch"; candidates: LinkCandidate[] };

/** 候選最多留幾個給人挑。 */
export const MAX_CANDIDATES = 6;

/**
 * 有候選時要不要自動掛：金額相符的剛好一個 → 掛；多個相符 → 有歧義；
 * 都對不上 → 金額不符。沒有任何候選 → 什麼都不做（這位客戶沒有開著的應收）。
 */
export function decideAutoLink(candidates: readonly LinkCandidate[]): AutoLinkDecision {
  if (candidates.length === 0) return { kind: "none" };
  const matching = candidates.filter((c) => c.amountMatches);
  if (matching.length === 1) return { kind: "link", pick: matching[0] };
  return {
    kind: "review",
    reason: matching.length > 1 ? "link_ambiguous" : "link_amount_mismatch",
    candidates: candidates.slice(0, MAX_CANDIDATES),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
