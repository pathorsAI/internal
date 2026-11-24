/**
 * 交易對象（客戶 / 廠商）名稱的相似度（純函式）。
 *
 * 完全相同（不分大小寫）與別名命中由 src/lib/party-aliases.ts 的 matchParty 處理；
 * 這裡處理「不完全相同但很可能是同一家」：公司後綴不同（LLC / Inc. / 股份有限公司）、
 * 標點空白不同、少打一兩個字、一邊是另一邊的一部分（「HNT」vs「HNT Marketing LLC」）。
 */

// 比對前拿掉的公司型態字樣（英文以整個字為單位、中文直接去掉）
const EN_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "ltd", "limited", "co", "corp", "corporation", "company",
  "plc", "gmbh", "sa", "bv", "pte", "pty", "kk", "the",
]);
const ZH_SUFFIXES = ["股份有限公司", "有限公司", "企業社", "工作室", "公司", "商行", "台灣分公司", "分公司"];

/** 正規化：小寫、全形轉半形、拿掉標點與公司型態字樣、合併空白。 */
export function normalizePartyKey(name: string): string {
  let s = name.normalize("NFKC").toLowerCase();
  for (const suf of ZH_SUFFIXES) s = s.split(suf).join(" ");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  const words = s.split(" ").filter((w) => w && !EN_SUFFIXES.has(w));
  return words.join(" ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0–1，1 = 正規化後完全相同。 */
export function partySimilarity(a: string, b: string): number {
  const ka = normalizePartyKey(a);
  const kb = normalizePartyKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const compactA = ka.replace(/ /g, "");
  const compactB = kb.replace(/ /g, "");
  if (compactA === compactB) return 0.98;
  // 一邊的字完整出現在另一邊（HNT ⊂ HNT Marketing）：短的那邊至少 3 個字元才算，避免「AI」吃到一堆
  const [short, long] = compactA.length <= compactB.length ? [ka, kb] : [kb, ka];
  const shortCompact = short.replace(/ /g, "");
  if (shortCompact.length >= 3) {
    const longWords = new Set(long.split(" "));
    const shortWords = short.split(" ");
    if (shortWords.every((w) => longWords.has(w))) return 0.9;
    if (long.replace(/ /g, "").startsWith(shortCompact)) return 0.85;
  }
  const dist = levenshtein(compactA, compactB);
  return 1 - dist / Math.max(compactA.length, compactB.length);
}

/** 超過這個分數就算「很像」，不默默新建。 */
export const SIMILAR_THRESHOLD = 0.8;

export type SimilarParty = { id: number; name: string; score: number; via: "name" | "alias" };

/** 從候選裡挑出跟 name 很像的（名稱或別名），分數高的在前，最多 limit 個。 */
export function rankSimilarParties(
  candidates: readonly { id: number; name: string; aliases: readonly string[] }[],
  name: string,
  limit = 5,
): SimilarParty[] {
  const out: SimilarParty[] = [];
  for (const c of candidates) {
    let best: SimilarParty | null = null;
    const nameScore = partySimilarity(name, c.name);
    if (nameScore >= SIMILAR_THRESHOLD) best = { id: c.id, name: c.name, score: nameScore, via: "name" };
    for (const alias of c.aliases) {
      const a = alias.trim().replace(/\*$/, "");
      const s = partySimilarity(name, a);
      if (s >= SIMILAR_THRESHOLD && (!best || s > best.score)) best = { id: c.id, name: c.name, score: s, via: "alias" };
    }
    if (best) out.push({ ...best, score: Math.round(best.score * 100) / 100 });
  }
  return out.sort((x, y) => y.score - x.score || x.id - y.id).slice(0, limit);
}
